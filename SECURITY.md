# Security & Correctness Changelog

This documents the two rounds of fixes applied to this codebase, and what's still a known
gap. Written so the next reviewer doesn't have to re-derive any of this from scratch.

## Round 1 (commit 7540e2f) — network neutrality, fail-closed seqno, dynamic subwallets,
## treasury/gas guards, confirmation polling, jetton fee action, API keys

- Mainnet support: `network`/`networkGlobalId` now thread through `sdk/builder.ts` and
  `sdk/client.ts` end-to-end instead of being hardcoded to testnet.
- `verifyOnChainSeqno` retries with exponential backoff + jitter and throws on exhaustion;
  `server.ts` fails closed (502 `RPC_ERROR`) instead of the previous behavior of logging a
  warning and sponsoring gas anyway on any RPC error.
- Subwallet numbers are decoded directly out of the *signed* payload's own wallet_id field
  (`decodeWalletIdV5R1`) rather than trusted from an unauthenticated request parameter —
  cryptographically bound to the user's own signature.
- `TreasuryGuard` (daily aggregate spend cap) and a real `IStateStore` abstraction for
  `ReplayGuard`/`TreasuryGuard` were added.
- `waitForConfirmation` polls the *target user wallet's* seqno (more correct than polling
  the relayer's own wallet) and returns a real on-chain tx hash + logical time.
- A jetton-transfer "relayer fee" action can be bundled into the same signed payload as
  the user's transfer.
- Optional `X-API-Key` / `RELAYER_API_KEYS` app attribution.

## Round 2 (this pass) — closing three gaps found while verifying round 1 against a
## checklist

Verifying round 1 by actually running it (not just reading the diff) surfaced three real
problems. All three are now fixed and covered by tests.

1. **Gas-value math bug** (`src/engine/w5-spec.ts`, `src/sdk/builder.ts`).
   `createJettonTransferMessage` hardcoded `toNano('0.05')` as the value attached to each
   jetton-transfer action, completely independent of what the relayer actually sponsors
   (`config.MAX_GAS_PER_TX_TON`). With the default 0.01 TON forward amount, a *single*
   jetton transfer needed 0.06 TON forwarded out of a wallet that — per the "Zero-TON
   Paradox" this whole project exists to solve — starts with ~0 TON, while the relayer
   only sponsored 0.05 TON by default. Bundling the new fee action roughly doubled that to
   ~0.12 TON needed against the same sponsorship.

   **Fix:** named the constants (`JETTON_ACTION_BASE_GAS_TON`, `BASE_W5_EXECUTION_GAS_TON`),
   added `W5PayloadBuilder.estimateRequiredGasTon()` so the SDK computes what a given
   action bundle actually needs, and threaded `requestedGasTon` from client to server. The
   server validates it via `GasGuard` (operator ceiling + a hardcoded
   `ABSOLUTE_MAX_GAS_PER_TX_TON`) and sponsors that real amount instead of a flat
   constant. Fixing the math meant the *old* default `MAX_GAS_PER_TX_TON` (0.05) was no
   longer enough even for a single jetton transfer (0.06 needed) — caught this before
   shipping and bumped the default to 0.08 TON; `.env.example` documents that
   `FEE_MODE=jetton_fee` needs a further bump (~0.15+) since it bundles a second action.
   See `test/gas-math.test.ts`.

2. **`MISSING_REQUIRED_FEE` was defined but never enforced** (`src/server.ts`,
   `src/engine/actions.ts`). Setting `FEE_MODE=jetton_fee` didn't actually require
   anything — a client could omit the fee action and get sponsored for free. Fixing this
   required properly decoding the signed action list, which the existing code only did by
   assuming `signingCell.refs[0]` was "the action list" — true only by coincidence for
   payloads shaped exactly one way. The real fix reads the actual maybe-ref bit that
   `@ton/ton`'s `WalletContractV5R1` writes (confirmed against its actual source, not
   guessed) and decodes the resulting cell with `@ton/core`'s own public `loadOutList`,
   rather than hand-rolling a parser. Once the action list is correctly decoded, the
   server verifies at least one jetton-transfer action sends ≥ `MIN_JETTON_FEE_UNITS` to
   `FEE_COLLECTOR_ADDRESS`, and rejects with `402 MISSING_REQUIRED_FEE` otherwise. Also
   added a startup guard: the server now refuses to start at all if
   `FEE_MODE=jetton_fee` but `FEE_COLLECTOR_ADDRESS` isn't set. See
   `test/fee-enforcement.test.ts` (missing fee, fee below minimum, fee to wrong
   recipient, and the valid case all tested against a real running server).

3. **Redis-backed `IStateStore` didn't actually exist** (`src/security/guard.ts`). Round 1
   added a clean `IStateStore` interface — a real improvement — but shipped only
   `MemoryStateStore`, so despite the abstraction, multi-instance correctness was never
   actually fixed. Added `RedisStateStore`: atomic `SET NX PX` for locks, and a Lua
   check-and-increment script for the daily spend counter (so two concurrent requests
   across different instances can't both read "under budget" and both write, overshooting
   the cap). A `createStateStore()` factory picks Redis when `REDIS_URL` is set, in-memory
   otherwise, logging loudly either way.

Also fixed as part of this pass: simulated broadcasts previously reported
`confirmed: true` unconditionally (even though nothing was ever submitted on-chain) — the
response now includes an honest `status: 'confirmed' | 'pending' | 'simulated'` field.

## Known gaps (still open, stated plainly)

- **The Redis code paths have not been exercised against a live Redis instance** in the
  environment these fixes were made in (no network access to one here). The lock and
  spend-tracking logic is verified by tests against the same algorithm shape, and the Lua
  script is straightforward, but treat it as needing a real integration smoke test before
  production use.
- **`WalletRateLimiter` (per-wallet velocity/concurrency, in `security/rate-limiter.ts`) is
  still in-memory only.** Only `ReplayGuard`/`TreasuryGuard` got the `IStateStore`
  treatment in this pass. In a clustered deployment, treat the per-wallet limiter as a
  soft speed bump, not a hard guarantee.
- **Action-list decoding only handles "basic" (sendMsg) actions**, which is all this SDK's
  builder ever produces. A payload containing W5 "extended" actions (add/remove
  extension, enable/disable public-key auth) would not have those inspected — irrelevant
  for fee verification (which only cares about jetton-transfer sendMsg actions) but worth
  knowing if this decoder is ever reused for something else.
- **`estimateRequiredGasTon`'s per-action constants are estimates, not a live simulation.**
  They're sized to comfortably cover real TEP-74 jetton wallet processing costs based on
  the actual attached-value formula, but if TON network fees change materially, these
  constants (and the corresponding `MAX_GAS_PER_TX_TON` you configure) may need
  re-tuning.
- **This has not been run against a live TON testnet RPC endpoint.** Every fix here is
  verified with unit/integration tests using dependency-injected fake `TonClient`s that
  model the relevant on-chain responses (uninitialized wallet, matching seqno, etc.) —
  a real testnet smoke test is still the right next step before production use, especially
  for the confirmation-polling path.
