import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { getConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { connectRedis } from "../lib/redis.js";
import { startDeadLetterProcessor } from "../workers/dead-letter.js";
import { startOAuthRefreshWorker } from "../workers/oauth-refresh.js";
import { apiLogger } from "./middleware/apiLogger.js";
import { auditMiddleware } from "./middleware/audit.js";
import { authMiddleware } from "./middleware/auth.js";
import { secureHeadersPlugin } from "./middleware/secureHeaders.js";
import { tenantMiddleware } from "./middleware/tenant.js";
import { accountsRoutes } from "./routes/accounts.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { authRoutes } from "./routes/auth.js";
import { campaignsRoutes } from "./routes/campaigns.js";
import { contentPlansRoutes } from "./routes/content-plans.js";
import { eventRoutes } from "./routes/events.js";
import { generateRoutes } from "./routes/generate.js";
import { healthRoutes } from "./routes/health.js";
import { oauthRoutes } from "./routes/oauth.js";
import { postsRoutes } from "./routes/posts.js";
import { queueRoutes } from "./routes/queue.js";
import { templatesRoutes } from "./routes/templates.js";
import { webhooksRoutes } from "./routes/webhooks.js";
import { youtubeRoutes } from "./routes/youtube.js";

const cfg = getConfig();

// Connect Redis on startup
await connectRedis();

const errorHandler = new Elysia().onError(({ code, error, set }) => {
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

  set.status = 500;
  return { error: "Internal server error" };
});

const protectedApp = new Elysia()
  .use(authMiddleware)
  .use(tenantMiddleware)
  .use(auditMiddleware)
  .use(errorHandler)
  .use(accountsRoutes)
  .use(postsRoutes)
  .use(contentPlansRoutes)
  .use(campaignsRoutes)
  .use(templatesRoutes)
  .use(analyticsRoutes)
  .use(oauthRoutes)
  .use(youtubeRoutes)
  .use(generateRoutes)
  .use(queueRoutes)
  .use(eventRoutes);

const app = new Elysia()
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
  .use(errorHandler)
  .use(healthRoutes)
  .use(webhooksRoutes)
  // Auth routes (Better Auth) — mounted outside protectedApp so sign-up,
  // sign-in, get-session, etc. are reachable WITHOUT auth/tenant middleware.
  .use(authRoutes)
  .use(protectedApp);

app.listen(cfg.API_PORT, () => {
  logger.info(`hiai-post API running on port ${cfg.API_PORT}`);
});

// Start background workers
startOAuthRefreshWorker();
startDeadLetterProcessor();

export type App = typeof app;
