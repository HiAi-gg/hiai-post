/**
 * hiai-post API application composition.
 *
 * This module builds the FULL Elysia application exactly as production
 * mounts it — public routes (health, webhooks, OAuth callbacks, Better
 * Auth) plus the protected application (auth → tenant → audit → every
 * authenticated route). It is deliberately side-effect-free (no
 * `listen`, no worker startup, no Redis connect) so integration tests
 * can import the REAL production composition and prove routes reach
 * their handlers instead of 404ing.
 *
 * `backend/src/api/index.ts` is the process entrypoint: it connects
 * Redis, calls `createApiApp()`, listens on `API_PORT`, and starts the
 * background workers.
 */
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { getConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { aiPluginManifest } from "./ai-plugin.js";
import { apiLogger } from "./middleware/apiLogger.js";
import { auditAfterHandle } from "./middleware/audit.js";
import { authGuard } from "./middleware/auth.js";
import { secureHeadersPlugin } from "./middleware/secureHeaders.js";
import { tenantGuard } from "./middleware/tenant.js";
import { openApiSpec } from "./openapi.js";
import { accountsRoutes } from "./routes/accounts.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { apiKeysRoutes } from "./routes/apiKeys.js";
import { authRoutes } from "./routes/auth.js";
import { campaignsRoutes } from "./routes/campaigns.js";
import { carouselsRoutes } from "./routes/carousels.js";
import { contentRoutes } from "./routes/content.js";
import { contentPlansRoutes } from "./routes/content-plans.js";
import { eventRoutes } from "./routes/events.js";
import { generateRoutes } from "./routes/generate.js";
import { healthRoutes } from "./routes/health.js";
import { mcpRoutes } from "./routes/mcp.js";
import { oauthCallbackRoutes, oauthRoutes } from "./routes/oauth.js";
import { postsRoutes } from "./routes/posts.js";
import { projectsRoutes } from "./routes/projects.js";
import { queueRoutes } from "./routes/queue.js";
import { templatesRoutes } from "./routes/templates.js";
import { webhooksRoutes } from "./routes/webhooks.js";
import { writerRoutes } from "./routes/writer.js";
import { youtubeRoutes } from "./routes/youtube.js";

/**
 * Global error handler. Registered INLINE (`.onError(handleError)`) — under
 * Elysia 1.4.x, hooks contributed by plugin instances used via `.use()` are
 * unreliable, so hooks are composed inline.
 *
 * Preserves a 4xx/5xx status that a middleware set before throwing (e.g. the
 * rate limiter's 429) instead of collapsing every error into a 500.
 */
export function handleError({ code, error, set }: any) {
  const errMsg = error instanceof Error ? error.message : String(error);
  const errStack = error instanceof Error ? error.stack : undefined;
  logger.error({ code, error: errMsg, stack: errStack }, "Unhandled error");

  if (code === "VALIDATION") {
    set.status = 400;
    return { error: "Validation failed", details: errMsg };
  }
  if (code === "NOT_FOUND") {
    set.status = 404;
    return { error: "Not found" };
  }

  const preset = typeof set.status === "number" && set.status >= 400 ? set.status : null;
  set.status = preset ?? 500;
  return { error: preset ? errMsg : "Internal server error" };
}

/**
 * Protected application: every route mounted here is guarded by auth → tenant
 * → audit (hooks registered inline so denials short-circuit with exact status
 * codes and the resolved tenant scope is stashed on the context).
 *
 * Route plugins have disjoint prefixes, but keep related feature surfaces
 * grouped: shared product foundation (content / carousels / writer) first,
 * then the social-platform CRUD + capability routes.
 *
 * NOTE: the function-form plugins (`analyticsRoutes`, `generateRoutes`,
 * `eventRoutes`) MUST be invoked so `.use()` receives an Elysia INSTANCE.
 * Under Elysia 1.4.x, `.use(fn)` with an un-invoked function returns the
 * function's NEW instance, so a chained `.use(analyticsRoutes)` would
 * replace the accumulated app and silently drop every route mounted before
 * it (a route-ordering/registration bug the production-composition test
 * guards against).
 */
export function createProtectedApp() {
  return (
    new Elysia()
      .onBeforeHandle(authGuard)
      .onBeforeHandle(tenantGuard)
      .onAfterHandle(auditAfterHandle)
      .onError(handleError)
      .use(accountsRoutes)
      .use(projectsRoutes)
      .use(contentRoutes)
      .use(carouselsRoutes)
      .use(writerRoutes)
      .use(apiKeysRoutes)
      // MCP JSON-RPC endpoint — requires a MACHINE principal (hpk_ key / admin
      // JWT); a local guard rejects session tokens (see routes/mcp.ts).
      .use(mcpRoutes)
      .use(postsRoutes)
      .use(contentPlansRoutes)
      .use(campaignsRoutes)
      .use(templatesRoutes)
      .use(analyticsRoutes())
      .use(oauthRoutes)
      .use(youtubeRoutes)
      .use(generateRoutes())
      .use(queueRoutes)
      .use(eventRoutes())
  );
}

/** Full application composition (public + protected mounts), side-effect free. */
export function createApiApp() {
  const cfg = getConfig();
  return (
    new Elysia()
      .use(
        cors({
          origin: cfg.NODE_ENV === "production" ? [cfg.BETTER_AUTH_URL] : true,
          credentials: true,
          methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
          allowedHeaders: ["Content-Type", "Authorization", "X-Tenant-Id", "X-Webhook-Secret"],
        })
      )
      .use(secureHeadersPlugin)
      .use(apiLogger)
      .onError(handleError)
      .use(healthRoutes)
      // Canonical OpenAPI spec + ChatGPT plugin manifest — public discovery.
      .get("/api/v1/openapi.json", () => openApiSpec)
      .get("/.well-known/ai-plugin.json", () => aiPluginManifest)
      .use(webhooksRoutes)
      // OAuth provider callbacks are header-less browser redirects; they derive
      // identity from the signed one-time state, so they must live OUTSIDE
      // protectedApp (see oauth.ts).
      .use(oauthCallbackRoutes)
      // Auth routes (Better Auth) — mounted outside protectedApp so sign-up,
      // sign-in, get-session, etc. are reachable WITHOUT auth/tenant middleware.
      .use(authRoutes)
      .use(createProtectedApp())
  );
}

export type App = ReturnType<typeof createApiApp>;
