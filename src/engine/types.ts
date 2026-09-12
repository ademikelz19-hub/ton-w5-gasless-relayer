import { Cell, Address } from '@ton/core';

export interface W5ParsedPayload {
  opcode: number;
  opcodeHex: string;
  isInternal: boolean;
  walletIdRaw: number;
  validUntil: number;
  seqno: number;
  signature: Buffer;
  signingCell: Cell;
  signingHash: Buffer;
  rawCell: Cell;
}

export interface RelayRequestBody {
  /** Hex or base64 encoded user public key (32 bytes / 64 hex chars) */
  userPublicKey: string;
  /** User's W5 wallet address (friendly or raw) */
  userWalletAddress: string;
  /** Base64-encoded W5 signed internal/external message body BOC */
  payloadBoc: string;
  /** Optional client-supplied metadata */
  metadata?: {
    appName?: string;
    actionDescription?: string;
  };
}

export interface RelayResponseSuccess {
  success: true;
  txHash: string;
  userWalletAddress: string;
  relayedAt: number;
  seqno: number;
  validUntil: number;
  gasSponsoredTon: string;
}

export interface RelayResponseError {
  success: false;
  error: {
    code: RelayErrorCode;
    message: string;
    details?: unknown;
  };
}

export type RelayResponse = RelayResponseSuccess | RelayResponseError;

export type RelayErrorCode =
  | 'INVALID_REQUEST'
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_BOC'
  | 'UNSUPPORTED_OPCODE'
  | 'INVALID_SIGNATURE'
  | 'SIGNATURE_VERIFICATION_FAILED'
  | 'TRANSACTION_EXPIRED'
  | 'SEQNO_MISMATCH'
  | 'REPLAY_ATTACK_DETECTED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'INSUFFICIENT_RELAYER_BALANCE'
  | 'RPC_ERROR'
  | 'INTERNAL_ERROR';

export interface GasEstimationRequest {
  userWalletAddress: string;
  actionCount?: number;
}

export interface GasEstimationResponse {
  estimatedGasTon: string;
  relayerSponsoringTon: string;
  minRelayerBalanceTon: string;
  isSponsored: boolean;
}

export interface RelayerConfigResponse {
  relayerAddress: string;
  network: string;
  maxGasPerTxTon: number;
  minRelayerBalanceTon: number;
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  supportedOpCodes: {
    auth_signed_internal: string;
    auth_signed_external: string;
  };
}
