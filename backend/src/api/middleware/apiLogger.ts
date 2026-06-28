import { Elysia } from "elysia";
import { logger } from "../../lib/logger.js";

const log = logger.child({ module: "api" });

export const apiLogger = new Elysia({ name: "api-logger" })
  .onBeforeHandle(({ request }) => {
    (request as any)._startTime = performance.now();
    log.info(
      {
        method: request.method,
        url: new URL(request.url).pathname,
        userAgent: request.headers.get("user-agent"),
      },
      "→ request"
    );
  })
  .onAfterHandle(({ request, set }) => {
    const start = (request as any)._startTime || 0;
    const duration = Math.round(performance.now() - start);
    log.info(
      {
        method: request.method,
        url: new URL(request.url).pathname,
        status: typeof set.status === "number" ? set.status : 200,
        duration,
      },
      "← response"
    );
  });
