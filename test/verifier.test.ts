import test from 'node:test';
import assert from 'node:assert/strict';
import { Address } from '@ton/core';
import { keyPairFromSeed } from '@ton/crypto';
import { WalletContractV5R1, internal } from '@ton/ton';
import { W5PayloadParser } from '../src/engine/parser.js';
import { SignatureVerifier } from '../src/engine/verifier.js';

test('SignatureVerifier - validates genuine cryptographic signature', async () => {
  const kp = await keyPairFromSeed(Buffer.alloc(32, 2));
  const w5 = WalletContractV5R1.create({ publicKey: kp.publicKey });

  const timeout = Math.floor(Date.now() / 1000) + 300;
  const transfer = w5.createTransfer({
    seqno: 1,
    secretKey: kp.secretKey,
    timeout,
    sendMode: 3,
    messages: [
      internal({
        to: w5.address,
        value: '0.01',
        body: 'hello',
      }),
    ],
    authType: 'internal',
  });

  const parsed = W5PayloadParser.parse(transfer.toBoc().toString('base64'));
  const verification = SignatureVerifier.verifyCryptographicIntegrity(parsed, kp.publicKey);

  assert.equal(verification.isValid, true);
});

test('SignatureVerifier - rejects tampered or wrong public key', async () => {
  const kpUser = await keyPairFromSeed(Buffer.alloc(32, 3));
  const kpAttacker = await keyPairFromSeed(Buffer.alloc(32, 4));
  const w5 = WalletContractV5R1.create({ publicKey: kpUser.publicKey });

  const timeout = Math.floor(Date.now() / 1000) + 300;
  const transfer = w5.createTransfer({
    seqno: 1,
    secretKey: kpUser.secretKey,
    timeout,
    sendMode: 3,
    messages: [internal({ to: w5.address, value: '0.01', body: 'hello' })],
    authType: 'internal',
  });

  const parsed = W5PayloadParser.parse(transfer.toBoc().toString('base64'));
  // Verifying against attacker public key
  const verification = SignatureVerifier.verifyCryptographicIntegrity(parsed, kpAttacker.publicKey);

  assert.equal(verification.isValid, false);
  assert.equal(verification.errorCode, 'SIGNATURE_VERIFICATION_FAILED');
});

test('SignatureVerifier - rejects expired payloads', async () => {
  const kp = await keyPairFromSeed(Buffer.alloc(32, 5));
  const w5 = WalletContractV5R1.create({ publicKey: kp.publicKey });

  // Expired 100 seconds ago
  const expiredTimeout = Math.floor(Date.now() / 1000) - 100;
  const transfer = w5.createTransfer({
    seqno: 1,
    secretKey: kp.secretKey,
    timeout: expiredTimeout,
    sendMode: 3,
    messages: [internal({ to: w5.address, value: '0.01', body: 'hello' })],
    authType: 'internal',
  });

  const parsed = W5PayloadParser.parse(transfer.toBoc().toString('base64'));
  const verification = SignatureVerifier.verifyCryptographicIntegrity(parsed, kp.publicKey);

  assert.equal(verification.isValid, false);
  assert.equal(verification.errorCode, 'TRANSACTION_EXPIRED');
});

test('SignatureVerifier - verifies address ownership and public key normalization', async () => {
  const kp = await keyPairFromSeed(Buffer.alloc(32, 6));
  const w5 = WalletContractV5R1.create({ publicKey: kp.publicKey });

  const normalized = SignatureVerifier.normalizePublicKey(kp.publicKey.toString('hex'));
  assert.deepEqual(normalized, kp.publicKey);

  const isOwner = SignatureVerifier.verifyAddressOwnership(
    kp.publicKey,
    w5.address.toString()
  );
  assert.equal(isOwner, true);

  const fakeAddress = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
  const isFakeOwner = SignatureVerifier.verifyAddressOwnership(kp.publicKey, fakeAddress);
  assert.equal(isFakeOwner, false);
});

test('SignatureVerifier - supports dynamic non-zero subwallet IDs', async () => {
  const kp = await keyPairFromSeed(Buffer.alloc(32, 10));
  const customSubwalletNumber = 42;

  // Create W5 with custom subwallet
  const customW5 = WalletContractV5R1.create({
    publicKey: kp.publicKey,
    walletId: {
      networkGlobalId: -3,
      context: {
        workChain: 0,
        walletVersion: 'v5r1',
        subwalletNumber: customSubwalletNumber,
      },
    },
  });

  // Verify that SignatureVerifier correctly resolves and approves the non-zero subwallet
  const isCustomOwner = SignatureVerifier.verifyAddressOwnership(
    kp.publicKey,
    customW5.address.toString(),
    customSubwalletNumber,
    'testnet'
  );

  assert.equal(isCustomOwner, true);
});

test('SignatureVerifier - verifyOnChainSeqno fails closed on simulated RPC network crash', async () => {
  // Mock TonClient that simulates an RPC outage
  const mockCrashingClient: any = {
    getContractState: async () => {
      throw new Error('503 Service Unavailable: Rate limited / network down');
    },
  };

  const dummyAddress = Address.parse('EQBdUltQlfyFQf9dg7K7eyFD4mWURM8hOgVQqMOq9tEGUSEk');

  // Must reject and throw error, ensuring relayer fails closed
  await assert.rejects(
    async () => {
      await SignatureVerifier.verifyOnChainSeqno(mockCrashingClient, dummyAddress, 0, 1, 10);
    },
    (err: any) => {
      return err.message.includes('RPC communication error');
    }
  );
});
