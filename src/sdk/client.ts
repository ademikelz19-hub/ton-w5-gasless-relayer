import {
  RelayerClientOptions,
  ExecuteGaslessTransferArgs,
  RelayResult,
  BuildGaslessTransferArgs,
} from './types.js';
import { W5PayloadBuilder } from './builder.js';
import {
  RelayerConfigResponse,
  GasEstimationResponse,
  RelayResponseSuccess,
  RelayResponseError,
} from '../engine/types.js';
import { SignatureVerifier } from '../engine/verifier.js';

export class TonW5RelayerClient {
  private relayerUrl: string;
  private network: 'testnet' | 'mainnet';
  private timeoutMs: number;

  constructor(options: RelayerClientOptions) {
    this.relayerUrl = options.relayerUrl.replace(/\/+$/, '');
    this.network = options.network || 'testnet';
    this.timeoutMs = options.requestTimeoutMs || 15000;
  }

  /**
   * Fetch public relayer configuration and supported opcodes.
   */
  public async getConfig(): Promise<RelayerConfigResponse> {
    const res = await fetch(`${this.relayerUrl}/config`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch relayer config: HTTP ${res.status}`);
    }

    return (await res.json()) as RelayerConfigResponse;
  }

  /**
   * Estimate the TON gas required to sponsor the transaction.
   */
  public async estimateGas(actionCount: number = 1): Promise<GasEstimationResponse> {
    const res = await fetch(`${this.relayerUrl}/estimate-gas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionCount }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Failed to estimate gas: HTTP ${res.status}`);
    }

    return (await res.json()) as GasEstimationResponse;
  }

  /**
   * Check relayer server health and liquidity status.
   */
  public async checkHealth(): Promise<{ status: string; relayerBalanceTon: string }> {
    const res = await fetch(`${this.relayerUrl}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    return (await res.json()) as { status: string; relayerBalanceTon: string };
  }

  /**
   * Execute a full gasless transfer:
   * 1. Constructs W5 internal_signed action cell
   * 2. Signs payload with user private key or wallet signer
   * 3. Sends to Relayer /relay endpoint
   * 4. Returns confirmed broadcast receipt with explorer link
   */
  public async sendGaslessTransfer(args: ExecuteGaslessTransferArgs): Promise<RelayResult> {
    const { walletAddress, payloadBoc, validUntil } = await W5PayloadBuilder.buildAndSign(
      args,
      args.signer
    );

    const pubKeyBuf = SignatureVerifier.normalizePublicKey(args.publicKey);
    const pubKeyHex = pubKeyBuf.toString('hex');

    const res = await fetch(`${this.relayerUrl}/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userPublicKey: pubKeyHex,
        userWalletAddress: walletAddress,
        payloadBoc,
        metadata: args.metadata,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const data = (await res.json()) as RelayResponseSuccess | RelayResponseError;

    if (!data.success) {
      const err = (data as RelayResponseError).error;
      throw new Error(`[Relayer Error: ${err.code}] ${err.message}`);
    }

    const success = data as RelayResponseSuccess;
    const explorerDomain = this.network === 'testnet' ? 'testnet.tonviewer.com' : 'tonviewer.com';
    const explorerUrl = `https://${explorerDomain}/transaction/${success.txHash}`;

    return {
      ...success,
      explorerUrl,
    };
  }

  /**
   * Relay a pre-constructed and pre-signed W5 payload directly.
   */
  public async relaySignedPayload(params: {
    userPublicKey: string | Buffer;
    userWalletAddress: string;
    payloadBoc: string;
    metadata?: { appName?: string; actionDescription?: string };
  }): Promise<RelayResult> {
    const pubKeyBuf = SignatureVerifier.normalizePublicKey(params.userPublicKey);

    const res = await fetch(`${this.relayerUrl}/relay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userPublicKey: pubKeyBuf.toString('hex'),
        userWalletAddress: params.userWalletAddress,
        payloadBoc: params.payloadBoc,
        metadata: params.metadata,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const data = (await res.json()) as RelayResponseSuccess | RelayResponseError;

    if (!data.success) {
      const err = (data as RelayResponseError).error;
      throw new Error(`[Relayer Error: ${err.code}] ${err.message}`);
    }

    const success = data as RelayResponseSuccess;
    const explorerDomain = this.network === 'testnet' ? 'testnet.tonviewer.com' : 'tonviewer.com';
    const explorerUrl = `https://${explorerDomain}/transaction/${success.txHash}`;

    return {
      ...success,
      explorerUrl,
    };
  }
}
