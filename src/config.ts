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
  
  MAX_GAS_PER_TX_TON: z.coerce.number().default(0.05),
  MIN_RELAYER_BALANCE_TON: z.coerce.number().default(0.5),
  
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(30),
  MAX_PENDING_PER_WALLET: z.coerce.number().default(3),
  MAX_PAYLOAD_SIZE_BYTES: z.coerce.number().default(4096),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  throw new Error('Environment configuration validation failed');
}

export const config = parsed.data;

export type Config = typeof config;
