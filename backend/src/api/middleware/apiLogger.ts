import { randomUUID } from "node:crypto";
import { Elysia } from "elysia";
import { logger } from "../../lib/logger.js";
import { observeEvent } from "../../lib/observe.js";

const log = logger.child({ module: "api" });

/** True for paths worth observing: the /api/* surface, minus health pings and CORS preflight. */
function isObservedPath(method: string, path: string): boolean {
  if (method === "OPTIONS") return false;
  if (!path.startsWith("/api/")) return false;
  if (path.endsWith("/health")) return false;
  return true;
}

export const apiLogger = new Elysia({ name: "api-logger" })
  .onBeforeHandle(({ request }) => {
    const req = request as Request & { _startTime?: number; _observeCorrelationId?: string };
    req._startTime = performance.now();
    req._observeCorrelationId = randomUUID();
    log.info(
      {
        method: request.method,
        url: new URL(request.url).pathname,
        userAgent: request.headers.get("user-agent"),
      },
      "→ request"
    );
    const path = new URL(request.url).pathname;
    if (isObservedPath(request.method, path)) {
      observeEvent({
        kind: "api",
        outcome: "start",
        operation: "api.request",
        correlationId: req._observeCorrelationId,
        message: `api ${request.method} ${path} started`,
        metadata: { method: request.method, path },
      });
    }
  })
  .onAfterHandle(({ request, set }) => {
    const req = request as Request & { _startTime?: number; _observeCorrelationId?: string };
    const start = req._startTime || 0;
    const duration = Math.round(performance.now() - start);
    const status = typeof set.status === "number" ? set.status : 200;
    log.info(
      {
        method: request.method,
        url: new URL(request.url).pathname,
        status,
        duration,
      },
      "← response"
    );
    const path = new URL(request.url).pathname;
    if (isObservedPath(request.method, path)) {
      const correlationId = req._observeCorrelationId ?? randomUUID();
      observeEvent({
        kind: "api",
        outcome: status < 400 ? "success" : "failure",
        operation: "api.request",
        correlationId,
        status,
        durationMs: duration,
        message: `api ${request.method} ${path} ${status < 400 ? "succeeded" : "failed"}`,
        metadata: { method: request.method, path },
      });
    }
  });
