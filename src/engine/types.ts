import { Cell, Address } from '@ton/core';
import { OutActionSendMsg } from '@ton/core';

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
  /** Correctly-decoded sendMsg out-actions from the signed payload (see engine/actions.ts).
   * Used for fee enforcement when FEE_MODE=jetton_fee. Empty if the action list couldn't
   * be decoded (treated as "no verifiable actions", not "skip verification"). */
  sendMsgActions: OutActionSendMsg[];
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
  /** How much TON gas the client is requesting the relayer sponsor for this specific
   * request, computed by W5PayloadBuilder.estimateRequiredGasTon based on the actual
   * action bundle. Falls back to config.MAX_GAS_PER_TX_TON server-side if omitted (older
   * SDK clients). Always validated against the operator's ceiling and an absolute hard
   * ceiling before use — see GasGuard.validateGasLimit. */
  requestedGasTon?: number;
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
  /** Honest broadcast status: 'simulated' when no RELAYER_MNEMONIC is configured (no real
   * on-chain effect occurred at all — previously this case reported confirmed:true, which
   * could be misread as a real confirmation), 'pending' when submitted but not yet
   * observed to land, 'confirmed' once the target wallet's seqno has actually advanced. */
  status: 'confirmed' | 'pending' | 'simulated';
  /** How much TON was actually sponsored for this request (may differ from the operator's
   * MAX_GAS_PER_TX_TON ceiling when the client requested less, or when older clients
   * didn't send requestedGasTon and the server default was used). */
  gasRequestedTon?: string;
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
