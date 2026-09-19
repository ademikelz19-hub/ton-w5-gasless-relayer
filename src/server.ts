import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { Address } from '@ton/core';
import { config } from './config.js';
import { W5_OPCODES, getNetworkGlobalId } from './engine/w5-spec.js';
import { W5PayloadParser } from './engine/parser.js';
import { SignatureVerifier } from './engine/verifier.js';
import { RelayBroadcaster } from './engine/broadcaster.js';
import { findJettonTransfersTo } from './engine/actions.js';
import {
  ipRateLimiter,
  walletRateLimitMiddleware,
  apiKeyAuthMiddleware,
} from './security/rate-limiter.js';
import { preFlightSanitizerMiddleware } from './security/sanitizer.js';
import { ReplayGuard, GasGuard, TreasuryGuard } from './security/guard.js';
import {
  RelayRequestBody,
  RelayResponseSuccess,
  RelayResponseError,
  RelayerConfigResponse,
  GasEstimationResponse,
} from './engine/types.js';

export function createRelayerServer(broadcaster?: RelayBroadcaster) {
  const app = express();

  const relayBroadcaster =
    broadcaster ||
    new RelayBroadcaster({
      endpoint: config.TON_ENDPOINT,
      apiKey: config.TON_API_KEY,
      mnemonic: config.RELAYER_MNEMONIC,
      gasSponsorshipTon: config.MAX_GAS_PER_TX_TON,
    });

  // Base Middlewares
  app.use(cors());
  app.use(express.json({ limit: '64kb' }));
  app.use(express.static(path.resolve(process.cwd(), 'public')));
  app.use(ipRateLimiter);
  app.use(apiKeyAuthMiddleware);

  /**
   * GET /health
   * Monitor relayer wallet balance and network connectivity
   */
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      const balance = await relayBroadcaster.getRelayerBalance();
      res.json({
        status: 'healthy',
        timestamp: Math.floor(Date.now() / 1000),
        network: config.TON_NETWORK,
        relayerAddress: relayBroadcaster.getRelayerAddress(),
        relayerBalanceTon: balance.balanceTon,
        minRequiredBalanceTon: config.MIN_RELAYER_BALANCE_TON,
        dailySpentTon: TreasuryGuard.getDailySpent().toFixed(4),
        dailyLimitTon: config.DAILY_TREASURY_LIMIT_TON,
        feeMode: config.FEE_MODE,
      });
    } catch (err: any) {
      res.status(503).json({
        status: 'unhealthy',
        error: err.message,
      });
    }
  });

  /**
   * GET /config
   * Public configuration parameters for SDK and client integration
   */
  app.get('/config', (_req: Request, res: Response<RelayerConfigResponse>) => {
    res.json({
      relayerAddress: relayBroadcaster.getRelayerAddress(),
      network: config.TON_NETWORK,
      networkGlobalId: getNetworkGlobalId(config.TON_NETWORK),
      maxGasPerTxTon: config.MAX_GAS_PER_TX_TON,
      minRelayerBalanceTon: config.MIN_RELAYER_BALANCE_TON,
      dailyTreasuryLimitTon: config.DAILY_TREASURY_LIMIT_TON,
      feeMode: config.FEE_MODE,
      feeCollectorAddress: config.FEE_COLLECTOR_ADDRESS || undefined,
      rateLimit: {
        windowMs: config.RATE_LIMIT_WINDOW_MS,
        maxRequests: config.RATE_LIMIT_MAX_REQUESTS,
      },
      supportedOpCodes: {
        auth_signed_internal: '0x' + W5_OPCODES.AUTH_SIGNED_INTERNAL.toString(16),
        auth_signed_external: '0x' + W5_OPCODES.AUTH_SIGNED_EXTERNAL.toString(16),
      },
    });
  });

  /**
   * POST /estimate-gas
   * Estimate the TON gas required for a W5 gasless transaction
   */
  app.post('/estimate-gas', (req: Request, res: Response<GasEstimationResponse>) => {
    const actionCount = Number(req.body?.actionCount) || 1;
    // Matches sdk/builder.ts's estimateRequiredGasTon: base execution overhead plus
    // per-jetton-action gas — previously this endpoint used an unrelated flat formula
    // that didn't match what createJettonTransferMessage actually attaches per action.
    const estimatedGasTon = (0.01 + actionCount * 0.05).toFixed(4);

    res.json({
      estimatedGasTon,
      relayerSponsoringTon: config.MAX_GAS_PER_TX_TON.toFixed(4),
      minRelayerBalanceTon: config.MIN_RELAYER_BALANCE_TON.toFixed(4),
      isSponsored: config.FEE_MODE === 'sponsored',
      feeMode: config.FEE_MODE,
      requiredJettonFee: config.FEE_MODE === 'jetton_fee' ? config.MIN_JETTON_FEE_UNITS : undefined,
    });
  });

  /**
   * POST /relay
   * Core relay endpoint: accepts signed W5 payloads, validates cryptographically, and broadcasts
   */
  app.post(
    '/relay',
    preFlightSanitizerMiddleware,
    walletRateLimitMiddleware,
    async (req: Request<{}, {}, RelayRequestBody>, res: Response) => {
      const { userPublicKey, userWalletAddress, payloadBoc, waitForConfirmation, requestedGasTon: rawRequestedGasTon } = req.body;

      try {
        // 0. Determine and validate the gas amount to sponsor for THIS request. Previously
        // this was always the static config.MAX_GAS_PER_TX_TON, which — see
        // JETTON_ACTION_BASE_GAS_TON's doc comment in w5-spec.ts — didn't actually cover
        // what a real jetton-transfer (let alone a jetton-transfer + fee bundle) needs.
        // The SDK now computes and sends a real per-request amount; older clients that
        // don't send one fall back to the configured default (single-action) amount.
        const requestedGasTon =
          typeof rawRequestedGasTon === 'number' && rawRequestedGasTon > 0
            ? rawRequestedGasTon
            : config.MAX_GAS_PER_TX_TON;

        const gasLimitCheck = GasGuard.validateGasLimit(requestedGasTon, config.MAX_GAS_PER_TX_TON);
        if (!gasLimitCheck.valid) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'GAS_LIMIT_EXCEEDED',
              message: gasLimitCheck.reason || 'Requested gas amount failed validation',
            },
          } satisfies RelayResponseError);
        }

        // 1. Parse W5 Payload with network context
        const networkGlobalId = getNetworkGlobalId(config.TON_NETWORK);
        let parsedPayload;
        try {
          parsedPayload = W5PayloadParser.parse(payloadBoc, networkGlobalId);
        } catch (err: any) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_BOC',
              message: `Failed to parse W5 payload: ${err.message}`,
            },
          } satisfies RelayResponseError);
        }

        // 2. Normalize and check Public Key
        let pubKeyBuffer: Buffer;
        try {
          pubKeyBuffer = SignatureVerifier.normalizePublicKey(userPublicKey);
        } catch (err: any) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_SIGNATURE',
              message: err.message,
            },
          } satisfies RelayResponseError);
        }

        // 3. Verify Address & Key Association (Dynamic subwallet resolution)
        const isOwner = SignatureVerifier.verifyAddressOwnership(
          pubKeyBuffer,
          userWalletAddress,
          parsedPayload.subwalletNumber,
          config.TON_NETWORK
        );
        if (!isOwner) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_SIGNATURE',
              message: `Provided userPublicKey does not correspond to userWalletAddress for W5R1 (subwallet: ${parsedPayload.subwalletNumber}, network: ${config.TON_NETWORK}).`,
            },
          } satisfies RelayResponseError);
        }

        // 4. Verify Cryptographic Integrity and Expiration off-chain
        const cryptoResult = SignatureVerifier.verifyCryptographicIntegrity(
          parsedPayload,
          pubKeyBuffer
        );
        if (!cryptoResult.isValid) {
          return res.status(400).json({
            success: false,
            error: {
              code: cryptoResult.errorCode || 'SIGNATURE_VERIFICATION_FAILED',
              message: cryptoResult.errorMessage || 'Cryptographic verification failed',
            },
          } satisfies RelayResponseError);
        }

        // 4.5. FEE_MODE enforcement — previously MISSING_REQUIRED_FEE was defined as an
        // error code but never thrown: a client could simply omit the relayerFee action
        // and get sponsored for free even with FEE_MODE=jetton_fee configured. This
        // decodes the ACTUAL signed action list (now that it's cryptographically
        // verified) and requires a jetton-transfer to the configured fee collector for at
        // least the configured minimum, or refuses the request outright.
        if (config.FEE_MODE === 'jetton_fee') {
          let feeCollector: Address;
          try {
            feeCollector = Address.parse(config.FEE_COLLECTOR_ADDRESS);
          } catch {
            return res.status(500).json({
              success: false,
              error: {
                code: 'INTERNAL_ERROR',
                message: 'Server misconfiguration: FEE_COLLECTOR_ADDRESS is not a valid TON address.',
              },
            } satisfies RelayResponseError);
          }

          const minFeeUnits = BigInt(config.MIN_JETTON_FEE_UNITS);
          const feeTransfers = findJettonTransfersTo(parsedPayload.sendMsgActions, feeCollector);
          const hasValidFee = feeTransfers.some((t) => t.jettonAmount >= minFeeUnits);

          if (!hasValidFee) {
            return res.status(402).json({
              success: false,
              error: {
                code: 'MISSING_REQUIRED_FEE',
                message: `FEE_MODE is 'jetton_fee': the signed payload must include a jetton-transfer action sending at least ${config.MIN_JETTON_FEE_UNITS} units to the configured fee collector (${config.FEE_COLLECTOR_ADDRESS}). None was found in this payload.`,
              },
            } satisfies RelayResponseError);
          }
        }

        // 5. In-flight Nonce Lock (Replay Protection)
        const lockAcquired = await ReplayGuard.acquireLock(userWalletAddress, parsedPayload.seqno);
        if (!lockAcquired) {
          return res.status(409).json({
            success: false,
            error: {
              code: 'REPLAY_ATTACK_DETECTED',
              message: `Transaction with seqno ${parsedPayload.seqno} for this wallet is already in flight.`,
            },
          } satisfies RelayResponseError);
        }

        // 6. Treasury Guard: Check & reserve daily aggregate budget (against the actual
        // requested amount, not always the static configured ceiling)
        const budgetCheck = await TreasuryGuard.checkAndReserveBudget(requestedGasTon);
        if (!budgetCheck.allowed) {
          await ReplayGuard.releaseLock(userWalletAddress, parsedPayload.seqno);
          return res.status(429).json({
            success: false,
            error: {
              code: 'TREASURY_LIMIT_EXCEEDED',
              message: budgetCheck.reason || 'Daily gas sponsorship treasury budget exhausted',
            },
          } satisfies RelayResponseError);
        }

        // 7. Verify On-Chain Seqno with strict FAIL-CLOSED policy
        try {
          const client = relayBroadcaster.getTonClient();
          const targetAddress = Address.parse(userWalletAddress);
          const seqnoResult = await SignatureVerifier.verifyOnChainSeqno(
            client,
            targetAddress,
            parsedPayload.seqno
          );

          if (!seqnoResult.isValid) {
            await ReplayGuard.releaseLock(userWalletAddress, parsedPayload.seqno);
            return res.status(400).json({
              success: false,
              error: {
                code: 'SEQNO_MISMATCH',
                message: seqnoResult.errorMessage || 'On-chain seqno check failed',
                details: { onChainSeqno: seqnoResult.onChainSeqno, payloadSeqno: parsedPayload.seqno },
              },
            } satisfies RelayResponseError);
          }
        } catch (err: any) {
          // FAIL CLOSED: Never silently proceed if RPC fails or is rate-limited!
          await ReplayGuard.releaseLock(userWalletAddress, parsedPayload.seqno);
          return res.status(502).json({
            success: false,
            error: {
              code: 'RPC_ERROR',
              message: `Failed to verify on-chain wallet state: ${err.message}. Transaction rejected to guarantee replay protection.`,
            },
          } satisfies RelayResponseError);
        }

        // 8. Sponsoring Gas & Broadcasting Transaction
        try {
          const shouldWait = waitForConfirmation ?? config.WAIT_FOR_CONFIRMATION;
          const broadcastResult = await relayBroadcaster.broadcastW5Internal(
            userWalletAddress,
            parsedPayload,
            requestedGasTon,
            shouldWait
          );

          const status: RelayResponseSuccess['status'] = broadcastResult.simulated
            ? 'simulated'
            : broadcastResult.confirmed
            ? 'confirmed'
            : 'pending';

          return res.status(200).json({
            success: true,
            txHash: broadcastResult.txHash,
            logicalTime: broadcastResult.logicalTime,
            confirmed: broadcastResult.confirmed,
            status,
            userWalletAddress,
            relayedAt: Math.floor(Date.now() / 1000),
            seqno: parsedPayload.seqno,
            validUntil: parsedPayload.validUntil,
            gasSponsoredTon: broadcastResult.gasSponsoredTon,
            gasRequestedTon: requestedGasTon.toFixed(4),
          } satisfies RelayResponseSuccess);
        } catch (err: any) {
          await ReplayGuard.releaseLock(userWalletAddress, parsedPayload.seqno);
          return res.status(500).json({
            success: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: `Failed to broadcast transaction: ${err.message}`,
            },
          } satisfies RelayResponseError);
        }
      } catch (err: any) {
        return res.status(500).json({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: `Unexpected server error: ${err.message}`,
          },
        } satisfies RelayResponseError);
      }
    }
  );

  return app;
}
