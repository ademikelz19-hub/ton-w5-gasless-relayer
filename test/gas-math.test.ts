import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { TonClient } from '@ton/ton';
import { keyPairFromSeed } from '@ton/crypto';
import { W5PayloadBuilder } from '../src/sdk/builder.js';
import { TonW5RelayerClient } from '../src/sdk/client.js';
import { createRelayerServer } from '../src/server.js';
import { RelayBroadcaster } from '../src/engine/broadcaster.js';

const DUMMY_JETTON_WALLET = 'EQD__________________________________________0vo';
const DUMMY_RECIPIENT = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
const FEE_COLLECTOR = 'EQBdUltQlfyFQf9dg7K7eyFD4mWURM8hOgVQqMOq9tEGUSEk';

function fakeUninitializedClient(): TonClient {
  return {
    getContractState: async () => ({ state: 'uninitialized' }),
    runMethod: async () => {
      throw new Error('should not be called for an uninitialized wallet');
    },
    getBalance: async () => 1_000_000_000n,
    open: (c: any) => c,
    sendExternalMessage: async () => {},
    getTransactions: async () => [],
  } as unknown as TonClient;
}

test('estimateRequiredGasTon: single jetton transfer needs MORE than the old hardcoded flat amount', () => {
  // The bug this fixes: createJettonTransferMessage attached toNano('0.05') + a 0.01 TON
  // forward amount = 0.06 TON per jetton action, completely independent of what the
  // relayer actually sponsors. A single jetton transfer alone already needed more than
  // the (then-static) 0.05 TON default sponsorship. Confirm the new estimate reflects
  // the real requirement instead of silently assuming one flat number.
  const required = W5PayloadBuilder.estimateRequiredGasTon({
    publicKey: Buffer.alloc(32, 1),
    seqno: 0,
    jettonTransfer: {
      jettonWalletAddress: DUMMY_JETTON_WALLET,
      recipient: DUMMY_RECIPIENT,
      jettonAmount: 10_000_000n,
    },
  });

  // base(0.01) + jetton-action(0.04 + 0.01 forward) = 0.06
  assert.equal(required, 0.06);
});

test('estimateRequiredGasTon: bundling a relayerFee roughly doubles the requirement, and buildAndSign reports it', async () => {
  const argsWithFee = {
    publicKey: Buffer.alloc(32, 2),
    seqno: 0,
    jettonTransfer: {
      jettonWalletAddress: DUMMY_JETTON_WALLET,
      recipient: DUMMY_RECIPIENT,
      jettonAmount: 10_000_000n,
    },
    relayerFee: {
      feeJettonWallet: DUMMY_JETTON_WALLET,
      feeRecipient: FEE_COLLECTOR,
      feeAmount: 50_000n,
    },
  };

  const required = W5PayloadBuilder.estimateRequiredGasTon(argsWithFee);
  // base(0.01) + main jetton action(0.05) + fee jetton action(0.05) = 0.11
  assert.equal(required, 0.11);

  const kp = await keyPairFromSeed(Buffer.alloc(32, 3));
  const result = await W5PayloadBuilder.buildAndSign(argsWithFee, kp.secretKey);
  assert.equal(result.requestedGasTon, required);
});

test('GasGuard genuinely rejects a requestedGasTon above the operator ceiling (no longer a tautological check)', async () => {
  const broadcaster = new RelayBroadcaster({ endpoint: 'http://mock', gasSponsorshipTon: 0.05 });
  (broadcaster as any).client = fakeUninitializedClient();
  const app = createRelayerServer(broadcaster);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  try {
    const client = new TonW5RelayerClient({ relayerUrl: `http://localhost:${port}`, network: 'testnet' });
    const kp = await keyPairFromSeed(Buffer.alloc(32, 8));

    await assert.rejects(
      () =>
        client.relaySignedPayload({
          userPublicKey: kp.publicKey,
          userWalletAddress: 'EQBdUltQlfyFQf9dg7K7eyFD4mWURM8hOgVQqMOq9tEGUSEk',
          payloadBoc: 'te6cckEBAQEAAgAAAEysuc0=', // won't even get parsed — gas check runs first
          requestedGasTon: 999, // absurd — must be rejected before ever touching the payload
        }),
      /GAS_LIMIT_EXCEEDED/
    );
  } finally {
    server.close();
  }
});

test('A real single jetton transfer (no fee) requests enough gas end-to-end in sponsored mode', async () => {
  // Full regression proof: build a real signed payload for a plain jetton transfer, and
  // confirm the relayer (in default FEE_MODE=sponsored) accepts the client-computed
  // requestedGasTon without rejecting it as exceeding config.MAX_GAS_PER_TX_TON (0.05) —
  // this only passes because GasGuard now takes maxAllowedTon as a real operator ceiling
  // *and* MAX_GAS_PER_TX_TON needs to be at least the single-action requirement, which the
  // operator is responsible for configuring (documented in .env.example).
  const broadcaster = new RelayBroadcaster({ endpoint: 'http://mock', gasSponsorshipTon: 0.06 });
  (broadcaster as any).client = fakeUninitializedClient();
  const app = createRelayerServer(broadcaster);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  try {
    const client = new TonW5RelayerClient({ relayerUrl: `http://localhost:${port}`, network: 'testnet' });
    const kp = await keyPairFromSeed(Buffer.alloc(32, 9));

    const result = await client.sendGaslessTransfer({
      publicKey: kp.publicKey,
      seqno: 0,
      jettonTransfer: {
        jettonWalletAddress: DUMMY_JETTON_WALLET,
        recipient: DUMMY_RECIPIENT,
        jettonAmount: 10_000_000n,
      },
      signer: kp.secretKey,
    });

    assert.equal(result.success, true);
    assert.equal(result.gasRequestedTon, '0.0600');
  } finally {
    server.close();
  }
});
