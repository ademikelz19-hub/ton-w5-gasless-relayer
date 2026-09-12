import { config } from '../config.js';

export class ReplayGuard {
  private static inFlightNonces = new Map<string, number>();

  private static makeKey(userAddress: string, seqno: number): string {
    return `${userAddress.toLowerCase()}:${seqno}`;
  }

  /**
   * Acquire a lock on a (wallet, seqno) pair.
   * Returns false if the nonce is already in flight.
   */
  public static acquireLock(userAddress: string, seqno: number, ttlMs: number = 60000): boolean {
    const key = this.makeKey(userAddress, seqno);
    const now = Date.now();
    const existing = this.inFlightNonces.get(key);

    if (existing && now < existing) {
      return false; // Still locked
    }

    this.inFlightNonces.set(key, now + ttlMs);
    return true;
  }

  /**
   * Release the lock on a (wallet, seqno) pair.
   */
  public static releaseLock(userAddress: string, seqno: number): void {
    const key = this.makeKey(userAddress, seqno);
    this.inFlightNonces.delete(key);
  }

  /**
   * Clean up expired locks from memory.
   */
  public static sweep(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.inFlightNonces.entries()) {
      if (now >= expiresAt) {
        this.inFlightNonces.delete(key);
      }
    }
  }

  public static clear(): void {
    this.inFlightNonces.clear();
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
