// Minimal fixture: importing config.js should throw synchronously when FEE_MODE is
// 'jetton_fee' but FEE_COLLECTOR_ADDRESS is empty — see the startup guard in src/config.ts.
// Run via `npx tsx test/fixtures/bad-config-check.mjs` with the relevant env vars set; a
// non-zero exit confirms the guard fired.
await import('../../src/config.js');
console.log('config loaded without throwing — guard did NOT fire');
