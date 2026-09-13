import { Cell, Address } from '@ton/core';

export type TonNetwork = 'testnet' | 'mainnet';

export interface W5ParsedPayload {
  opcode: number;
  opcodeHex: string;
  isInternal: boolean;
  walletIdRaw: number;
  subwalletNumber: number;
  workChain: number;
  validUntil: number;
  seqno: number;
  signature: Buffer;
  signingCell: Cell;
  signingHash: Buffer;
  rawCell: Cell;
  actionsListRef?: Cell;
}

export interface RelayerFeeConfig {
  feeJettonWallet: string;
  feeRecipient: string;
  feeAmount: string;
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
  /** Whether to await on-chain block inclusion before returning (default: false) */
  waitForConfirmation?: boolean;
}

export interface RelayResponseSuccess {
  success: true;
  txHash: string;
  userWalletAddress: string;
  relayedAt: number;
  seqno: number;
  validUntil: number;
  gasSponsoredTon: string;
  confirmed?: boolean;
  logicalTime?: string;
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
  | 'TREASURY_LIMIT_EXCEEDED'
  | 'UNAUTHORIZED_APP'
  | 'INSUFFICIENT_RELAYER_BALANCE'
  | 'CONFIRMATION_TIMEOUT'
  | 'GAS_LIMIT_EXCEEDED'
  | 'MISSING_REQUIRED_FEE'
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
  feeMode: 'sponsored' | 'jetton_fee';
  requiredJettonFee?: string;
}

export interface RelayerConfigResponse {
  relayerAddress: string;
  network: string;
  networkGlobalId: number;
  maxGasPerTxTon: number;
  minRelayerBalanceTon: number;
  dailyTreasuryLimitTon: number;
  feeMode: 'sponsored' | 'jetton_fee';
  feeCollectorAddress?: string;
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  supportedOpCodes: {
    auth_signed_internal: string;
    auth_signed_external: string;
  };
}
