import { createRelayerServer } from './server.js';
import { RelayBroadcaster } from './engine/broadcaster.js';
import { config } from './config.js';

async function main() {
  const broadcaster = new RelayBroadcaster({
    endpoint: config.TON_ENDPOINT,
    apiKey: config.TON_API_KEY,
    mnemonic: config.RELAYER_MNEMONIC,
    gasSponsorshipTon: config.MAX_GAS_PER_TX_TON,
  });

  await broadcaster.init();

  const app = createRelayerServer(broadcaster);

  app.listen(config.PORT, config.HOST, () => {
    console.log(`
🚀 TON W5 Gasless Relayer Server running!
📡 Network: ${config.TON_NETWORK} (${config.TON_ENDPOINT})
🌐 URL: http://${config.HOST}:${config.PORT}
⛽ Max Gas Sponsoring: ${config.MAX_GAS_PER_TX_TON} TON
🔐 Relayer Address: ${broadcaster.getRelayerAddress()}
    `);
  });
}

main().catch((err) => {
  console.error('Fatal error starting relayer server:', err);
  process.exit(1);
});
