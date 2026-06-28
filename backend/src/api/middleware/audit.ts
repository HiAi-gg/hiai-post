/**
 * Audit logging middleware for state-changing operations.
 *
 * Captures POST, PUT, PATCH and DELETE requests and writes a record to the
 * `audit_logs` table once the handler has completed successfully. Runs AFTER
 * the route handler via `onAfterHandle` so we never persist an audit row for
 * a request that ultimately failed validation, auth, or business logic.
 *
 * Captured fields (per schema.ts → auditLogs):
 *   - tenant_id     → context.tenantId (set by tenantMiddleware)
 *   - actor_id      → context.user.id  (set by authMiddleware)
 *   - action        → HTTP method in upper case (POST / PUT / PATCH / DELETE)
 *   - resource      → route path  (e.g. "/api/v1/posts/:id")
 *   - resource_id   → trailing path param if it looks like a UUID / opaque id
 *   - metadata      → sanitized request body summary + query + status code
 *   - ip_address    → first x-forwarded-for entry, then x-real-ip
 *
 * Notes:
 *   - `audit` is registered INSIDE the protected app, after auth + tenant, so
 *     it can rely on those context values being present.
 *   - We never log the raw Authorization header or anything password-shaped
 *     (password, token, secret, key, signature).
 *   - The DB write is best-effort: a logging failure must not break the user
 *     request. Errors are surfaced through pino only.
 */
import { Elysia } from "elysia";
import { auditLogs } from "../../db/schema.js";
import { db } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";

const log = logger.child({ module: "audit" });

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Keys whose values are redacted in the metadata blob. */
const SENSITIVE_KEYS = [
  "password",
  "passwd",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "secret",
  "api_key",
  "apikey",
  "private_key",
  "signature",
  "cookie",
  "set-cookie",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PREVIEW_CHARS = 500;

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated-depth]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redactValue(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.includes(k.toLowerCase())) {
        out[k] = "[redacted]";
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === "string") {
    return value.length > MAX_PREVIEW_CHARS
      ? `${value.slice(0, MAX_PREVIEW_CHARS)}…[truncated ${value.length - MAX_PREVIEW_CHARS} chars]`
      : value;
  }
  return value;
}

function summarizeBody(body: unknown): unknown {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") {
    if (body.length > MAX_PREVIEW_CHARS) {
      return `${body.slice(0, MAX_PREVIEW_CHARS)}…[truncated ${body.length - MAX_PREVIEW_CHARS} chars]`;
    }
    return body;
  }
  return redactValue(body);
}

function extractResourceId(path: string): string | null {
  // Strip query/fragment, then pick the last non-empty path segment.
  const cleanPath = path.split("?")[0].split("#")[0];
  const segments = cleanPath.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const last = segments[segments.length - 1];
  if (!last) return null;
  // Only treat as a resource id if it looks like a uuid or is reasonably opaque
  // (>= 4 chars, no slashes/dots, not a literal "me"/"search"/etc.).
  if (UUID_RE.test(last)) return last;
  if (
    /^[A-Za-z0-9_-]{4,128}$/.test(last) &&
    !["me", "search", "list", "all"].includes(last.toLowerCase())
  ) {
    return last;
  }
  return null;
}

export const auditMiddleware = new Elysia({ name: "audit" }).onAfterHandle(async (ctx) => {
  const { request, set, user, tenantId } = ctx as typeof ctx & {
    user?: { id: string };
    tenantId?: string;
  };

  const method = request.method.toUpperCase();
  if (!MUTATING_METHODS.has(method)) return;

  // Skip if the handler already set a 4xx/5xx — onAfterHandle runs after the
  // route resolved, but `set.status` is the final response status.
  const status = typeof set.status === "number" ? set.status : 200;
  if (status >= 400) return;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  const path = url.pathname;

  // Best-effort read of the parsed body. Elysia exposes the validated body
  // on the context as `body`; we don't need to re-parse the request stream.
  const rawBody = (ctx as { body?: unknown }).body;
  const queryParams = Object.fromEntries(url.searchParams.entries());

  const metadata: Record<string, unknown> = {
    method,
    path,
    status,
    query: redactValue(queryParams),
  };
  if (rawBody !== undefined) {
    metadata.body = summarizeBody(rawBody);
  }
  const contentType = request.headers.get("content-type");
  if (contentType) metadata.contentType = contentType;

  try {
    await db.insert(auditLogs).values({
      tenantId: tenantId ?? null,
      actorId: user?.id ?? null,
      action: method,
      resource: path,
      resourceId: extractResourceId(path),
      metadata,
      ipAddress: getClientIp(request),
    });
  } catch (err) {
    // Never let an audit failure break the response.
    log.error({ err, path, method, status }, "Failed to write audit log row");
  }
});
