import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Address, toNano } from '@ton/core';
import { keyPairFromSeed } from '@ton/crypto';
import { W5PayloadBuilder } from '../src/sdk/builder.js';
import { TonW5RelayerClient } from '../src/sdk/client.js';
import { createRelayerServer } from '../src/server.js';
import { W5PayloadParser } from '../src/engine/parser.js';
import { W5_OPCODES } from '../src/engine/w5-spec.js';

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

test('SDK - W5PayloadBuilder builds and signs valid internal payload', async () => {
  const kp = await keyPairFromSeed(Buffer.alloc(32, 7));

  const result = await W5PayloadBuilder.buildAndSign(
    {
      publicKey: kp.publicKey,
      seqno: 0,
      recipient: 'EQBdUltQlfyFQf9dg7K7eyFD4mWURM8hOgVQqMOq9tEGUSEk',
      amountTon: '0.01',
      comment: 'sdk-test',
    },
    kp.secretKey
  );

  assert.ok(result.payloadBoc);
  assert.ok(result.walletAddress);

  const parsed = W5PayloadParser.parse(result.payloadBoc);
  assert.equal(parsed.opcode, W5_OPCODES.AUTH_SIGNED_INTERNAL);
  assert.equal(parsed.seqno, 0);
});

test('SDK & Server Roundtrip - Client submits gasless payload to relayer server', async () => {
  const app = createRelayerServer();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const relayerUrl = `http://localhost:${port}`;

  try {
    const client = new TonW5RelayerClient({ relayerUrl });

    // 1. Test /config
    const configData = await client.getConfig();
    assert.ok(configData.supportedOpCodes.auth_signed_internal);
    assert.equal(configData.network, 'testnet');

    // 2. Test /estimate-gas
    const gasEst = await client.estimateGas(1);
    assert.ok(parseFloat(gasEst.estimatedGasTon) > 0);

    // 3. Test full gasless transfer submission
    const kp = await keyPairFromSeed(Buffer.alloc(32, 8));
    const relayResult = await client.sendGaslessTransfer({
      publicKey: kp.publicKey,
      seqno: 0,
      recipient: 'EQBdUltQlfyFQf9dg7K7eyFD4mWURM8hOgVQqMOq9tEGUSEk',
      amountTon: '0.01',
      signer: kp.secretKey,
    });

    assert.equal(relayResult.success, true);
    assert.ok(relayResult.txHash);
    assert.match(relayResult.explorerUrl, /testnet\.tonviewer\.com/);
  } finally {
    server.close();
  }
});
