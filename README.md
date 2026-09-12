# TON W5 Gasless Relayer Server & Telegram Mini App SDK

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![TON](https://img.shields.io/badge/TON-Wallet--V5R1-0088cc.svg)](https://docs.ton.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/Tests-12%20Passing-brightgreen.svg)]()

An open-source, non-custodial **Gasless Relayer Engine** and **Telegram Mini App SDK** for The Open Network (TON). 

Built specifically to operationalize the **TON Wallet V5 (W5R1)** standard, this infrastructure enables Telegram Mini Apps and Web3 games to offer **true zero-gas user onboarding**—enabling users to send Jettons (such as USDT) or interact with smart contracts without possessing native Toncoin (TON) for gas fees.

---

## 🌟 The Problem: The Gas Friction in Telegram Onboarding

While Telegram Mini Apps have driven massive wallet creation (over 40M+ wallets), a systemic adoption bottleneck persists:

> **The Zero-TON Paradox**: A new user who receives USDT or an in-game Jetton cannot transfer, swap, or spend it because every TON transaction requires native Toncoin to pay validator gas fees.

Forcing a non-technical user to purchase Toncoin on a centralized exchange, complete KYC, and transfer it to a self-custodial wallet introduces high drop-off rates.

### The Solution: W5 `internal_signed` Account Abstraction

The **W5 (Wallet V5R1)** contract standard introduces native account abstraction on TON via **signed internal messages** (`auth_signed_internal`, opcode `0x73696e74`).

This repository provides the missing off-chain plumbing:
1. **Relayer API Server**: Accepts user-signed W5 payloads, validates signatures off-chain, sponsors native TON gas, and broadcasts the internal transaction to TON Testnet/Mainnet.
2. **Telegram Mini App SDK (`@ton-gasless/w5-relayer/sdk`)**: A lightweight client library allowing frontend developers to integrate gasless transactions with just **2 lines of setup**.
3. **Enterprise Defense Suite**: Anti-abuse rate limiting, off-chain cryptographic validation, and replay attack protection to prevent gas treasury drainage.

---

## 🏗️ Architecture & Data Flow

```
+---------------------------+              +-----------------------------+
|  Telegram Mini App User   |              |   Relayer API Server        |
|  (Holds USDT, 0 TON)      |              |   (Gas Treasury Hot Wallet) |
+-------------+-------------+              +--------------+--------------+
              |                                           |
              | 1. Request gasless transfer               |
              v                                           |
+---------------------------+                             |
| @ton-gasless/w5-relayer   |                             |
| Client SDK                |                             |
| - Builds W5 Action List   |                             |
| - Signs cell with User Key|                             |
+-------------+-------------+                             |
              |                                           |
              | 2. POST /relay { userAddress, payloadBoc }|
              +------------------------------------------>|
                                                          |
                                           [Pre-flight Verification]
                                           - IP & Wallet Rate Limiting
                                           - Size & BOC Sanitization
                                           - Off-chain Ed25519 Verification
                                           - Replay Nonce Locking
                                                          |
                                                          | 3. Sponsoring Internal Message
                                                          |    (Attaches 0.05 TON Gas)
                                                          v
                                           +-----------------------------+
                                           |         TON TESTNET         |
                                           |                             |
                                           |  User's W5 Wallet Contract  |
                                           |  - Verifies signature       |
                                           |  - Executes Jetton transfer |
                                           +-----------------------------+
```

See [ARCHITECTURE.md](file:///c:/Users/USER/Downloads/ton%20grant/ARCHITECTURE.md) for detailed TVM cell structures, opcode specifications, and security threat modeling.

---

## 🚀 Quickstart Guide

### Prerequisites
- Node.js >= 18.0.0 (Tested on Node.js v24)
- npm >= 9.0.0

### 1. Installation

```bash
git clone https://github.com/ton-infrastructure/ton-w5-gasless-relayer.git
cd ton-w5-gasless-relayer
npm install
```

### 2. Environment Configuration

Copy the example configuration file:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```ini
PORT=3000
TON_NETWORK=testnet
TON_ENDPOINT=https://testnet.toncenter.com/api/v2/jsonRPC

# Relayer Hot Wallet Seed Phrase (Funds gas for users)
# Leave empty for simulation / audit-only mode
RELAYER_MNEMONIC="word1 word2 ... word24"

# Security & Gas Limits
MAX_GAS_PER_TX_TON=0.05
MIN_RELAYER_BALANCE_TON=0.5
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=30
```

### 3. Build & Run the Relayer Server

```bash
# Build TypeScript to dist/
npm run build

# Start production server
npm start

# Or run in development mode with hot reload
npm run dev
```

### 4. Run Live Testnet Simulation

To see the complete end-to-end W5 gasless workflow in action:

```bash
npm run simulate
```

Output:
```
======================================================================
🚀 Starting TON W5 Gasless Relayer Testnet Simulation
======================================================================
[1/5] Generating User W5 Keypair...
👤 User W5 Address: kQC88bZot1Xj89hmiOOq_qfbZ8fgXzizsGCiFBTBEY9uikS0
[2/5] Constructing W5 internal_signed Gasless Transfer Payload...
📦 Payload BOC: 276 chars (TTL: 180s)
[3/5] Relayer Engine: Off-Chain Cryptographic Verification...
🔍 Opcode: 0x73696e74 (W5 auth_signed_internal)
✅ Off-chain Ed25519 signature verification: PASSED
✅ Address ownership check: PASSED
[4/5] Preparing Relayer Gas Sponsorship...
⛽ Sponsoring Gas Amount: 0.05 TON
[5/5] Broadcasting Internal Transaction to TON Testnet...
🎉 SIMULATION COMPLETED SUCCESSFULLY!
📝 Transaction Hash: f43c2f4206f5d8f818091ac9f8e2057f0a2ac3e67477827f64df35f60d844f00
🔗 Explorer: https://testnet.tonviewer.com/transaction/f43c2f4206f5...
```

---

## 🧪 Automated Testing

Run the full automated unit and roundtrip integration test suite:

```bash
npm run test
```

Test coverage includes:
- **`parser.test.ts`**: Validates W5 BOC parsing, opcode verification (`0x73696e74`), and cell reconstruction.
- **`verifier.test.ts`**: Tests Ed25519 cryptographic signatures, tampered payload rejection, expiration timestamps, and address ownership.
- **`security.test.ts`**: Tests wallet-level rate limiters, replay attack prevention locks, and gas expenditure bounds.
- **`sdk.test.ts`**: Tests TEP-74 Jetton message building, client payload creation, and live roundtrip HTTP submission.

---

## 📱 Telegram Mini App SDK Integration

Integrate gasless payments into any frontend or Telegram Mini App with **2 lines of setup**:

### 1. Initialize Client

```typescript
import { TonW5RelayerClient } from './src/sdk/index.js';

// Line 1: Initialize client pointing to your relayer
const relayer = new TonW5RelayerClient({
  relayerUrl: 'https://relayer.my-app.io', // or http://localhost:3000
  network: 'testnet',
});
```

### 2. Send a Gasless Jetton (USDT) Transfer

```typescript
// Line 2: Build, sign, and broadcast in one call!
const result = await relayer.sendGaslessTransfer({
  publicKey: userPublicKey,
  seqno: currentWalletSeqno,
  jettonTransfer: {
    jettonWalletAddress: 'kQD_user_usdt_wallet_address...',
    recipient: 'EQB_friend_address...',
    jettonAmount: 10_000_000n, // 10 USDT (6 decimals)
    comment: 'Payment for dinner',
  },
  // Signer callback (supports TonConnect or raw ed25519 secretKey)
  signer: async (signingHash) => {
    return await tonConnectProvider.signHash(signingHash);
  },
});

console.log('Transaction confirmed!');
console.log('Explorer URL:', result.explorerUrl);
```

---

## 🔌 API Reference

### `POST /relay`
Core endpoint to submit signed W5 payloads.

**Request Headers:** `Content-Type: application/json`

**Request Body:**
```json
{
  "userPublicKey": "dff3540ff07f681bc19cd4fc968a8acc2c7310af7f73e0ec4bfa5711dba3d04d",
  "userWalletAddress": "kQC88bZot1Xj89hmiOOq_qfbZ8fgXzizsGCiFBTBEY9uikS0",
  "payloadBoc": "te6cckEBAwEAWgABc3NpbnT///8R////...==",
  "metadata": {
    "appName": "TelegramShopMiniApp",
    "actionDescription": "Purchase in-game gems"
  }
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "txHash": "f43c2f4206f5d8f818091ac9f8e2057f0a2ac3e67477827f64df35f60d844f00",
  "userWalletAddress": "kQC88bZot1Xj89hmiOOq_qfbZ8fgXzizsGCiFBTBEY9uikS0",
  "relayedAt": 1789254676,
  "seqno": 0,
  "validUntil": 1789254856,
  "gasSponsoredTon": "0.0500"
}
```

**Error Codes:**
| Code | Description |
| :--- | :--- |
| `INVALID_REQUEST` | Missing or malformed parameters. |
| `PAYLOAD_TOO_LARGE` | Payload size exceeds 4KB limit. |
| `INVALID_BOC` | Malformed Base64 or cell deserialization error. |
| `SIGNATURE_VERIFICATION_FAILED` | Off-chain Ed25519 signature check failed. |
| `TRANSACTION_EXPIRED` | Payload timestamp `valid_until` has passed. |
| `REPLAY_ATTACK_DETECTED` | Duplicate transaction seqno currently in-flight. |
| `RATE_LIMIT_EXCEEDED` | IP or wallet velocity limit reached. |
| `INSUFFICIENT_RELAYER_BALANCE` | Relayer hot wallet balance dropped below safe threshold. |

### `GET /config`
Returns relayer address, network parameters, supported opcodes, and gas limits.

### `POST /estimate-gas`
Calculates estimated gas for a requested action count.

### `GET /health`
Returns relayer wallet balance and RPC connectivity status.

---

## 🛡️ Security Architecture & Anti-Drain Protections

To protect the relayer hot wallet from being drained by malicious actors or botnets, the engine employs a defense-in-depth model:

1. **Off-Chain Signature Verification**:
   The relayer parses the W5 cell, reconstructs the exact signing root, and verifies the Ed25519 signature against the user's public key **before** making any network calls or attaching gas. Forged transactions are rejected at zero network cost to the relayer.
2. **Replay & Concurrency Guards**:
   In-flight nonces are locked in memory (`userAddress:seqno`) to prevent double-spend or duplicate broadcasting race conditions.
3. **On-Chain Seqno Synchronization**:
   The engine checks the live on-chain state to ensure the payload's `seqno` matches the contract's expected sequence number.
4. **Dual-Tier Rate Limiting**:
   Protects against IP spam (`express-rate-limit`) and per-wallet velocity abuse.
5. **Zero Key Exposure**:
   Relayer hot wallet mnemonics are strictly loaded via environment variables and never logged or exposed in client bundles.

---

## 🏛️ TON Foundation Grant Alignment

This project directly fulfills the strategic imperatives established in **Blueprint 3: The W5 Relayer and Gasless Infrastructure Network**:

- **Public Good & Open Source**: Full MIT license with modular, extensible TypeScript architecture.
- **Architectural Mastery**: Directly integrates the TVM Actor Model, asynchronous message handling, and W5R1 cell schemas.
- **Economic Velocity**: Unlocks frictionless payment flows for USDT and Jettons across the Telegram ecosystem.

---

## 📄 License

MIT License. Copyright (c) 2026 TON Infrastructure Architects.
