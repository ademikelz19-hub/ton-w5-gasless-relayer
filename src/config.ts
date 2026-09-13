import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  
  TON_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  TON_ENDPOINT: z.string().default('https://testnet.toncenter.com/api/v2/jsonRPC'),
  TON_API_KEY: z.string().optional().default(''),
  
  RELAYER_MNEMONIC: z.string().optional().default(''),
  
  MAX_GAS_PER_TX_TON: z.coerce.number().default(0.08),
  MIN_RELAYER_BALANCE_TON: z.coerce.number().default(0.5),
  DAILY_TREASURY_LIMIT_TON: z.coerce.number().default(10.0),
  
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(30),
  MAX_PENDING_PER_WALLET: z.coerce.number().default(3),
  MAX_PAYLOAD_SIZE_BYTES: z.coerce.number().default(4096),

  // Treasury & App Attribution
  RELAYER_API_KEYS: z.string().optional().default(''),
  REQUIRE_API_KEY: z.coerce.boolean().default(false),

  // Fee model: pure sponsored paymaster vs jetton fee recovery
  FEE_MODE: z.enum(['sponsored', 'jetton_fee']).default('sponsored'),
  FEE_COLLECTOR_ADDRESS: z.string().optional().default(''),
  // Minimum jetton units required in a fee-collection action when FEE_MODE=jetton_fee.
  // Enforced server-side by decoding the signed action list — see MISSING_REQUIRED_FEE.
  MIN_JETTON_FEE_UNITS: z.string().default('50000'), // e.g. 0.05 USDT (6 decimals)

  // Confirmation polling
  WAIT_FOR_CONFIRMATION: z.coerce.boolean().default(false),
  CONFIRMATION_TIMEOUT_MS: z.coerce.number().default(30000),

  // Redis URL for distributed ReplayGuard/TreasuryGuard state (e.g. redis://localhost:6379).
  // Without this, both are process-local only — see security/guard.ts.
  REDIS_URL: z.string().optional().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  throw new Error('Environment configuration validation failed');
}

export const config = parsed.data;

if (config.FEE_MODE === 'jetton_fee' && !config.FEE_COLLECTOR_ADDRESS) {
  throw new Error(
    'Configuration error: FEE_MODE is "jetton_fee" but FEE_COLLECTOR_ADDRESS is not set. ' +
      'The relayer cannot enforce fee collection without knowing where fees should go.'
  );
}

export type Config = typeof config;
