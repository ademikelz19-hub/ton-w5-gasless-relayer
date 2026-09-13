import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { keyPairFromSeed } from '@ton/crypto';
import type { TonClient } from '@ton/ton';

// IMPORTANT: config.ts reads process.env ONCE at module-load time and freezes the result
// (see src/config.ts). The env vars below must be set BEFORE the config-dependent modules
// are imported. tsx's CJS transform doesn't support top-level await, so instead of a
// top-level `await import(...)`, the dynamic imports happen inside a `before()` hook —
// registering that hook is synchronous and still runs strictly before any test body, so
// the ordering guarantee holds. Node's test runner runs each test FILE in its own process
// (verified empirically), so this only affects this file, not the rest of the suite.
process.env.FEE_MODE = 'jetton_fee';
process.env.FEE_COLLECTOR_ADDRESS = 'EQBdUltQlfyFQf9dg7K7eyFD4mWURM8hOgVQqMOq9tEGUSEk';
process.env.MIN_JETTON_FEE_UNITS = '50000';
process.env.MAX_GAS_PER_TX_TON = '0.15'; // enough for a jettonTransfer + relayerFee bundle

let TonW5RelayerClient: typeof import('../src/sdk/client.js').TonW5RelayerClient;
let createRelayerServer: typeof import('../src/server.js').createRelayerServer;
let RelayBroadcaster: typeof import('../src/engine/broadcaster.js').RelayBroadcaster;
let config: typeof import('../src/config.js').config;

before(async () => {
  ({ TonW5RelayerClient } = await import('../src/sdk/client.js'));
  ({ createRelayerServer } = await import('../src/server.js'));
  ({ RelayBroadcaster } = await import('../src/engine/broadcaster.js'));
  ({ config } = await import('../src/config.js'));
});

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

function makeServer() {
  const broadcaster = new RelayBroadcaster({
    endpoint: 'http://mock',
    gasSponsorshipTon: config.MAX_GAS_PER_TX_TON,
  });
  (broadcaster as any).client = fakeUninitializedClient();
  const app = createRelayerServer(broadcaster);
  return http.createServer(app);
}

test('sanity: FEE_MODE actually loaded as jetton_fee for this process', () => {
  assert.equal(config.FEE_MODE, 'jetton_fee');
  assert.equal(config.FEE_COLLECTOR_ADDRESS, FEE_COLLECTOR);
});

test('Server rejects a jetton transfer with no fee action attached (MISSING_REQUIRED_FEE)', async () => {
  const server = makeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  try {
    const client = new TonW5RelayerClient({ relayerUrl: `http://localhost:${port}`, network: 'testnet' });
    const kp = await keyPairFromSeed(Buffer.alloc(32, 4));

    await assert.rejects(
      () =>
        client.sendGaslessTransfer({
          publicKey: kp.publicKey,
          seqno: 0,
          jettonTransfer: {
            jettonWalletAddress: DUMMY_JETTON_WALLET,
            recipient: DUMMY_RECIPIENT,
            jettonAmount: 10_000_000n,
          },
          signer: kp.secretKey,
        }),
      /MISSING_REQUIRED_FEE/
    );
  } finally {
    server.close();
  }
});

test('Server accepts a jetton transfer WITH a valid fee action', async () => {
  const server = makeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  try {
    const client = new TonW5RelayerClient({ relayerUrl: `http://localhost:${port}`, network: 'testnet' });
    const kp = await keyPairFromSeed(Buffer.alloc(32, 5));

    const result = await client.sendGaslessTransfer({
      publicKey: kp.publicKey,
      seqno: 0,
      jettonTransfer: {
        jettonWalletAddress: DUMMY_JETTON_WALLET,
        recipient: DUMMY_RECIPIENT,
        jettonAmount: 10_000_000n,
      },
      relayerFee: {
        feeJettonWallet: DUMMY_JETTON_WALLET,
        feeRecipient: FEE_COLLECTOR,
        feeAmount: 50_000n, // exactly the configured minimum
      },
      signer: kp.secretKey,
    });

    assert.equal(result.success, true);
  } finally {
    server.close();
  }
});

test('Server rejects a fee action below the configured minimum', async () => {
  const server = makeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  try {
    const client = new TonW5RelayerClient({ relayerUrl: `http://localhost:${port}`, network: 'testnet' });
    const kp = await keyPairFromSeed(Buffer.alloc(32, 6));

    await assert.rejects(
      () =>
        client.sendGaslessTransfer({
          publicKey: kp.publicKey,
          seqno: 0,
          jettonTransfer: {
            jettonWalletAddress: DUMMY_JETTON_WALLET,
            recipient: DUMMY_RECIPIENT,
            jettonAmount: 10_000_000n,
          },
          relayerFee: {
            feeJettonWallet: DUMMY_JETTON_WALLET,
            feeRecipient: FEE_COLLECTOR,
            feeAmount: 1_000n, // below the 50000 minimum
          },
          signer: kp.secretKey,
        }),
      /MISSING_REQUIRED_FEE/
    );
  } finally {
    server.close();
  }
});

test('Server rejects a fee action sent to the wrong recipient', async () => {
  const server = makeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  try {
    const client = new TonW5RelayerClient({ relayerUrl: `http://localhost:${port}`, network: 'testnet' });
    const kp = await keyPairFromSeed(Buffer.alloc(32, 7));

    await assert.rejects(
      () =>
        client.sendGaslessTransfer({
          publicKey: kp.publicKey,
          seqno: 0,
          jettonTransfer: {
            jettonWalletAddress: DUMMY_JETTON_WALLET,
            recipient: DUMMY_RECIPIENT,
            jettonAmount: 10_000_000n,
          },
          relayerFee: {
            feeJettonWallet: DUMMY_JETTON_WALLET,
            feeRecipient: DUMMY_RECIPIENT, // NOT the configured fee collector
            feeAmount: 500_000n,
          },
          signer: kp.secretKey,
        }),
      /MISSING_REQUIRED_FEE/
    );
  } finally {
    server.close();
  }
});

test('Server refuses to start at all if FEE_MODE=jetton_fee but FEE_COLLECTOR_ADDRESS is unset', async () => {
  // This exercises config.ts's own startup guard directly, in a subprocess so it doesn't
  // tear down the config this file's other tests depend on.
  const { execFileSync } = await import('node:child_process');
  const path = await import('node:path');
  const scriptPath = path.resolve(process.cwd(), 'test/fixtures/bad-config-check.mjs');

  assert.throws(() => {
    execFileSync('npx', ['tsx', scriptPath], {
      env: { ...process.env, FEE_MODE: 'jetton_fee', FEE_COLLECTOR_ADDRESS: '' },
      stdio: 'pipe',
    });
  });
});
