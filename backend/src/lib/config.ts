import { z } from "zod";

const configSchema = z.object({
  // Database
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default("redis://localhost:6383"),

  // Auth
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().default("http://localhost:50300"),
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
  INSTAGRAM_APP_ID: z.string().default(""),
  INSTAGRAM_APP_SECRET: z.string().default(""),
  TIKTOK_CLIENT_KEY: z.string().default(""),
  TIKTOK_CLIENT_SECRET: z.string().default(""),
  X_CLIENT_ID: z.string().default(""),
  X_CLIENT_SECRET: z.string().default(""),
  LINKEDIN_CLIENT_ID: z.string().default(""),
  LINKEDIN_CLIENT_SECRET: z.string().default(""),
  META_APP_ID: z.string().default(""),
  META_APP_SECRET: z.string().default(""),
  THREADS_APP_ID: z.string().default(""),
  THREADS_APP_SECRET: z.string().default(""),
  PINTEREST_APP_ID: z.string().default(""),
  PINTEREST_APP_SECRET: z.string().default(""),
  YOUTUBE_CLIENT_ID: z.string().default(""),
  YOUTUBE_CLIENT_SECRET: z.string().default(""),
  TELEGRAM_BOT_TOKEN: z.string().default(""),

  // Mastra / LLM
  OPENROUTER_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  MASTRA_MODEL: z.string().default("openai/gpt-4o"),

  // Web search (Tavily) — optional; web-search tool falls back to empty results when unset
  TAVILY_API_KEY: z.string().default(""),

  // hiai-kit integration boundary (server-side) — capability API
  // (/api/v1/capabilities) + carousel jobs (/api/v1/carousel) on the peer
  // hiai-kit backend (default port 3000). HIAI_KIT_COOKIE / HIAI_KIT_TOKEN
  // are OPTIONAL server-side credentials forwarded to hiai-kit (as `Cookie`
  // / `Authorization: Bearer` headers); hiai-kit protects writes with a
  // Better Auth session, so without a configured session protected calls
  // fail with 401 (mapped to HIAI_KIT_ERROR). Secrets are never logged.
  HIAI_KIT_URL: z.string().default("http://localhost:3000"),
  HIAI_KIT_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  HIAI_KIT_COOKIE: z.string().optional(),
  HIAI_KIT_TOKEN: z.string().optional(),

  // Ports
  API_PORT: z.coerce.number().default(50300),
  FRONTEND_PORT: z.coerce.number().default(50301),

  // Environment
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Observability
  SENTRY_DSN: z.string().default(""),

  // hiai-observe telemetry (optional) — structured Writer/Carousel/API/MCP
  // success/failure events via the OTLP /v1/logs endpoint with the verified
  // Bearer API-key contract (`Authorization: Bearer <key>`). Mirrored by
  // lib/observe.ts, which reads these directly from process.env so telemetry
  // can never fail product startup; all default to unset/disabled.
  HIAI_OBSERVE_URL: z.string().default("http://localhost:8001"),
  HIAI_OBSERVE_API_KEY: z.string().default(""),
  HIAI_OBSERVE_PROJECT: z.string().default(""),
  HIAI_OBSERVE_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),

  // Postiz integration boundary (optional) — typed publication-intent
  // submission / status-sync client only; NOT wired to publishing and NOT a
  // live adapter. All defaults unset → the client reports NOT_CONFIGURED.
  POSTIZ_API_URL: z.string().default(""),
  POSTIZ_API_KEY: z.string().default(""),
  POSTIZ_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (_config) return _config;

  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment configuration:");
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
