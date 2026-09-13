import test from 'node:test';
import assert from 'node:assert/strict';
import { walletRateLimiter } from '../src/security/rate-limiter.js';
import { ReplayGuard, GasGuard, TreasuryGuard, MemoryStateStore } from '../src/security/guard.js';
import { config } from '../src/config.js';

test('Security - Wallet Rate Limiter enforces concurrent pending limit', () => {
  walletRateLimiter.reset();
  const testWallet = 'EQBdUltQlfyFQf9dg7K7eyFD4mWURM8hOgVQqMOq9tEGUSEk';

  // Acquire up to MAX_PENDING_PER_WALLET (default: 3)
  for (let i = 0; i < config.MAX_PENDING_PER_WALLET; i++) {
    const res = walletRateLimiter.checkAndAcquire(testWallet);
    assert.equal(res.allowed, true);
  }

  // 4th request must be rejected
  const blockedRes = walletRateLimiter.checkAndAcquire(testWallet);
  assert.equal(blockedRes.allowed, false);
  assert.match(blockedRes.reason || '', /maximum pending/);

  // Release one
  walletRateLimiter.release(testWallet);

  // Now should be allowed again
  const allowedRes = walletRateLimiter.checkAndAcquire(testWallet);
  assert.equal(allowedRes.allowed, true);
});

test('Security - ReplayGuard prevents duplicate in-flight nonces', async () => {
  ReplayGuard.clear();
  const user = 'EQBdUltQlfyFQf9dg7K7eyFD4mWURM8hOgVQqMOq9tEGUSEk';
  const seqno = 15;

  const firstLock = await ReplayGuard.acquireLock(user, seqno);
  assert.equal(firstLock, true);

  // Duplicate seqno must be blocked
  const duplicateLock = await ReplayGuard.acquireLock(user, seqno);
  assert.equal(duplicateLock, false);

  // Releasing lock allows subsequent lock
  await ReplayGuard.releaseLock(user, seqno);
  const reacquireLock = await ReplayGuard.acquireLock(user, seqno);
  assert.equal(reacquireLock, true);
});

test('Security - GasGuard validates gas limits', () => {
  const safeGas = GasGuard.validateGasLimit(0.04);
  assert.equal(safeGas.valid, true);

  const excessiveGas = GasGuard.validateGasLimit(10.0);
  assert.equal(excessiveGas.valid, false);
  assert.match(excessiveGas.reason || '', /exceeds maximum allowable/);

  const zeroGas = GasGuard.validateGasLimit(0);
  assert.equal(zeroGas.valid, false);
});

test('Security - TreasuryGuard enforces aggregate daily spend cap', async () => {
  const customStore = new MemoryStateStore();
  TreasuryGuard.setStore(customStore);

  // Spend up to daily limit
  const step = 2.0;
  const numSteps = Math.floor(config.DAILY_TREASURY_LIMIT_TON / step);

  for (let i = 0; i < numSteps; i++) {
    const res = await TreasuryGuard.checkAndReserveBudget(step);
    assert.equal(res.allowed, true);
  }

  // Attempting to spend beyond daily limit must be rejected
  const overflowRes = await TreasuryGuard.checkAndReserveBudget(10.0);
  assert.equal(overflowRes.allowed, false);
  assert.match(overflowRes.reason || '', /Daily treasury limit exceeded/);
});
