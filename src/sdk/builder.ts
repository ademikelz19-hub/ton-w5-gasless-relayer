import {
  Cell,
  beginCell,
  Address,
  toNano,
  internal,
  MessageRelaxed,
  SendMode,
} from '@ton/core';
import { sign } from '@ton/crypto';
import { WalletContractV5R1 } from '@ton/ton';
import {
  BuildGaslessTransferArgs,
  JettonTransferConfig,
  SignerFn,
} from './types.js';
import { SignatureVerifier } from '../engine/verifier.js';

export class W5PayloadBuilder {
  /**
   * Helper to construct a standard TEP-74 Jetton transfer internal message.
   * Opcode: 0x0f8a7ea5
   */
  public static createJettonTransferMessage(
    config: JettonTransferConfig,
    senderAddress: Address
  ): MessageRelaxed {
    const targetJettonWallet = typeof config.jettonWalletAddress === 'string'
      ? Address.parse(config.jettonWalletAddress)
      : config.jettonWalletAddress;

    const recipientAddress = typeof config.recipient === 'string'
      ? Address.parse(config.recipient)
      : config.recipient;

    const responseAddress = config.responseAddress
      ? (typeof config.responseAddress === 'string'
          ? Address.parse(config.responseAddress)
          : config.responseAddress)
      : senderAddress;

    const forwardTonAmount = config.forwardTonAmount ?? toNano('0.01');

    // Build forward payload with comment if present
    let forwardPayload: Cell | null = null;
    if (config.comment) {
      forwardPayload = beginCell()
        .storeUint(0, 32) // text comment prefix
        .storeStringTail(config.comment)
        .endCell();
    }

    const body = beginCell()
      .storeUint(0x0f8a7ea5, 32) // op::transfer
      .storeUint(0, 64) // query_id
      .storeCoins(config.jettonAmount)
      .storeAddress(recipientAddress)
      .storeAddress(responseAddress)
      .storeBit(0) // custom_payload: null
      .storeCoins(forwardTonAmount)
      .storeMaybeRef(forwardPayload)
      .endCell();

    // Value to attach for gas forwarding (e.g. 0.05 TON)
    const attachedValue = toNano('0.05') + forwardTonAmount;

    return internal({
      to: targetJettonWallet,
      value: attachedValue,
      body,
      bounce: true,
    });
  }

  /**
   * Build the unsigned W5 internal request cell, extract the signing hash,
   * and provide a callback to assemble the final signed BOC.
   */
  public static buildUnsignedPayload(args: BuildGaslessTransferArgs): {
    wallet: WalletContractV5R1;
    signingHash: Buffer;
    finalizeWithSignature: (signature: Buffer) => { payloadCell: Cell; payloadBoc: string };
  } {
    const pubKeyBuf = SignatureVerifier.normalizePublicKey(args.publicKey);
    const subwalletNumber = args.subwalletNumber ?? 0;

    const wallet = WalletContractV5R1.create({
      publicKey: pubKeyBuf,
      walletId: {
        networkGlobalId: -3, // Testnet
        context: {
          workChain: 0,
          walletVersion: 'v5r1',
          subwalletNumber,
        },
      },
    });

    const messages: MessageRelaxed[] = [];

    // 1. Simple TON transfer if provided
    if (args.recipient && args.amountTon) {
      const to = typeof args.recipient === 'string'
        ? Address.parse(args.recipient)
        : args.recipient;
      
      const body = args.comment
        ? beginCell().storeUint(0, 32).storeStringTail(args.comment).endCell()
        : beginCell().endCell();

      messages.push(
        internal({
          to,
          value: toNano(args.amountTon.toString()),
          body,
          bounce: true,
        })
      );
    }

    // 2. Jetton transfer if provided
    if (args.jettonTransfer) {
      const jettonMsg = this.createJettonTransferMessage(
        args.jettonTransfer,
        wallet.address
      );
      messages.push(jettonMsg);
    }

    // 3. Custom messages if provided
    if (args.messages && args.messages.length > 0) {
      messages.push(...args.messages);
    }

    if (messages.length === 0) {
      throw new Error('At least one action or transfer message must be specified');
    }

    const validUntil = args.validUntil ?? Math.floor(Date.now() / 1000) + 180;

    // Use WalletContractV5R1 to create the transfer actions
    const dummySecret = Buffer.alloc(64);
    const dummyTransferCell = wallet.createTransfer({
      seqno: args.seqno,
      secretKey: dummySecret,
      timeout: validUntil,
      sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
      messages,
      authType: 'internal',
    });

    // Extract signing cell
    const slice = dummyTransferCell.beginParse();
    const totalBits = slice.remainingBits;
    const signingBits = slice.loadBits(totalBits - 512);
    // Discard dummy signature
    slice.loadBuffer(64);

    const signingCellBuilder = beginCell().storeBits(signingBits);
    while (slice.remainingRefs > 0) {
      signingCellBuilder.storeRef(slice.loadRef());
    }
    const signingCell = signingCellBuilder.endCell();
    const signingHash = signingCell.hash();

    const finalizeWithSignature = (signature: Buffer) => {
      if (signature.length !== 64) {
        throw new Error(`Signature must be 64 bytes, got ${signature.length}`);
      }

      const finalCell = beginCell()
        .storeBuilder(beginCell().storeBits(signingBits))
        .storeBuffer(signature);

      // Copy refs back
      const refSlice = signingCell.beginParse();
      refSlice.loadBits(signingBits.length);
      while (refSlice.remainingRefs > 0) {
        finalCell.storeRef(refSlice.loadRef());
      }

      const payloadCell = finalCell.endCell();
      const payloadBoc = payloadCell.toBoc().toString('base64');

      return { payloadCell, payloadBoc };
    };

    return { wallet, signingHash, finalizeWithSignature };
  }

  /**
   * Build and sign a W5 gasless payload in a single step using a private key or signer callback.
   */
  public static async buildAndSign(
    args: BuildGaslessTransferArgs,
    signer: Buffer | SignerFn
  ): Promise<{ walletAddress: string; payloadBoc: string; payloadCell: Cell; validUntil: number }> {
    const validUntil = args.validUntil ?? Math.floor(Date.now() / 1000) + 180;
    const { wallet, signingHash, finalizeWithSignature } = this.buildUnsignedPayload({
      ...args,
      validUntil,
    });

    let signature: Buffer;
    if (Buffer.isBuffer(signer)) {
      signature = sign(signingHash, signer);
    } else {
      signature = await signer(signingHash);
    }

    const { payloadCell, payloadBoc } = finalizeWithSignature(signature);

    return {
      walletAddress: wallet.address.toString({ testOnly: true }),
      payloadBoc,
      payloadCell,
      validUntil,
    };
  }
}
