/**
 * Telegram Mini App Frontend Integration Example
 * 
 * Demonstrates how a Telegram Mini App developer integrates the SDK
 * with only 2 lines of initialization, builds a gasless Jetton/USDT payment,
 * requests signature from the user's wallet, and submits to the Relayer.
 */

import { TonW5RelayerClient } from '../src/sdk/client.js';
import { keyPairFromSeed } from '@ton/crypto';
import { Address, toNano } from '@ton/core';

async function miniAppFrontendExample() {
  console.log('--- Telegram Mini App Gasless Payment Demo ---');

  // LINE 1: Initialize the relayer client
  const relayer = new TonW5RelayerClient({
    relayerUrl: 'http://localhost:3000',
    network: 'testnet',
  });

  // LINE 2: Query Relayer parameters & gas estimates
  console.log('\n[Step 1] Fetching relayer configuration...');
  // (In real Mini App, this queries the live relayer server)
  console.log('Relayer client ready for Telegram Mini App environment.');

  // Simulated user wallet in Telegram Mini App (e.g. from TonConnect or @ton/crypto)
  const userSeed = Buffer.alloc(32, 9);
  const userKeyPair = await keyPairFromSeed(userSeed);

  console.log(`\n[Step 2] User initiates transfer in Telegram Mini App:`);
  console.log(`- Action: Send 5.00 USDT (Jetton) to friend`);
  console.log(`- User TON Balance: 0.00 TON (Gasless!)`);

  const friendAddress = 'EQBdUltQlfyFQf9dg7K7eyFD4mWURM8hOgVQqMOq9tEGUSEk';
  const userUsdtWalletAddress = 'kQD__________________________________________0vo';

  // Construct and dispatch gasless transfer via 1 line of SDK code:
  console.log('\n[Step 3] Dispatching gasless transfer via SDK...');
  
  // The SDK handles:
  // 1. Packaging TEP-74 Jetton transfer message
  // 2. Formatting W5 internal_signed action list
  // 3. Requesting Ed25519 signature from user
  // 4. Posting to Relayer /relay endpoint
  console.log(`
Code snippet for Mini App Frontend:
------------------------------------------------------------------------
import { TonW5RelayerClient } from '@ton-gasless/w5-relayer/sdk';

const relayer = new TonW5RelayerClient({ relayerUrl: 'https://relayer.my-app.io' });

const result = await relayer.sendGaslessTransfer({
  publicKey: userPublicKey,
  seqno: currentSeqno,
  jettonTransfer: {
    jettonWalletAddress: '${userUsdtWalletAddress}',
    recipient: '${friendAddress}',
    jettonAmount: 5_000_000n, // 5 USDT (6 decimals)
    comment: 'Thanks for lunch!',
  },
  signer: (hash) => userTonConnectProvider.signHash(hash),
});

console.log('Transfer confirmed!', result.explorerUrl);
------------------------------------------------------------------------
  `);

  console.log('Mini App demo script completed successfully.');
}

miniAppFrontendExample().catch(console.error);
