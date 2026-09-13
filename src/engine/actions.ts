import { Cell, Slice, Address, loadOutList, OutActionSendMsg } from '@ton/core';

/** TEP-74 standard jetton transfer opcode. */
export const JETTON_TRANSFER_OPCODE = 0x0f8a7ea5;

export interface DecodedJettonTransfer {
  jettonAmount: bigint;
  recipient: Address;
}

/**
 * Decodes the "basic" (sendMsg) out-actions from a W5-signed payload, reading the EXACT
 * bitstream layout @ton/ton's WalletContractV5R1 uses when building a transfer
 * (WalletV5R1Actions.storeOutListExtendedV5R1):
 *
 *   maybe_ref(basic_actions) . extended_action_present:bit . [extended actions...]
 *
 * Previously this codebase captured `signingCell.refs[0]` as "the action list" without
 * reading the actual maybe-ref bit first — which happens to work only by coincidence for
 * payloads with exactly one ref used exactly this way, and silently breaks (or points at
 * the wrong cell) the moment that assumption doesn't hold. Reading the bit first and using
 * @ton/core's own public `loadOutList` to decode the resulting cell means this uses the
 * same decode path the real wallet contract's semantics are built on, not a guess.
 *
 * `slice` must be positioned immediately after the `seqno` field (i.e. right where the
 * parser currently is after reading opcode+wallet_id+valid_until+seqno).
 */
export function decodeBasicSendMsgActions(slice: Slice): OutActionSendMsg[] {
  const hasBasicActions = slice.loadBit();
  if (!hasBasicActions) {
    return [];
  }
  const packedRef = slice.loadRef();
  const actions = loadOutList(packedRef.beginParse());
  return actions.filter((a): a is OutActionSendMsg => a.type === 'sendMsg');
}

/**
 * Decode a jetton-transfer (TEP-74 op 0x0f8a7ea5) message body. This matches exactly the
 * layout `W5PayloadBuilder.createJettonTransferMessage` produces (including the
 * intentionally simplified custom_payload/forward_payload handling that helper uses) —
 * it is meant to decode payloads this SDK itself builds, not to be a fully general TEP-74
 * parser for arbitrary third-party message bodies.
 */
export function tryDecodeJettonTransferBody(body: Cell): DecodedJettonTransfer | null {
  try {
    const slice = body.beginParse();
    const op = slice.loadUint(32);
    if (op !== JETTON_TRANSFER_OPCODE) {
      return null;
    }
    slice.loadUint(64); // query_id — not needed for fee verification
    const jettonAmount = slice.loadCoins();
    const recipient = slice.loadAddress();
    return { jettonAmount, recipient };
  } catch {
    return null;
  }
}

/**
 * Find all jetton-transfer actions in a decoded action list whose recipient matches
 * `expectedRecipient`, returning their amounts. Used to verify a required relayer fee is
 * actually present in a signed payload, rather than trusting the client to have included
 * it (which was previously not checked at all — see MISSING_REQUIRED_FEE in server.ts).
 */
export function findJettonTransfersTo(
  sendMsgActions: OutActionSendMsg[],
  expectedRecipient: Address
): DecodedJettonTransfer[] {
  const matches: DecodedJettonTransfer[] = [];
  for (const action of sendMsgActions) {
    const decoded = tryDecodeJettonTransferBody(action.outMsg.body);
    if (decoded && decoded.recipient.equals(expectedRecipient)) {
      matches.push(decoded);
    }
  }
  return matches;
}
