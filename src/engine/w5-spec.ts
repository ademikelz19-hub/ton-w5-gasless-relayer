/**
 * TON Wallet V5 (W5R1) Specification Constants & OpCodes
 */

export const W5_OPCODES = {
  /** Signed internal message opcode: 'sint' (0x73696e74 = 1936289396) */
  AUTH_SIGNED_INTERNAL: 0x73696e74,
  /** Signed external message opcode: 'sign' (0x7369676e = 1936287598) */
  AUTH_SIGNED_EXTERNAL: 0x7369676e,
  /** Extension message opcode: 'extn' (0x6578746e = 1702392942) */
  AUTH_EXTENSION: 0x6578746e,
} as const;

export const NETWORK_GLOBAL_IDS = {
  MAINNET: -239,
  TESTNET: -3,
} as const;

export const W5_DEFAULTS = {
  WORKCHAIN: 0,
  SUBWALLET_NUMBER: 0,
  DEFAULT_TIMEOUT_SEC: 180, // 3 minutes
  SIGNATURE_BITS: 512,
  SIGNATURE_BYTES: 64,
  OPCODE_BITS: 32,
  WALLET_ID_BITS: 32,
  VALID_UNTIL_BITS: 32,
  SEQNO_BITS: 32,
  MAX_ACTIONS_COUNT: 255,
} as const;
