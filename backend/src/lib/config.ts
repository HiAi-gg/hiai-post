import { z } from 'zod';

const configSchema = z.object({
  // Database
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6383'),

  // Auth
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().default('http://localhost:50300'),
  OAUTH_STATE_SECRET: z.string().optional(),

  // Cross-service auth bridge (INT-POST): shared HS256 secret that hiai-admin
  // signs proxy tokens with. Optional — when set, the auth middleware accepts
  // admin-minted HS256 JWTs in addition to Better Auth session tokens.
  HIAI_ADMIN_JWT_SECRET: z.string().optional(),

  // hiai-store webhook auth: shared secret the store service sends in the
  // X-Webhook-Secret header when calling /api/v1/webhooks/store-product.
  // Optional — webhook receiver rejects all calls when unset.
  HIAI_STORE_WEBHOOK_SECRET: z.string().optional(),

  // Encryption
  TOKEN_ENCRYPTION_KEY: z.string().min(32),

  // Social Platform API Keys
  INSTAGRAM_APP_ID: z.string().default(''),
  INSTAGRAM_APP_SECRET: z.string().default(''),
  TIKTOK_CLIENT_KEY: z.string().default(''),
  TIKTOK_CLIENT_SECRET: z.string().default(''),
  X_CLIENT_ID: z.string().default(''),
  X_CLIENT_SECRET: z.string().default(''),
  LINKEDIN_CLIENT_ID: z.string().default(''),
  LINKEDIN_CLIENT_SECRET: z.string().default(''),
  META_APP_ID: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  THREADS_APP_ID: z.string().default(""),
  THREADS_APP_SECRET: z.string().default(""),
  PINTEREST_APP_ID: z.string().default(""),
  PINTEREST_APP_SECRET: z.string().default(""),
  YOUTUBE_CLIENT_ID: z.string().default(''),
  YOUTUBE_CLIENT_SECRET: z.string().default(''),
  TELEGRAM_BOT_TOKEN: z.string().default(''),

  // Mastra / LLM
  OPENROUTER_API_KEY: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),
  MASTRA_MODEL: z.string().default('openai/gpt-4o'),

  // Web search (Tavily) — optional; web-search tool falls back to empty results when unset
  TAVILY_API_KEY: z.string().default(''),

  // MinIO
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().default(9010),
  MINIO_ACCESS_KEY: z.string().default('admin'),
  MINIO_SECRET_KEY: z.string(),
  MINIO_BUCKET: z.string().default('hiai-post'),
  MINIO_USE_SSL: z.coerce.boolean().default(false),

  // Ports
  API_PORT: z.coerce.number().default(50300),
  FRONTEND_PORT: z.coerce.number().default(50301),

  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Observability
  SENTRY_DSN: z.string().default(''),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (_config) return _config;

  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:');
    console.error(result.error.format());
    process.exit(1);
  }
  _config = result.data;
  return _config;
}

export const config = new Proxy({} as Config, {
  get(_, prop: string) {
    return getConfig()[prop as keyof Config];
  },
});
