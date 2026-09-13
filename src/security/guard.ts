import Redis from 'ioredis';
import { config } from '../config.js';
import { ABSOLUTE_MAX_GAS_PER_TX_TON } from '../engine/w5-spec.js';

export interface IStateStore {
  acquireLock(key: string, ttlMs: number): Promise<boolean> | boolean;
  releaseLock(key: string): Promise<void> | void;
  recordSpend(amountTon: number): Promise<{ allowed: boolean; currentSpentTon: number }> | { allowed: boolean; currentSpentTon: number };
}

export class MemoryStateStore implements IStateStore {
  private locks = new Map<string, number>();
  private dailySpentTon = 0;
  private currentDay = new Date().toISOString().slice(0, 10);

  public acquireLock(key: string, ttlMs: number): boolean {
    const now = Date.now();
    const existing = this.locks.get(key);
    if (existing && now < existing) {
      return false;
    }
    this.locks.set(key, now + ttlMs);
    return true;
  }

  public releaseLock(key: string): void {
    this.locks.delete(key);
  }

  public recordSpend(amountTon: number): { allowed: boolean; currentSpentTon: number } {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDay) {
      this.currentDay = today;
      this.dailySpentTon = 0;
    }

    if (this.dailySpentTon + amountTon > config.DAILY_TREASURY_LIMIT_TON) {
      return { allowed: false, currentSpentTon: this.dailySpentTon };
    }

    this.dailySpentTon += amountTon;
    return { allowed: true, currentSpentTon: this.dailySpentTon };
  }

  public getDailySpent(): number {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDay) {
      this.currentDay = today;
      this.dailySpentTon = 0;
    }
    return this.dailySpentTon;
  }

  public clear(): void {
    this.locks.clear();
    this.dailySpentTon = 0;
  }
}

export const defaultStateStore = new MemoryStateStore();

/**
 * Redis-backed IStateStore. Previously this codebase defined the `IStateStore`
 * abstraction (a real improvement — it makes ReplayGuard/TreasuryGuard testable and
 * pluggable) but shipped only `MemoryStateStore`, so despite the clean interface,
 * multi-instance correctness was never actually fixed — every relayer replica still had
 * its own independent lock map and spend counter. This implementation closes that gap:
 * - Locks use an atomic `SET key val NX PX ttl`, the standard distributed-lock primitive.
 * - Daily spend uses a Lua script (atomic check-then-increment) keyed per UTC day, so two
 *   concurrent requests across two instances can't both slip through a partially-spent
 *   budget the way a naive GET-then-SET would allow.
 */
export class RedisStateStore implements IStateStore {
  private client: Redis;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
    this.client.on('error', (err) => {
      console.error('❌ Redis state store error:', err.message);
    });
  }

  public async acquireLock(key: string, ttlMs: number): Promise<boolean> {
    const result = await this.client.set(`w5-relay:lock:${key}`, '1', 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  public async releaseLock(key: string): Promise<void> {
    await this.client.del(`w5-relay:lock:${key}`);
  }

  public async recordSpend(amountTon: number): Promise<{ allowed: boolean; currentSpentTon: number }> {
    const dayKey = `w5-relay:treasury:${new Date().toISOString().slice(0, 10)}`;
    const secondsUntilMidnightUtc = Math.ceil(
      (Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate() + 1
      ) - Date.now()) / 1000
    );

    // Atomic check-then-increment: read current spend, refuse (without writing) if this
    // request would exceed the daily limit, otherwise commit the new total — all in one
    // round trip so two concurrent requests across different instances can't both read
    // "under budget" and both write, overshooting the limit.
    const result = (await this.client.eval(
      `
      local current = tonumber(redis.call('GET', KEYS[1]) or '0')
      local newVal = current + tonumber(ARGV[1])
      if newVal > tonumber(ARGV[2]) then
        return {0, current}
      end
      redis.call('SET', KEYS[1], tostring(newVal), 'EX', ARGV[3])
      return {1, newVal}
      `,
      1,
      dayKey,
      amountTon.toString(),
      config.DAILY_TREASURY_LIMIT_TON.toString(),
      secondsUntilMidnightUtc.toString()
    )) as [number, string];

    return { allowed: result[0] === 1, currentSpentTon: parseFloat(result[1]) };
  }

  public async getDailySpent(): Promise<number> {
    const dayKey = `w5-relay:treasury:${new Date().toISOString().slice(0, 10)}`;
    const val = await this.client.get(dayKey);
    return val ? parseFloat(val) : 0;
  }
}

/** Use Redis if REDIS_URL is configured, otherwise fall back to the in-memory store —
 * logged loudly either way, so a multi-instance deployment without REDIS_URL notices the
 * gap at startup instead of during an incident. */
export function createStateStore(): IStateStore {
  if (config.REDIS_URL && config.REDIS_URL.trim().length > 0) {
    console.log('🔒 ReplayGuard/TreasuryGuard: using Redis-backed distributed state store.');
    return new RedisStateStore(config.REDIS_URL);
  }
  console.warn(
    '⚠️  ReplayGuard/TreasuryGuard: REDIS_URL not set — using an in-process state store. ' +
      'Fine for a single instance; replay locks and the daily treasury budget will NOT be ' +
      'shared across multiple relayer instances/replicas. Set REDIS_URL in any clustered deployment.'
  );
  return defaultStateStore;
}

/** Shared default store instance — ReplayGuard and TreasuryGuard use the same store by
 * default (as the original design's shared `defaultStateStore` did), so tests/operators
 * swapping in a store via setStore() only need to reason about one instance unless they
 * deliberately want to split them. */
const sharedDefaultStore = createStateStore();

export class ReplayGuard {
  private static store: IStateStore = sharedDefaultStore;

  public static setStore(store: IStateStore) {
    this.store = store;
  }

  private static makeKey(userAddress: string, seqno: number): string {
    return `nonce:${userAddress.toLowerCase()}:${seqno}`;
  }

  public static async acquireLock(userAddress: string, seqno: number, ttlMs: number = 60000): Promise<boolean> {
    const key = this.makeKey(userAddress, seqno);
    return await this.store.acquireLock(key, ttlMs);
  }

  public static async releaseLock(userAddress: string, seqno: number): Promise<void> {
    const key = this.makeKey(userAddress, seqno);
    await this.store.releaseLock(key);
  }

  public static clear(): void {
    if ('clear' in this.store) {
      (this.store as any).clear();
    }
  }
}

export class TreasuryGuard {
  private static store: IStateStore = sharedDefaultStore;

  public static setStore(store: IStateStore) {
    this.store = store;
  }

  /**
   * Checks whether sponsoring the requested gas amount is within the global daily treasury budget.
   */
  public static async checkAndReserveBudget(gasTon: number): Promise<{ allowed: boolean; reason?: string }> {
    const res = await this.store.recordSpend(gasTon);
    if (!res.allowed) {
      return {
        allowed: false,
        reason: `Daily treasury limit exceeded (${res.currentSpentTon.toFixed(4)} / ${config.DAILY_TREASURY_LIMIT_TON} TON spent today)`,
      };
    }
    return { allowed: true };
  }

  public static getDailySpent(): number {
    if ('getDailySpent' in this.store) {
      return (this.store as any).getDailySpent();
    }
    return 0;
  }
}

export class GasGuard {
  /**
   * Validate that the requested gas sponsorship is within safety bounds.
   *
   * Previously this was always called as `validateGasLimit(config.MAX_GAS_PER_TX_TON)` —
   * i.e. comparing the operator's configured value against itself, which can never fail
   * except when misconfigured to <= 0. Now that the relayer accepts a per-request
   * `requestedGasTon` (see server.ts and sdk/builder.ts's estimateRequiredGasTon), this
   * actually validates a real, client-supplied, varying number against both the
   * operator's configured ceiling AND a hardcoded ABSOLUTE_MAX_GAS_PER_TX_TON that isn't
   * itself operator-configurable — so a misconfigured .env can't push sponsorship
   * arbitrarily high either.
   */
  public static validateGasLimit(
    gasTon: number,
    maxAllowedTon: number = config.MAX_GAS_PER_TX_TON
  ): { valid: boolean; reason?: string } {
    if (gasTon <= 0) {
      return { valid: false, reason: 'Gas amount must be greater than zero' };
    }
    if (gasTon > ABSOLUTE_MAX_GAS_PER_TX_TON) {
      return {
        valid: false,
        reason: `Requested gas (${gasTon} TON) exceeds maximum allowable limit (hard ceiling ${ABSOLUTE_MAX_GAS_PER_TX_TON} TON)`,
      };
    }
    if (gasTon > maxAllowedTon) {
      return {
        valid: false,
        reason: `Requested gas (${gasTon} TON) exceeds maximum allowable limit (${maxAllowedTon} TON)`,
      };
    }
    return { valid: true };
  }
}
