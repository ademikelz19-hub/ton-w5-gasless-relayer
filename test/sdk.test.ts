import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Address, toNano } from '@ton/core';
import { keyPairFromSeed } from '@ton/crypto';
import { W5PayloadBuilder } from '../src/sdk/builder.js';
import { TonW5RelayerClient } from '../src/sdk/client.js';
import { createRelayerServer } from '../src/server.js';
import { W5PayloadParser } from '../src/engine/parser.js';
import { W5_OPCODES, NETWORK_GLOBAL_IDS } from '../src/engine/w5-spec.js';
import { RelayBroadcaster } from '../src/engine/broadcaster.js';

test('SDK - W5PayloadBuilder creates valid Jetton transfer message', () => {
  const dummySender = Address.parse('EQBdUltQlfyFQf9dg7K7eyFD4mWURM8hOgVQqMOq9tEGUSEk');
  const dummyRecipient = Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c');
  const dummyJettonWallet = Address.parse('EQD__________________________________________0vo');

  const msg = W5PayloadBuilder.createJettonTransferMessage(
    {
      jettonWalletAddress: dummyJettonWallet,
      recipient: dummyRecipient,
      jettonAmount: 1000000n, // 1 USDT (6 decimals)
      comment: 'Coffee payment',
    },
    dummySender
  );

  assert.ok(msg);
  const slice = msg.body.beginParse();
  const opcode = slice.loadUint(32);
  assert.equal(opcode, 0x0f8a7ea5); // TEP-74 op::transfer
});

test('SDK - W5PayloadBuilder supports Mainnet and Testnet network propagation', async () => {
  const kp = await keyPairFromSeed(Buffer.alloc(32, 11));

  // Testnet build
  const testnetResult = await W5PayloadBuilder.buildAndSign(
    {
      network: 'testnet',
      publicKey: kp.publicKey,
      seqno: 0,
      recipient: 'EQBdUltQlfyFQf9dg7K7eyFD4mWURM8hOgVQqMOq9tEGUSEk',
      amountTon: '0.01',
    },
    kp.secretKey
  );

  // Mainnet build
  const mainnetResult = await W5PayloadBuilder.buildAndSign(
    {
      network: 'mainnet',
      publicKey: kp.publicKey,
      seqno: 0,
      recipient: 'EQBdUltQlfyFQf9dg7K7eyFD4mWURM8hOgVQqMOq9tEGUSEk',
      amountTon: '0.01',
    },
    kp.secretKey
  );

  // Addresses must NOT have testnet-only flag on mainnet
  assert.ok(testnetResult.walletAddress.startsWith('kQ') || testnetResult.walletAddress.startsWith('0:'));
  assert.ok(mainnetResult.walletAddress.startsWith('EQ') || mainnetResult.walletAddress.startsWith('0:'));

  const parsedMainnet = W5PayloadParser.parse(mainnetResult.payloadBoc, NETWORK_GLOBAL_IDS.MAINNET);
  assert.equal(parsedMainnet.opcode, W5_OPCODES.AUTH_SIGNED_INTERNAL);
});

test('SDK - W5PayloadBuilder generates Jetton Fee Recovery action', async () => {
  const kp = await keyPairFromSeed(Buffer.alloc(32, 12));
  const dummyJettonWallet = new Address(0, Buffer.alloc(32, 1));
  const dummyRecipient = 'EQBdUltQlfyFQf9dg7K7eyFD4mWURM8hOgVQqMOq9tEGUSEk';
  const dummyFeeCollector = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';

  const result = await W5PayloadBuilder.buildAndSign(
    {
      publicKey: kp.publicKey,
      seqno: 0,
      jettonTransfer: {
        jettonWalletAddress: dummyJettonWallet,
        recipient: dummyRecipient,
        jettonAmount: 5000000n, // 5 USDT
      },
      relayerFee: {
        feeJettonWallet: dummyJettonWallet,
        feeRecipient: dummyFeeCollector,
        feeAmount: 50000n, // 0.05 USDT fee
      },
    },
    kp.secretKey
  );

  assert.ok(result.payloadBoc);
  const parsed = W5PayloadParser.parse(result.payloadBoc);
  assert.equal(parsed.opcode, W5_OPCODES.AUTH_SIGNED_INTERNAL);
  // Contains child references representing multiple out actions
  assert.ok(parsed.actionsListRef);
});

test('SDK & Server Roundtrip - Client submits gasless payload to relayer server with deterministic mock', async () => {
  // Mock Broadcaster with deterministic on-chain response
  const mockBroadcaster = new RelayBroadcaster({
    endpoint: 'http://mock-rpc',
    gasSponsorshipTon: 0.05,
  });

  // Inject mock TonClient into broadcaster
  (mockBroadcaster as any).client = {
    getContractState: async () => ({ state: 'uninitialized' }),
    runMethod: async () => ({ stack: { readNumber: () => 0 } }),
    getBalance: async () => 1000000000n,
  };

  const app = createRelayerServer(mockBroadcaster);
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const relayerUrl = `http://localhost:${port}`;

  try {
    const client = new TonW5RelayerClient({ relayerUrl, network: 'testnet' });

    // 1. Test /config
    const configData = await client.getConfig();
    assert.ok(configData.supportedOpCodes.auth_signed_internal);
    assert.equal(configData.network, 'testnet');

    // 2. Test /estimate-gas
    const gasEst = await client.estimateGas(1);
    assert.ok(parseFloat(gasEst.estimatedGasTon) > 0);

    // 3. Test full gasless transfer submission
    const kp = await keyPairFromSeed(Buffer.alloc(32, 13));
    const relayResult = await client.sendGaslessTransfer({
      publicKey: kp.publicKey,
      seqno: 0,
      recipient: 'EQBdUltQlfyFQf9dg7K7eyFD4mWURM8hOgVQqMOq9tEGUSEk',
      amountTon: '0.01',
      signer: kp.secretKey,
    });

    assert.equal(relayResult.success, true);
    assert.ok(relayResult.txHash);
    // No RELAYER_MNEMONIC in the test env — this must honestly say 'simulated' rather
    // than implying a real on-chain confirmation occurred (previously `confirmed: true`
    // was returned unconditionally in simulated mode).
    assert.equal(relayResult.status, 'simulated');
    assert.match(relayResult.explorerUrl, /testnet\.tonviewer\.com/);
  } finally {
    server.close();
  }
});
