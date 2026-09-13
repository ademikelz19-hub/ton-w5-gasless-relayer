import { MessageRelaxed, Address } from '@ton/core';
import { RelayResponseSuccess, TonNetwork } from '../engine/types.js';

export interface RelayerClientOptions {
  /** The base URL of the W5 Gasless Relayer API (e.g. 'http://localhost:3000' or 'https://relayer.my-app.io') */
  relayerUrl: string;
  /** Network selection (default: 'testnet') */
  network?: TonNetwork;
  /** Optional API key for registered Telegram Mini Apps */
  apiKey?: string;
  /** Timeout in milliseconds for HTTP requests */
  requestTimeoutMs?: number;
  /** Whether to wait for on-chain block confirmation before returning */
  waitForConfirmation?: boolean;
}

export interface JettonTransferConfig {
  /** User's Jetton Wallet Address (the jetton wallet contract for the user) */
  jettonWalletAddress: string | Address;
  /** Destination address to receive the Jettons */
  recipient: string | Address;
  /** Amount in raw Jetton units (bigint) */
  jettonAmount: bigint;
  /** Address to send excess gas back to */
  responseAddress?: string | Address;
  /** Forward TON amount for notification to recipient (default: 0.01 TON) */
  forwardTonAmount?: bigint;
  /** Optional custom comment for the transfer */
  comment?: string;
}

export interface RelayerFeePayment {
  /** Relayer's Jetton wallet address or user's Jetton wallet */
  feeJettonWallet: string | Address;
  /** Relayer address collecting the fee */
  feeRecipient: string | Address;
  /** Amount of Jetton units to pay the relayer (e.g. 50000n = 0.05 USDT) */
  feeAmount: bigint;
  /** Optional comment (e.g. "Relayer gas fee") */
  comment?: string;
}

export interface BuildGaslessTransferArgs {
  /** Network selection (determines networkGlobalId: -239 for mainnet, -3 for testnet) */
  network?: TonNetwork;
  /** User's W5 Wallet Public Key (Buffer, hex string, or base64) */
  publicKey: Buffer | string;
  /** Current seqno of the user's W5 wallet contract (0 if uninitialized) */
  seqno: number;
  /** Expiration timestamp in seconds (default: Date.now()/1000 + 180s) */
  validUntil?: number;
  /** Subwallet ID context (default: workChain 0, v5r1, subwallet 0) */
  subwalletNumber?: number;
  /** Simple TON transfer parameters */
  recipient?: string | Address;
  amountTon?: string | number;
  comment?: string;
  /** Optional Jetton (USDT, etc.) transfer parameters */
  jettonTransfer?: JettonTransferConfig;
  /** Optional Jetton fee payment to the relayer (Fee Recovery Mode) */
  relayerFee?: RelayerFeePayment;
  /** Optional raw TON internal messages */
  messages?: MessageRelaxed[];
}

export type SignerFn = (signingHash: Buffer) => Promise<Buffer> | Buffer;

export interface ExecuteGaslessTransferArgs extends BuildGaslessTransferArgs {
  /** Either an ed25519 secretKey (Buffer), or an asynchronous signer callback */
  signer: Buffer | SignerFn;
  /** Optional metadata tag */
  metadata?: {
    appName?: string;
    actionDescription?: string;
  };
}

export interface RelayResult extends RelayResponseSuccess {
  explorerUrl: string;
}
