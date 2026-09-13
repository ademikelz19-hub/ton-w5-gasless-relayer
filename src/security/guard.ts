import { config } from '../config.js';

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

export class ReplayGuard {
  private static store: IStateStore = defaultStateStore;

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
  private static store: IStateStore = defaultStateStore;

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
   */
  public static validateGasLimit(gasTon: number): { valid: boolean; reason?: string } {
    if (gasTon <= 0) {
      return { valid: false, reason: 'Gas amount must be greater than zero' };
    }
    if (gasTon > config.MAX_GAS_PER_TX_TON) {
      return {
        valid: false,
        reason: `Requested gas (${gasTon} TON) exceeds maximum allowable limit (${config.MAX_GAS_PER_TX_TON} TON)`,
      };
    }
    return { valid: true };
  }
}
