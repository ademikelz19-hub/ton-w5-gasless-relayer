import test from 'node:test';
import assert from 'node:assert/strict';
import { keyPairFromSeed } from '@ton/crypto';
import { WalletContractV5R1, internal } from '@ton/ton';
import { W5PayloadParser } from '../src/engine/parser.js';
import { W5_OPCODES } from '../src/engine/w5-spec.js';

test('W5PayloadParser - parses valid W5 internal_signed payload', async () => {
  const kp = await keyPairFromSeed(Buffer.alloc(32, 1));
  const w5 = WalletContractV5R1.create({ publicKey: kp.publicKey });

  const timeout = Math.floor(Date.now() / 1000) + 300;
  const transfer = w5.createTransfer({
    seqno: 42,
    secretKey: kp.secretKey,
    timeout,
    sendMode: 3,
    messages: [
      internal({
        to: w5.address,
        value: '0.05',
        body: 'test-message',
      }),
    ],
    authType: 'internal',
  });

  const boc = transfer.toBoc().toString('base64');
  const parsed = W5PayloadParser.parse(boc);

  assert.equal(parsed.opcode, W5_OPCODES.AUTH_SIGNED_INTERNAL);
  assert.equal(parsed.opcodeHex, '0x73696e74');
  assert.equal(parsed.isInternal, true);
  assert.equal(parsed.seqno, 42);
  assert.equal(parsed.validUntil, timeout);
  assert.equal(parsed.signature.length, 64);
  assert.ok(parsed.signingHash.length === 32);
});

test('W5PayloadParser - throws on malformed or truncated cell', () => {
  assert.throws(() => {
    W5PayloadParser.parse('invalid-base-64-boc');
  });
});
