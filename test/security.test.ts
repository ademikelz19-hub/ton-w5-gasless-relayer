import test from 'node:test';
import assert from 'node:assert/strict';
import { walletRateLimiter } from '../src/security/rate-limiter.js';
import { ReplayGuard, GasGuard } from '../src/security/guard.js';
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

test('Security - ReplayGuard prevents duplicate in-flight nonces', () => {
  ReplayGuard.clear();
  const user = 'EQBdUltQlfyFQf9dg7K7eyFD4mWURM8hOgVQqMOq9tEGUSEk';
  const seqno = 15;

  const firstLock = ReplayGuard.acquireLock(user, seqno);
  assert.equal(firstLock, true);

  // Duplicate seqno must be blocked
  const duplicateLock = ReplayGuard.acquireLock(user, seqno);
  assert.equal(duplicateLock, false);

  // Releasing lock allows subsequent lock
  ReplayGuard.releaseLock(user, seqno);
  const reacquireLock = ReplayGuard.acquireLock(user, seqno);
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
