import { Cell, beginCell } from '@ton/core';
import { W5_OPCODES, W5_DEFAULTS, decodeWalletIdV5R1, NETWORK_GLOBAL_IDS } from './w5-spec.js';
import { W5ParsedPayload } from './types.js';

export class W5PayloadParser {
  /**
   * Parse a Base64-encoded BOC string or raw Cell into structured W5 internal_signed payload data.
   * Reconstructs the exact signing cell and computes its hash for cryptographic verification.
   */
  public static parse(
    payloadBocOrCell: string | Cell,
    networkGlobalId: number = NETWORK_GLOBAL_IDS.TESTNET
  ): W5ParsedPayload {
    const rawCell = typeof payloadBocOrCell === 'string'
      ? Cell.fromBase64(payloadBocOrCell)
      : payloadBocOrCell;

    const slice = rawCell.beginParse();

    if (slice.remainingBits < W5_DEFAULTS.OPCODE_BITS + W5_DEFAULTS.WALLET_ID_BITS + W5_DEFAULTS.VALID_UNTIL_BITS + W5_DEFAULTS.SEQNO_BITS + W5_DEFAULTS.SIGNATURE_BITS) {
      throw new Error(`Invalid W5 payload: insufficient bits in cell (${slice.remainingBits} bits available)`);
    }

    const totalBits = slice.remainingBits;
    const signingBitsCount = totalBits - W5_DEFAULTS.SIGNATURE_BITS;

    // Load the slice representing the signing payload
    const signingBits = slice.loadBits(signingBitsCount);
    
    // Load the trailing 512-bit (64-byte) Ed25519 signature
    const signature = slice.loadBuffer(W5_DEFAULTS.SIGNATURE_BYTES);

    // Reconstruct the exact cell that was signed
    const signingCellBuilder = beginCell().storeBits(signingBits);
    
    // Copy all references into the signing cell
    while (slice.remainingRefs > 0) {
      signingCellBuilder.storeRef(slice.loadRef());
    }

    const signingCell = signingCellBuilder.endCell();
    const signingHash = signingCell.hash();

    // Now inspect the header fields from the signing bits
    const headerSlice = signingCell.beginParse();
    const opcode = headerSlice.loadUint(W5_DEFAULTS.OPCODE_BITS);
    const opcodeHex = '0x' + opcode.toString(16);

    const isInternal = opcode === W5_OPCODES.AUTH_SIGNED_INTERNAL;
    const isExternal = opcode === W5_OPCODES.AUTH_SIGNED_EXTERNAL;

    if (!isInternal && !isExternal) {
      throw new Error(
        `Unsupported opcode in W5 payload: ${opcodeHex}. Expected W5 signed_internal (0x${W5_OPCODES.AUTH_SIGNED_INTERNAL.toString(16)}) or signed_external (0x${W5_OPCODES.AUTH_SIGNED_EXTERNAL.toString(16)})`
      );
    }

    const walletIdRaw = headerSlice.loadInt(W5_DEFAULTS.WALLET_ID_BITS);
    const validUntil = headerSlice.loadUint(W5_DEFAULTS.VALID_UNTIL_BITS);
    const seqno = headerSlice.loadUint(W5_DEFAULTS.SEQNO_BITS);

    // Dynamically decode the subwallet number and workchain from the wallet ID
    const decodedId = decodeWalletIdV5R1(walletIdRaw, networkGlobalId);

    // If there is a child reference, it contains the OutActions list
    const actionsListRef = signingCell.refs.length > 0 ? signingCell.refs[0] : undefined;

    return {
      opcode,
      opcodeHex,
      isInternal,
      walletIdRaw,
      subwalletNumber: decodedId.subwalletNumber,
      workChain: decodedId.workChain,
      validUntil,
      seqno,
      signature,
      signingCell,
      signingHash,
      rawCell,
      actionsListRef,
    };
  }
}
