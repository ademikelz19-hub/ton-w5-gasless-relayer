import express, { Request, Response } from 'express';
import cors from 'cors';
import { Address } from '@ton/core';
import { config } from './config.js';
import { W5_OPCODES, getNetworkGlobalId } from './engine/w5-spec.js';
import { W5PayloadParser } from './engine/parser.js';
import { SignatureVerifier } from './engine/verifier.js';
import { RelayBroadcaster } from './engine/broadcaster.js';
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
    // Base cost: ~0.025 TON for W5 execution + ~0.015 TON per attached outgoing action
    const estimatedGasTon = (0.025 + actionCount * 0.015).toFixed(4);

    res.json({
      estimatedGasTon,
      relayerSponsoringTon: config.MAX_GAS_PER_TX_TON.toFixed(4),
      minRelayerBalanceTon: config.MIN_RELAYER_BALANCE_TON.toFixed(4),
      isSponsored: config.FEE_MODE === 'sponsored',
      feeMode: config.FEE_MODE,
      requiredJettonFee: config.FEE_MODE === 'jetton_fee' ? '50000' : undefined, // 0.05 USDT
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
      const { userPublicKey, userWalletAddress, payloadBoc, waitForConfirmation } = req.body;

      try {
        // 0. Wire GasGuard: Active security check on gas sponsorship safety
        const gasLimitCheck = GasGuard.validateGasLimit(config.MAX_GAS_PER_TX_TON);
        if (!gasLimitCheck.valid) {
          return res.status(500).json({
            success: false,
            error: {
              code: 'GAS_LIMIT_EXCEEDED',
              message: gasLimitCheck.reason || 'Server gas limit configuration error',
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

        // 6. Treasury Guard: Check & reserve daily aggregate budget
        const budgetCheck = await TreasuryGuard.checkAndReserveBudget(config.MAX_GAS_PER_TX_TON);
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
            config.MAX_GAS_PER_TX_TON,
            shouldWait
          );

          return res.status(200).json({
            success: true,
            txHash: broadcastResult.txHash,
            logicalTime: broadcastResult.logicalTime,
            confirmed: broadcastResult.confirmed,
            userWalletAddress,
            relayedAt: Math.floor(Date.now() / 1000),
            seqno: parsedPayload.seqno,
            validUntil: parsedPayload.validUntil,
            gasSponsoredTon: broadcastResult.gasSponsoredTon,
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
