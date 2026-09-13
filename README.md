# TON W5 Gasless Relayer Server & Telegram Mini App SDK

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![TON](https://img.shields.io/badge/TON-Wallet--V5R1-0088cc.svg)](https://docs.ton.org)
[![Networks](https://img.shields.io/badge/Networks-Mainnet%20%7C%20Testnet-green.svg)](https://docs.ton.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/Tests-16%20Passing-brightgreen.svg)]()

An enterprise-grade, open-source, non-custodial **Gasless Relayer Engine** and **Telegram Mini App SDK** for The Open Network (TON). 

Built specifically to operationalize the **TON Wallet V5 (W5R1)** standard, this infrastructure allows Telegram Mini Apps and Web3 games to provide **true zero-gas user onboarding**—enabling users to send Jettons (such as USDT) or interact with smart contracts without possessing native Toncoin (TON) for gas fees.

---

## 🌟 The Problem: The Gas Dilemma for 1 Billion Telegram Users

While Telegram Mini Apps have driven massive wallet creation (over 40M+ wallets), a systemic adoption bottleneck persists:

> **The Zero-TON Paradox**: A new user who receives USDT or an in-game Jetton cannot transfer, swap, or spend it because every TON transaction requires native Toncoin to pay validator gas fees.

Forcing a non-technical user to purchase Toncoin on a centralized exchange, complete KYC, and transfer it to a self-custodial wallet introduces massive friction.

### The Solution: W5 `internal_signed` Account Abstraction

The **W5 (Wallet V5R1)** contract standard introduces native account abstraction on TON via **signed internal messages** (`auth_signed_internal`, opcode `0x73696e74`).

This repository provides the battle-tested off-chain infrastructure:
1. **Network-Neutral Relayer Server**: Supports both **TON Mainnet** and **TON Testnet**, accepts user-signed W5 payloads, validates signatures off-chain, sponsors native TON gas, and broadcasts internal transactions.
2. **Dual Economic Model**:
   - **Pure Sponsorship (Paymaster)**: The relayer sponsors 100% of gas fees for promotional or gasless user acquisition.
   - **Jetton Fee Recovery Mode**: The W5 multi-action list automatically routes a micro-fee in Jettons (e.g. 0.05 USDT) to the relayer's fee collector in the same transaction, making the relayer self-sustaining and profitable.
3. **Telegram Mini App SDK (`@ton-gasless/w5-relayer/sdk`)**: A lightweight client library allowing frontend developers to integrate gasless transactions with just **2 lines of setup**.
4. **Hardened Defense Suite**:
   - **Fail-Closed Replay Protection**: Contract `seqno` queries feature retry logic and fail closed on RPC errors to prevent replay attacks.
   - **TreasuryGuard**: Enforces hard aggregate daily spending caps to prevent wallet drainage.
   - **GasGuard**: Actively validates gas allocations on the request pipeline.
   - **Dynamic Subwallet Resolution**: Decodes custom `subwalletNumber` from W5 payload headers, supporting all valid W5 wallet deployments.
   - **Pluggable State Store**: `IStateStore` abstraction with in-memory default and Redis adapter capability.

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
| - (Optional) Adds Fee Tx  |                             |
| - Signs cell with User Key|                             |
+-------------+-------------+                             |
              |                                           |
              | 2. POST /relay { userAddress, payloadBoc }|
              +------------------------------------------>|
                                                          |
                                           [Pre-flight Verification]
                                           - App Attribution (X-API-Key)
                                           - IP & Wallet Velocity Limiter
                                           - Size & BOC Sanitization
                                           - Off-chain Ed25519 Verification
                                           - Dynamic Subwallet Resolution
                                           - GasGuard & TreasuryGuard Caps
                                           - Fail-Closed Seqno Check
                                                          |
                                                          | 3. Sponsoring Internal Message
                                                          |    (Attaches 0.05 TON Gas)
                                                          v
                                           +-----------------------------+
                                           |      TON MAINNET/TESTNET    |
                                           |                             |
                                           |  User's W5 Wallet Contract  |
                                           |  - Verifies signature       |
                                           |  - Action 1: Jetton to User |
                                           |  - Action 2: Fee to Relayer |
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
git clone https://github.com/ademikelz19-hub/ton-w5-gasless-relayer.git
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
TON_NETWORK=testnet  # or 'mainnet'
TON_ENDPOINT=https://testnet.toncenter.com/api/v2/jsonRPC

# Relayer Hot Wallet Seed Phrase (Funds gas for users)
# Leave empty for simulation / audit-only mode
RELAYER_MNEMONIC="word1 word2 ... word24"

# Security & Gas Limits
MAX_GAS_PER_TX_TON=0.05
MIN_RELAYER_BALANCE_TON=0.5
DAILY_TREASURY_LIMIT_TON=10.0

# Fee Recovery Configuration
FEE_MODE=sponsored   # 'sponsored' or 'jetton_fee'
FEE_COLLECTOR_ADDRESS=EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c

# App Authorization
REQUIRE_API_KEY=false
RELAYER_API_KEYS=app1_secret_key,app2_secret_key
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

---

## 🧪 Automated Testing

Run the full automated test suite (16 tests across all security and cryptographic layers):

```bash
npm run test
```

Test coverage includes:
- **`parser.test.ts`**: Validates W5 BOC parsing, opcode verification (`0x73696e74`), and cell reconstruction.
- **`verifier.test.ts`**: Tests Ed25519 cryptographic signatures, tampered payload rejection, expiration timestamps, dynamic non-zero subwallets, and fail-closed RPC outage behavior.
- **`security.test.ts`**: Tests wallet-level rate limiters, ReplayGuard nonce locks, GasGuard parameter boundaries, and TreasuryGuard daily spend caps.
- **`sdk.test.ts`**: Tests TEP-74 Jetton message building, Mainnet/Testnet address derivation, Jetton fee recovery action generation, and deterministic roundtrip HTTP submission.

---

## 📱 Telegram Mini App SDK Integration

Integrate gasless payments into any frontend or Telegram Mini App with **2 lines of setup**:

### 1. Initialize Client

```typescript
import { TonW5RelayerClient } from './src/sdk/index.js';

// Line 1: Initialize client pointing to your relayer (supports 'mainnet' and 'testnet')
const relayer = new TonW5RelayerClient({
  relayerUrl: 'https://relayer.my-app.io', // or http://localhost:3000
  network: 'mainnet',                      // or 'testnet'
  apiKey: 'my_app_api_key',               // optional app attribution
});
```

### 2. Send a Gasless Jetton (USDT) Transfer

```typescript
// Line 2: Build, sign, and broadcast in one call!
const result = await relayer.sendGaslessTransfer({
  publicKey: userPublicKey,
  seqno: currentWalletSeqno,
  jettonTransfer: {
    jettonWalletAddress: 'EQB_user_usdt_wallet_address...',
    recipient: 'EQB_friend_address...',
    jettonAmount: 10_000_000n, // 10 USDT (6 decimals)
    comment: 'Payment for dinner',
  },
  // Optional Fee Recovery: Reimburses the relayer in USDT directly
  relayerFee: {
    feeJettonWallet: 'EQB_user_usdt_wallet_address...',
    feeRecipient: 'EQB_relayer_fee_collector...',
    feeAmount: 50_000n, // 0.05 USDT fee
  },
  // Signer callback (supports TonConnect, Telegram WebApp wallet, or ed25519 secretKey)
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

**Request Headers:**
- `Content-Type: application/json`
- `X-API-Key: <key>` *(optional when REQUIRE_API_KEY=true)*

**Request Body:**
```json
{
  "userPublicKey": "dff3540ff07f681bc19cd4fc968a8acc2c7310af7f73e0ec4bfa5711dba3d04d",
  "userWalletAddress": "EQCFk1mDc0zMbEQ9cz5KrJ58cpWckL95Z81LNfzG70bf0c0V",
  "payloadBoc": "te6cckEBAwEAWgABc3NpbnT///8R////...==",
  "waitForConfirmation": false,
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
  "txHash": "8089c49e8daf5534fb72e3f0b4f346759428db48ff9141649d97b4707ca7106f",
  "userWalletAddress": "EQCFk1mDc0zMbEQ9cz5KrJ58cpWckL95Z81LNfzG70bf0c0V",
  "relayedAt": 1789264325,
  "seqno": 0,
  "validUntil": 1789264505,
  "gasSponsoredTon": "0.0500",
  "confirmed": false
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
| `SEQNO_MISMATCH` | Submitted seqno does not match contract sequence number. |
| `REPLAY_ATTACK_DETECTED` | Duplicate transaction seqno currently in-flight. |
| `RATE_LIMIT_EXCEEDED` | IP or wallet velocity limit reached. |
| `TREASURY_LIMIT_EXCEEDED` | Daily relayer gas sponsorship budget reached. |
| `UNAUTHORIZED_APP` | Missing or invalid X-API-Key header. |
| `RPC_ERROR` | Network/RPC timeout during on-chain verification (fails closed). |
| `INSUFFICIENT_RELAYER_BALANCE` | Relayer hot wallet balance dropped below safe threshold. |

### `GET /config`
Returns relayer public address, network, `networkGlobalId`, daily treasury limit, fee mode, and supported opcodes.

### `POST /estimate-gas`
Calculates estimated gas for a requested action count.

### `GET /health`
Returns relayer wallet balance, daily treasury spend metrics, and RPC connectivity status.

---

## 🛡️ Security Architecture & Anti-Drain Protections

1. **Off-Chain Signature Verification**:
   The relayer parses the W5 cell, reconstructs the exact signing root, and verifies the Ed25519 signature against the user's public key **before** making any network calls or attaching gas. Forged transactions are dropped with zero network cost.
2. **Fail-Closed Seqno Verification**:
   Queries live contract state with exponential backoff. If the RPC call fails, times out, or rate limits, the request **fails closed** (HTTP 502 `RPC_ERROR`), guaranteeing replay protection cannot be bypassed by attacking the node infrastructure.
3. **TreasuryGuard Budget Caps**:
   Daily aggregate gas spending is tracked and bounded. Even if an attacker spins up thousands of Sybil wallets, the maximum loss is bounded by `DAILY_TREASURY_LIMIT_TON`.
4. **Active GasGuard Validation**:
   Sponsorship gas limits are strictly validated on every inbound transaction pipeline.
5. **Dynamic Subwallet Decoding**:
   Deserializes `walletIdRaw` into its component subwallet number and workchain, preventing false-positive signature rejections on custom W5 accounts.
6. **Pluggable State Store (`IStateStore`)**:
   Enables seamless migration from in-memory locks to Redis for multi-instance load-balanced production clusters.

---

## 🏛️ TON Foundation Grant Alignment

This project directly fulfills the strategic imperatives established in **Blueprint 3: The W5 Relayer and Gasless Infrastructure Network**:

- **Public Good & Open Source**: Full MIT license with modular, extensible TypeScript architecture.
- **Architectural Mastery**: Directly integrates the TVM Actor Model, asynchronous message handling, and W5R1 cell schemas.
- **Economic Sustainability**: Solves the relayer paymaster dilemma with dual-mode operation (Sponsorship + Jetton Fee Recovery).

---

## 📄 License

MIT License. Copyright (c) 2026 TON Infrastructure Architects.
