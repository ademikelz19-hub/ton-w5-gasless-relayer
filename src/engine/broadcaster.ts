import {
  Address,
  toNano,
  fromNano,
  internal,
  SendMode,
  Cell,
  Transaction,
} from '@ton/core';
import { mnemonicToPrivateKey, KeyPair } from '@ton/crypto';
import { TonClient, WalletContractV4, WalletContractV5R1 } from '@ton/ton';
import { config } from '../config.js';
import { W5ParsedPayload } from './types.js';

export interface BroadcasterConfig {
  endpoint: string;
  apiKey?: string;
  mnemonic?: string;
  gasSponsorshipTon: number;
}

export interface BroadcastResult {
  txHash: string;
  logicalTime?: string;
  gasSponsoredTon: string;
  simulated: boolean;
  confirmed: boolean;
}

export class RelayBroadcaster {
  private client: TonClient;
  private keyPair: KeyPair | null = null;
  private relayerWallet: WalletContractV4 | null = null;
  private isInitialized = false;

  constructor(private readonly options: BroadcasterConfig) {
    this.client = new TonClient({
      endpoint: options.endpoint,
      apiKey: options.apiKey || undefined,
    });
  }

  public getTonClient(): TonClient {
    return this.client;
  }

  /**
   * Initialize the relayer hot wallet using the configured mnemonic.
   */
  public async init(): Promise<void> {
    if (this.isInitialized) return;

    const mnemonic = this.options.mnemonic || config.RELAYER_MNEMONIC;
    if (!mnemonic || mnemonic.trim().split(/\s+/).length < 12) {
      console.warn(
        '⚠️ RELAYER_MNEMONIC is not configured or invalid. Relayer running in SIMULATION/AUDIT-ONLY mode.'
      );
      this.isInitialized = true;
      return;
    }

    const words = mnemonic.trim().split(/\s+/);
    this.keyPair = await mnemonicToPrivateKey(words);
    this.relayerWallet = WalletContractV4.create({
      workchain: 0,
      publicKey: this.keyPair.publicKey,
    });

    this.isInitialized = true;
    console.log(`✅ Relayer Hot Wallet initialized: ${this.relayerWallet.address.toString({ testOnly: config.TON_NETWORK === 'testnet' })}`);
  }

  /**
   * Check the current balance of the relayer hot wallet.
   */
  public async getRelayerBalance(): Promise<{ balanceNano: bigint; balanceTon: string }> {
    if (!this.relayerWallet) {
      return { balanceNano: 0n, balanceTon: '0.00' };
    }

    try {
      const balanceNano = await this.client.getBalance(this.relayerWallet.address);
      return {
        balanceNano,
        balanceTon: fromNano(balanceNano),
      };
    } catch (err) {
      console.error('Failed to query relayer balance:', err);
      return { balanceNano: 0n, balanceTon: '0.00' };
    }
  }

  /**
   * Get the relayer hot wallet address, or a placeholder if unconfigured.
   */
  public getRelayerAddress(): string {
    if (!this.relayerWallet) {
      return 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c'; // placeholder
    }
    return this.relayerWallet.address.toString({ testOnly: config.TON_NETWORK === 'testnet' });
  }

  /**
   * Polls the TON network until the contract sequence number advances,
   * then returns the real on-chain transaction hash and logical time.
   */
  public async waitForConfirmation(
    targetAddress: Address,
    initialSeqno: number,
    timeoutMs: number = config.CONFIRMATION_TIMEOUT_MS
  ): Promise<{ txHash: string; logicalTime: string }> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 2000));

      try {
        const state = await this.client.getContractState(targetAddress);
        if (state.state !== 'active') continue;

        const res = await this.client.runMethod(targetAddress, 'seqno');
        const currentSeqno = res.stack.readNumber();

        if (currentSeqno > initialSeqno) {
          // Contract executed and seqno incremented! Retrieve latest on-chain transaction
          const txs = await this.client.getTransactions(targetAddress, { limit: 3 });
          if (txs && txs.length > 0) {
            const latestTx = txs[0];
            return {
              txHash: latestTx.hash().toString('hex'),
              logicalTime: latestTx.lt.toString(),
            };
          }
        }
      } catch {
        // Continue polling until timeout
      }
    }

    throw new Error(`Transaction confirmation timed out after ${timeoutMs / 1000} seconds`);
  }

  /**
   * Construct an internal transaction forwarding the verified W5 payload with relayer-sponsored gas.
   * Then broadcast to TON Testnet / Mainnet.
   */
  public async broadcastW5Internal(
    userWalletAddress: string,
    parsedPayload: W5ParsedPayload,
    gasAmountTon: number = config.MAX_GAS_PER_TX_TON,
    shouldWaitConfirmation: boolean = config.WAIT_FOR_CONFIRMATION
  ): Promise<BroadcastResult> {
    await this.init();

    const targetUserAddress = Address.parse(userWalletAddress);
    const gasNano = toNano(gasAmountTon.toString());

    // In simulation or offline test mode when no relayer hot wallet is configured:
    if (!this.relayerWallet || !this.keyPair) {
      const mockHash = parsedPayload.rawCell.hash().toString('hex');
      return {
        txHash: mockHash,
        gasSponsoredTon: gasAmountTon.toFixed(4),
        simulated: true,
        confirmed: true,
      };
    }

    // Verify relayer balance
    const { balanceNano } = await this.getRelayerBalance();
    const minRequired = toNano(config.MIN_RELAYER_BALANCE_TON.toString());
    if (balanceNano < minRequired) {
      throw new Error(
        `Relayer balance too low (${fromNano(balanceNano)} TON). Required minimum: ${config.MIN_RELAYER_BALANCE_TON} TON`
      );
    }

    // Open contract instance to query relayer seqno
    const contract = this.client.open(this.relayerWallet);
    const relayerSeqno = await contract.getSeqno();

    // Create internal message to user's W5 wallet containing the signed W5 body
    const internalMsg = internal({
      to: targetUserAddress,
      value: gasNano,
      bounce: true,
      body: parsedPayload.rawCell,
    });

    // Sign and build external transfer message from relayer wallet
    const transfer = this.relayerWallet.createTransfer({
      seqno: relayerSeqno,
      secretKey: this.keyPair.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
      messages: [internalMsg],
    });

    // Broadcast to TON network
    await this.client.sendExternalMessage(this.relayerWallet, transfer);
    const pendingMsgHash = transfer.hash().toString('hex');

    // Optional confirmation wait
    if (shouldWaitConfirmation) {
      try {
        const confirmedTx = await this.waitForConfirmation(
          targetUserAddress,
          parsedPayload.seqno
        );
        return {
          txHash: confirmedTx.txHash,
          logicalTime: confirmedTx.logicalTime,
          gasSponsoredTon: gasAmountTon.toFixed(4),
          simulated: false,
          confirmed: true,
        };
      } catch (err: any) {
        console.warn('Confirmation polling timed out, returning broadcast envelope hash:', err.message);
      }
    }

    return {
      txHash: pendingMsgHash,
      gasSponsoredTon: gasAmountTon.toFixed(4),
      simulated: false,
      confirmed: false,
    };
  }
}
