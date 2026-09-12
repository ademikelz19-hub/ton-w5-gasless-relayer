/**
 * TON Testnet Simulation Script
 * Demonstrates a complete end-to-end gasless transfer:
 * 1. Generates a fresh W5 testnet wallet keypair.
 * 2. Prepares a W5 gasless internal_signed transaction.
 * 3. Verifies the cryptographic signature off-chain.
 * 4. Submits the payload to the Relayer engine.
 * 5. Prepares and broadcasts the gas-sponsored internal transaction to TON Testnet.
 */

import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV5R1 } from '@ton/ton';
import { W5PayloadBuilder } from '../src/sdk/builder.js';
import { W5PayloadParser } from '../src/engine/parser.js';
import { SignatureVerifier } from '../src/engine/verifier.js';
import { RelayBroadcaster } from '../src/engine/broadcaster.js';
import { config } from '../src/config.js';

async function runSimulation() {
  console.log('='.repeat(70));
  console.log('🚀 Starting TON W5 Gasless Relayer Testnet Simulation');
  console.log('='.repeat(70));

  // 1. Generate fresh test user credentials
  console.log('\n[1/5] Generating User W5 Keypair...');
  const userMnemonic = await mnemonicNew(24);
  const userKeyPair = await mnemonicToPrivateKey(userMnemonic);
  const userW5 = WalletContractV5R1.create({
    publicKey: userKeyPair.publicKey,
    walletId: {
      networkGlobalId: -3, // Testnet
      context: { workChain: 0, walletVersion: 'v5r1', subwalletNumber: 0 },
    },
  });

  const userAddress = userW5.address.toString({ testOnly: true });
  const pubKeyHex = userKeyPair.publicKey.toString('hex');
  console.log(`👤 User W5 Address: ${userAddress}`);
  console.log(`🔑 User Public Key: ${pubKeyHex}`);

  // 2. Build Gasless Payload using SDK Builder
  console.log('\n[2/5] Constructing W5 internal_signed Gasless Transfer Payload...');
  const recipientAddress = 'EQBdUltQlfyFQf9dg7K7eyFD4mWURM8hOgVQqMOq9tEGUSEk';
  const { payloadBoc, validUntil } = await W5PayloadBuilder.buildAndSign(
    {
      publicKey: userKeyPair.publicKey,
      seqno: 0,
      recipient: recipientAddress,
      amountTon: '0.01',
      comment: 'Gasless simulation transfer via Relayer',
    },
    userKeyPair.secretKey
  );

  console.log(`📦 Payload BOC (Base64 length): ${payloadBoc.length} chars`);
  console.log(`⏰ Expiration Timestamp: ${validUntil} (TTL: 180s)`);

  // 3. Relayer Off-Chain Cryptographic Verification
  console.log('\n[3/5] Relayer Engine: Off-Chain Cryptographic Verification...');
  const parsed = W5PayloadParser.parse(payloadBoc);
  console.log(`🔍 Opcode: ${parsed.opcodeHex} (W5 auth_signed_internal)`);
  console.log(`🔍 Seqno: ${parsed.seqno}`);
  console.log(`🔍 Signature: ${parsed.signature.toString('hex').slice(0, 32)}... [512 bits]`);

  const cryptoCheck = SignatureVerifier.verifyCryptographicIntegrity(
    parsed,
    userKeyPair.publicKey
  );
  if (!cryptoCheck.isValid) {
    throw new Error(`Verification failed: ${cryptoCheck.errorMessage}`);
  }
  console.log('✅ Off-chain Ed25519 signature verification: PASSED');

  const ownershipCheck = SignatureVerifier.verifyAddressOwnership(
    userKeyPair.publicKey,
    userAddress
  );
  if (!ownershipCheck) {
    throw new Error('Address ownership verification failed');
  }
  console.log('✅ Address ownership check: PASSED');

  // 4. Gas Sponsorship & Broadcaster Setup
  console.log('\n[4/5] Preparing Relayer Gas Sponsorship...');
  const broadcaster = new RelayBroadcaster({
    endpoint: config.TON_ENDPOINT,
    apiKey: config.TON_API_KEY,
    mnemonic: config.RELAYER_MNEMONIC,
    gasSponsorshipTon: config.MAX_GAS_PER_TX_TON,
  });

  await broadcaster.init();
  const balance = await broadcaster.getRelayerBalance();
  console.log(`⛽ Sponsoring Gas Amount: ${config.MAX_GAS_PER_TX_TON} TON`);
  console.log(`🏦 Relayer Hot Wallet Balance: ${balance.balanceTon} TON`);

  // 5. Broadcast Transaction
  console.log('\n[5/5] Broadcasting Internal Transaction to TON Testnet...');
  const broadcastResult = await broadcaster.broadcastW5Internal(
    userAddress,
    parsed,
    config.MAX_GAS_PER_TX_TON
  );

  console.log('\n' + '='.repeat(70));
  console.log('🎉 SIMULATION COMPLETED SUCCESSFULLY!');
  console.log('='.repeat(70));
  console.log(`📝 Transaction Hash: ${broadcastResult.txHash}`);
  console.log(`⛽ Gas Sponsored: ${broadcastResult.gasSponsoredTon} TON`);
  console.log(`📡 Mode: ${broadcastResult.simulated ? 'SIMULATED (No live mnemonic provided in .env)' : 'BROADCAST TO TESTNET'}`);
  console.log(`🔗 Explorer: https://testnet.tonviewer.com/transaction/${broadcastResult.txHash}`);
  console.log('='.repeat(70));
}

runSimulation().catch((err) => {
  console.error('❌ Simulation Error:', err);
  process.exit(1);
});
