import { getConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { connectRedis } from "../lib/redis.js";
import { startDeadLetterProcessor } from "../workers/dead-letter.js";
import { startOAuthRefreshWorker } from "../workers/oauth-refresh.js";
import { createApiApp } from "./app.js";

const cfg = getConfig();

// Connect Redis on startup
await connectRedis();

// The full application composition (public + protected routes, middleware,
// error handling) lives in ./app.ts — this file is only the process
// entrypoint: bind the port and start the background workers.
const app = createApiApp();

app.listen(cfg.API_PORT, () => {
  logger.info(`hiai-post API running on port ${cfg.API_PORT}`);
});

// Start background workers
startOAuthRefreshWorker();
startDeadLetterProcessor();

export type App = ReturnType<typeof createApiApp>;
