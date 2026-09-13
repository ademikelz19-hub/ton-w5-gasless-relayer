import { beginCell } from '@ton/core';

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

export function getNetworkGlobalId(network: 'mainnet' | 'testnet'): number {
  return network === 'mainnet' ? NETWORK_GLOBAL_IDS.MAINNET : NETWORK_GLOBAL_IDS.TESTNET;
}

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

/**
 * Gas economics for jetton-transfer-style actions.
 *
 * BUG THIS FIXES: `createJettonTransferMessage` previously hardcoded `toNano('0.05')` as
 * the value attached to EACH jetton-transfer action it built, completely independent of
 * `config.MAX_GAS_PER_TX_TON` (the amount the relayer actually sponsors). With the default
 * forward amount of 0.01 TON, a single jetton transfer already needs 0.05 + 0.01 = 0.06 TON
 * forwarded out of a wallet that, by the "Zero-TON Paradox" premise this whole project
 * exists to solve, starts with ~0 TON — while the relayer only sponsors 0.05 TON by
 * default. That's a real shortfall even in the single-action case, and bundling a second
 * jetton-value-bearing action (e.g. a relayer fee) roughly doubles it to ~0.12 TON needed
 * against the same 0.05 TON sponsorship.
 *
 * Fix: name the constant, and give the SDK a way to compute how much gas a given action
 * bundle actually requires (see W5PayloadBuilder.estimateRequiredGasTon), so the amount
 * requested from — and validated by — the relayer scales with what's actually being sent,
 * instead of every request silently assuming exactly one action's worth of gas.
 */
export const JETTON_ACTION_BASE_GAS_TON = 0.04;
export const DEFAULT_FORWARD_TON_AMOUNT = 0.01;
/** Small fixed overhead for the W5 wallet's own action-list execution, independent of how
 * many jetton actions are bundled (covers compute/storage for processing the signed
 * message itself). */
export const BASE_W5_EXECUTION_GAS_TON = 0.01;

/**
 * Hard ceiling on per-transaction gas sponsorship, enforced in code independent of the
 * operator-configurable MAX_GAS_PER_TX_TON env var, so a misconfigured .env (or a client
 * requesting gas for an implausibly large action bundle) can't push sponsorship past a
 * sane absolute bound. Sized to comfortably cover a handful of bundled jetton actions
 * (each ~0.05 TON) plus execution overhead, not to be a realistic per-request amount.
 */
export const ABSOLUTE_MAX_GAS_PER_TX_TON = 0.5;

export interface DecodedWalletIdV5R1 {
  networkGlobalId: number;
  workChain: number;
  subwalletNumber: number;
  walletVersion: string;
}

/**
 * Decodes a 32-bit serialized W5 wallet ID without hardcoding subwallet numbers.
 */
export function decodeWalletIdV5R1(
  walletIdRaw: number,
  networkGlobalId: number = NETWORK_GLOBAL_IDS.TESTNET
): DecodedWalletIdV5R1 {
  try {
    const context = BigInt(walletIdRaw) ^ BigInt(networkGlobalId);
    const bitReader = beginCell().storeInt(context, 32).endCell().beginParse();
    const isClientContext = bitReader.loadUint(1);

    if (isClientContext === 1) {
      const workChain = bitReader.loadInt(8);
      const _version = bitReader.loadUint(8);
      const subwalletNumber = bitReader.loadUint(15);
      return {
        networkGlobalId,
        workChain,
        subwalletNumber,
        walletVersion: 'v5r1',
      };
    }
  } catch {
    // fallback
  }

  return {
    networkGlobalId,
    workChain: 0,
    subwalletNumber: 0,
    walletVersion: 'v5r1',
  };
}
