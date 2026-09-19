# TON Foundation Grant Application: W5 Gasless Relayer Infrastructure

**Project Name:** TON W5 Gasless Relayer & Telegram Mini App SDK  
**Track:** Core Infrastructure & Developer Tooling / Simplified DeFi  
**Target Tier:** Contenders ($30,000 – $50,000) with Champion Scalability Pathway  
**Open Source License:** MIT  
**GitHub Repository:** [https://github.com/ademikelz19-hub/ton-w5-gasless-relayer](https://github.com/ademikelz19-hub/ton-w5-gasless-relayer)  
**Live On-Chain Testnet Verification:** [https://testnet.tonviewer.com/transaction/b1b0b6066433bd9b647da6aa6a8e3851b3a0078ab1267d1e73ea341d6582203f](https://testnet.tonviewer.com/transaction/b1b0b6066433bd9b647da6aa6a8e3851b3a0078ab1267d1e73ea341d6582203f)  

---

## 1. Executive Summary & Problem Statement

The Open Network (TON) has successfully scaled to over 900 million Telegram users and over $830 million in circulating USDT. However, mainstream onboarding faces a critical structural barrier: **The Zero-TON Paradox**.

A new or non-crypto user who receives USDT or an in-game Jetton cannot transfer, spend, or swap it because the blockchain requires native Toncoin (TON) to pay validator gas fees. Forcing non-technical users to leave Telegram, register on centralized exchanges, undergo KYC, and buy volatile TON coins leads to catastrophic conversion drop-off (>80% cart abandonment).

While the **TON Wallet V5 (W5R1)** standard introduced native account abstraction via signed internal messages (`auth_signed_internal`, opcode `0x73696e74`), the ecosystem severely lacks open-source, non-custodial, enterprise-grade **off-chain relayer infrastructure** that any Telegram Mini App developer can deploy.

This project delivers a production-ready, open-source **W5 Gasless Relayer Server and Developer SDK** enabling true zero-gas user onboarding with dual-mode economics (pure sponsorship and self-sustaining Jetton fee recovery).

---

## 2. Technical Architecture & Innovation

### 2.1 The W5 Relayer Engine
- **TVM Bitstream Deserialization:** Robust parsing of W5 Bag of Cells (BOC) according to the official TVM cell tree specification.
- **Fail-Closed Replay Protection:** Queries contract sequence numbers on-chain with exponential backoff and jitter, failing closed with HTTP 502 on RPC errors to guarantee transactions can never be replayed during node network turbulence.
- **Dynamic Subwallet Resolution:** Automatically decodes `subwalletNumber` and `workChain` directly from the payload's `walletIdRaw` via `decodeWalletIdV5R1`, supporting all standard and custom W5 deployments without false-positive signature rejections.
- **Real On-Chain Confirmation:** Returns verified block execution transactions and logical time (`lt`) via `waitForConfirmation`.

### 2.2 Enterprise Security Suite
- **GasGuard:** Active pipeline validation enforcing strict operator ceilings and preventing runaway gas allocation.
- **TreasuryGuard:** Tracks cumulative daily gas spend against `DAILY_TREASURY_LIMIT_TON`, automatically halting sponsorships if Sybil botnets attempt treasury drainage.
- **Pluggable State Store (`IStateStore`):** Memory store for standalone setups and an atomic Redis adapter (`SET NX PX` and Lua check-and-increment scripts) for multi-instance distributed clusters.
- **Pre-flight Sanitizer & Rate Limiter:** Dual-tier IP and per-wallet rate limiting dropping oversized (>4KB) and malformed payloads off-chain before network requests are initiated.

### 2.3 Self-Sustaining Jetton Fee Recovery (Economic Moat)
In addition to sponsored paymaster mode, the SDK supports **Fee Recovery Mode**:
- Automatically bundles a secondary TEP-74 Jetton transfer in the W5 multi-action list to reimburse the relayer in USDT.
- The server inspects the decoded OutList using `@ton/core`'s `loadOutList` and enforces that at least `MIN_JETTON_FEE_UNITS` is routed to `FEE_COLLECTOR_ADDRESS`, returning `402 MISSING_REQUIRED_FEE` if omitted.

---

## 3. Milestones, Deliverables & Budget Allocation

All grant tranches are strictly milestone-based and verifiable on-chain:

### Milestone 1: Core Engine, Security Gateway & Automated Test Suite
- **Status:** **Completed & Verified**
- **Deliverables:**
  - Full TypeScript W5 Relayer Server and `@ton-gasless/w5-relayer/sdk`.
  - 26 automated unit and security boundary tests (100% passing).
  - Live on-chain Testnet execution proof with 0-TON user account.
  - Interactive Visual Dashboard & Test Suite (`http://localhost:3000`).
- **Funding Request:** $15,000 (Gas treasury funding, node infrastructure, initial developer integration).

### Milestone 2: Production Mainnet Pilot & Telegram Mini App Integrations
- **Timeline:** 6 Weeks from Grant Approval
- **Deliverables:**
  - Deployment of high-availability, multi-region relayer clusters with Redis state persistence.
  - Integration with 3 live Telegram Mini Apps (e-commerce, gaming, and creator monetization bots).
  - SDK packaging on npm as `@ton-gasless/w5-relayer`.
  - Developer portal with 1-click API key generation and live gas telemetry dashboard.
- **Funding Request:** $20,000 (Cluster infrastructure, security audit, liquidity treasury for gas sponsorship).

### Milestone 3: Concentrated Liquidity DEX Auto-Swap for Fee Recycling
- **Timeline:** 8 Weeks following Milestone 2
- **Deliverables:**
  - Automated Jetton-to-TON rebalancing: Relayer automatically swaps accumulated USDT fees into native TON via DeDust / STON.fi liquidity pools to autonomously refill its hot wallet gas reserves.
  - TonConnect UI widget component for 1-line React / Vue integration in Telegram WebApps.
  - Full third-party smart contract security audit report.
- **Funding Request:** $15,000 (DEX routing contracts, audit completion, ecosystem expansion).

**Total Funding Request:** **$50,000**

---

## 4. Key Performance Indicators (KPIs)

1. **Transaction Volume:** Process over 250,000 gasless transactions across partner Mini Apps within 90 days of Mainnet launch.
2. **Onboarding Conversion:** Demonstrate a $\ge$ 45% increase in first-time user transaction completion for partner Mini Apps compared to traditional gas models.
3. **Developer Adoption:** Onboard 20+ active Telegram Mini App development teams using the open-source SDK.
4. **Treasury Efficiency:** Maintain $>99.9\%$ relayer uptime with $<0.001\%$ failed transaction rate and zero treasury drain incidents.

---

## 5. Team & Community Commitment

- **Commitment to Open Source:** All core libraries, SDKs, and documentation are permanently licensed under MIT.
- **Ecosystem Integration:** Active support in official TON Dev Telegram chats, documentation tutorials for Tact/FunC developers, and public community workshops.
