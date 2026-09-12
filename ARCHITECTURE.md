# Architecture: Non-Custodial TON W5 Gasless Relayer Infrastructure

## 1. Executive Summary & Problem Statement

The Open Network (TON) ecosystem has reached unprecedented user velocity via Telegram Mini Apps and tap-to-earn games. However, a major user experience bottleneck impedes mainstream decentralized finance (DeFi) and commerce: **the gas fee requirement**.

A new user receiving USDT (a Jetton) cannot transfer it or swap it without first acquiring native Toncoin (TON) to pay network transaction fees. This requires navigating fiat on-ramps, centralized exchanges, or asking another user for gas.

The **TON Wallet V5 (W5R1)** smart contract standard solves this through account abstraction, specifically **signed internal messages** (`internal_signed`). This repository implements a production-grade, non-custodial **Gasless Relayer Engine** and **Telegram Mini App SDK** that allows users to sign transactions locally while an off-chain relayer sponsors the native TON gas.

---

## 2. System Architecture & Component Diagram

```
+-----------------------------------------------------------------------------------+
|                            TELEGRAM MINI APP / CLIENT                             |
|                                                                                   |
|  +---------------------------+             +-----------------------------------+  |
|  | User UI / Payment Action  | ----------> | @ton-gasless/w5-relayer SDK       |  |
|  +---------------------------+             +-----------------------------------+  |
|                                                              |                    |
|                                                              v                    |
|                                            +-----------------------------------+  |
|                                            | W5 Payload Builder                |  |
|                                            | - Target: OutList (e.g. Jetton)   |  |
|                                            | - Nonce (seqno) & valid_until     |  |
|                                            | - Sign with Private Key/TonConnect|  |
|                                            +-----------------------------------+  |
+--------------------------------------------------------------|--------------------+
                                                               | POST /relay (JSON + BOC)
                                                               v
+-----------------------------------------------------------------------------------+
|                                RELAYER API SERVER                                 |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | Security & Anti-Abuse Gateway (Phase 3)                                     |  |
|  | - IP Rate Limiter (express-rate-limit)                                      |  |
|  | - Wallet Rate Limiter (max concurrent requests)                             |  |
|  | - Payload Sanitizer (max BOC size, base64 regex, schema validation)         |  |
|  +-----------------------------------------------------------------------------+  |
|                                      |                                            |
|                                      v                                            |
|  +-----------------------------------------------------------------------------+  |
|  | Relayer Core Engine (Phase 2)                                               |  |
|  | - TVM Cell Deserializer & Opcode Checker (0x7369676e: signed_internal)        |  |
|  | - Off-chain Ed25519 Cryptographic Signature Verification                    |  |
|  | - Expiration Validation (valid_until > now + driftBuffer)                   |  |
|  | - On-chain Seqno Verification (prevents replay attacks)                     |  |
|  | - Gas Estimation & Max Gas Cap Check                                        |  |
|  +-----------------------------------------------------------------------------+  |
|                                      |                                            |
|                                      v                                            |
|  +-----------------------------------------------------------------------------+  |
|  | Transaction Broadcaster                                                     |  |
|  | - Relayer Hot Wallet (signs external message from relayer)                  |  |
|  | - Attaches gas (e.g., 0.05 TON) to internal message                         |  |
|  | - Forwards user's signed payload to User's W5 Contract Address             |  |
|  +-----------------------------------------------------------------------------+  |
+--------------------------------------|--------------------------------------------+
                                       | Broadcast via TonClient / LiteClient
                                       v
+-----------------------------------------------------------------------------------+
|                                  TON TESTNET                                      |
|                                                                                   |
|  +-----------------------------+           +-----------------------------------+  |
|  | Relayer Wallet Account      | --------> | User's W5 Wallet Contract         |  |
|  | (Pays gas for execution)    |  internal | (Verifies signature, runs actions)|  |
|  +-----------------------------+  message  +-----------------------------------+  |
|                                                              |                    |
|                                                              v (e.g. Jetton xfer) |
|                                            +-----------------------------------+  |
|                                            | Target Contract (USDT Master/DEX) |  |
|                                            +-----------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 3. Data Flow Specification

### Step 1: Client Payload Construction
1. The Telegram Mini App identifies that the user desires to execute an action (e.g., send 10 USDT to a friend).
2. The Mini App calls the SDK:
   ```typescript
   const payload = await client.buildGaslessTransfer({
     userWalletAddress,
     userPublicKey,
     actions: [
       // OutAction: send Jetton transfer message
     ],
     validUntil: Math.floor(Date.now() / 1000) + 300, // 5 min TTL
   });
   ```
3. The SDK queries the current `seqno` of the user's W5 wallet from the network or Relayer `/config`.
4. The SDK constructs the **signed_internal root cell**:
   - `wallet_id` (32 bits)
   - `valid_until` (32 bits)
   - `seqno` (32 bits)
   - `op` / actions (OutList reference)
5. The user's wallet signs the cell hash using Ed25519 (yielding a 512-bit / 64-byte signature).
6. The complete W5 internal message body is formatted:
   - Opcode: `0x7369676e` (32-bit unsigned int: 1936289646)
   - Signature: 512 bits
   - Signed root cell (subwallet_id, valid_until, seqno, actions)

### Step 2: Relayer Verification Pipeline
Before touching the blockchain, the Relayer runs a multi-layered verification pipeline:
1. **Pre-flight Sanitization**: Reject oversized inputs, invalid Base64, or missing fields.
2. **Rate Limiting**: Block IPs exceeding quota (e.g., 20 req/min) or wallets with pending requests.
3. **Cell Deserialization**: Deserialize the Base64 string into a TVM Cell.
4. **Opcode & Structure Check**: Verify that the message begins with `0x7369676e`.
5. **Timestamp Validation**: Verify `valid_until > Date.now() / 1000 + 10s`.
6. **Cryptographic Verification**:
   - Extract the 512-bit signature slice.
   - Extract the remaining signed payload slice.
   - Reconstruct the signed cell and compute its hash (`cell.hash()`).
   - Run `signVerify(hash, signature, userPublicKey)`.
   - **If invalid: reject with HTTP 400 immediately, protecting the relayer from gas expenditure.**
7. **Replay Protection**:
   - Check local in-memory lock for `(userAddress, seqno)`.
   - Query TON Testnet RPC for user's on-chain `seqno`.
   - Ensure `payload.seqno === onChainSeqno`.

### Step 3: Testnet Broadcast
1. The relayer loads its hot wallet (`WalletContractV4R2` or `WalletContractV5R1`) from environment credentials.
2. The relayer creates an internal message:
   - `to`: User's W5 wallet address.
   - `value`: Sponsoring gas amount (e.g. `0.05 TON`).
   - `body`: The verified user W5 signed internal payload.
3. The relayer wallet signs and sends this transaction to TON Testnet.
4. The user's W5 wallet receives the message, verifies the signature against its stored pubkey, verifies the seqno, increments seqno, and executes the outgoing actions (e.g., Jetton transfer).
5. The relayer returns the transaction status and hash to the Telegram Mini App.

---

## 4. W5 Cell Layout & TVM Encoding

The W5 smart contract internal message layout adheres to:

```
[Cell: Internal Message Body]
  |-- bits:
  |     - opcode: 32 bits (0x7369676e)
  |     - signature: 512 bits (64 bytes ed25519)
  |-- slice or ref: [Signed Payload Cell]
        |-- bits:
        |     - wallet_id: 32 bits
        |     - valid_until: 32 bits
        |     - seqno: 32 bits
        |-- refs / actions:
              - out_actions (List of actions: send_msg, add_extension, etc.)
```

---

## 5. Security & Threat Model

| Threat | Attack Vector | Relayer Defense Mechanism |
| :--- | :--- | :--- |
| **Gas Draining Attack** | Attacker floods relayer with forged transactions. | Off-chain Ed25519 cryptographic check drops invalid signatures before broadcasting or allocating gas. |
| **Replay Attack** | Attacker intercepts a valid signed payload and resubmits it repeatedly. | Strict `seqno` verification against on-chain contract state + short TTL `valid_until`. |
| **DDoS / Spam** | Botnet spams `/relay` endpoint with garbage. | Two-tier IP and wallet rate limiting (`express-rate-limit` + memory lock). |
| **Oversized Cell Bomb** | Attacker submits deeply nested or cyclical BOCs to exhaust server memory. | Strict BOC byte length limit (max 4KB) and depth validation. |
| **Relayer Key Leak** | Private key exposed in code. | Keys loaded exclusively via environment variables (`.env`), validated at startup with Zod. |
