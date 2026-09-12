import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { RelayResponseError } from '../engine/types.js';

/**
 * IP-level rate limiting middleware.
 */
export const ipRateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Too many requests from this IP. Max ${config.RATE_LIMIT_MAX_REQUESTS} requests per ${config.RATE_LIMIT_WINDOW_MS / 1000}s.`,
    },
  } as RelayResponseError,
});

/**
 * In-memory per-wallet concurrent and velocity rate limiter.
 */
class WalletRateLimiter {
  private activePending = new Map<string, number>();
  private requestHistory = new Map<string, number[]>();

  public checkAndAcquire(walletAddress: string): { allowed: boolean; reason?: string } {
    const normalized = walletAddress.toLowerCase();
    const now = Date.now();

    // 1. Check active pending concurrency
    const currentPending = this.activePending.get(normalized) || 0;
    if (currentPending >= config.MAX_PENDING_PER_WALLET) {
      return {
        allowed: false,
        reason: `Wallet ${walletAddress} has reached maximum pending relay requests (${config.MAX_PENDING_PER_WALLET})`,
      };
    }

    // 2. Check velocity (sliding window)
    const timestamps = (this.requestHistory.get(normalized) || []).filter(
      (ts) => now - ts < config.RATE_LIMIT_WINDOW_MS
    );
    if (timestamps.length >= config.RATE_LIMIT_MAX_REQUESTS) {
      return {
        allowed: false,
        reason: `Wallet ${walletAddress} exceeded velocity limit of ${config.RATE_LIMIT_MAX_REQUESTS} requests per window`,
      };
    }

    // Increment
    this.activePending.set(normalized, currentPending + 1);
    timestamps.push(now);
    this.requestHistory.set(normalized, timestamps);

    return { allowed: true };
  }

  public release(walletAddress: string): void {
    const normalized = walletAddress.toLowerCase();
    const current = this.activePending.get(normalized) || 1;
    if (current <= 1) {
      this.activePending.delete(normalized);
    } else {
      this.activePending.set(normalized, current - 1);
    }
  }

  public reset(): void {
    this.activePending.clear();
    this.requestHistory.clear();
  }
}

export const walletRateLimiter = new WalletRateLimiter();

export function walletRateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const walletAddress = req.body?.userWalletAddress;
  if (!walletAddress || typeof walletAddress !== 'string') {
    next();
    return;
  }

  const { allowed, reason } = walletRateLimiter.checkAndAcquire(walletAddress);
  if (!allowed) {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: reason || 'Wallet rate limit exceeded',
      },
    } satisfies RelayResponseError);
    return;
  }

  // Ensure release when response finishes
  res.on('finish', () => {
    walletRateLimiter.release(walletAddress);
  });
  res.on('close', () => {
    walletRateLimiter.release(walletAddress);
  });

  next();
}
