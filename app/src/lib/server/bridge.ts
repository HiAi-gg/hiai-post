/**
 * Frontend ↔ backend bridge helpers (server-only).
 *
 * The hiai-post backend protects `/api/v1/*` with two middleware:
 *   - `auth.ts`       → requires `Authorization: Bearer <sessionToken>`
 *   - `tenant.ts`     → requires `X-Tenant-Id: <workspace uuid>`
 *
 * The SvelteKit proxy routes (`src/routes/api/v1/[...path]/+server.ts`)
 * forward the browser request to that backend. This module builds the
 * upstream headers from the existing Better Auth session cookie so the
 * proxied calls carry the same identity the browser already has — no
 * second auth system is introduced, the workspace is resolved from the
 * request header or deployment config (`HIAI_TENANT_ID`).
 */

export const SESSION_COOKIE = "better-auth.session_token";

/** Value handed to us by `hooks.server.ts` (see `App.Locals`). */
export interface BridgeLocals {
  sessionToken?: string;
  tenantId?: string;
}

/**
 * Resolve the workspace id for a request.
 *
 * Priority: an explicit `X-Tenant-Id` on the incoming request (e.g. the
 * unified host shell), then the server-side `HIAI_TENANT_ID` deployment
 * setting (e.g. the UUID of the seeded demo tenant from `bun db:seed`).
 * Returns `undefined` when neither is configured — the backend then
 * rejects the call with 400, which is the correct fail-closed behavior.
 */
export function resolveTenantId(
  explicitHeader: string | null | undefined,
  envTenantId: string | undefined
): string | undefined {
  const explicit = explicitHeader?.trim();
  if (explicit) return explicit;
  const env = envTenantId?.trim();
  return env || undefined;
}

/**
 * True when the current request is authenticated from the frontend's
 * perspective: the server locals carry the existing Better Auth session
 * token, or the incoming request itself carries a non-empty `Authorization`
 * header (e.g. an admin JWT or machine API key supplied directly by a
 * client, such as the unified host shell).
 *
 * Pure presence check — it never validates or issues credentials, and the
 * backend remains the sole authority for accepting or rejecting them.
 */
export function isAuthenticatedRequest(
  request: Pick<Request, "headers">,
  locals: BridgeLocals
): boolean {
  if (locals.sessionToken) return true;
  const authorization = request.headers.get("authorization");
  return Boolean(authorization?.trim());
}

/**
 * Headers that must not be forwarded across the proxy hop — `fetch`
 * recomputes framing (`content-length`, `accept-encoding`) and these are
 * either end-to-end framing artifacts or security-sensitive.
 */
const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "accept-encoding",
];

export interface UpstreamHeaderOptions {
  /** Inject `Authorization: Bearer <sessionToken>` when a session is present. */
  injectSession?: boolean;
  /** Inject `X-Tenant-Id` when a workspace is resolved. */
  injectTenant?: boolean;
}

/**
 * Build the headers sent to the backend for a proxied request.
 *
 * Copies the incoming headers, strips hop-by-hop / framing headers, then
 * (optionally) injects the session and workspace headers derived from the
 * existing frontend session. Explicit headers already present on the
 * incoming request are never overridden — a caller that already holds an
 * `Authorization` (e.g. the unified host) wins.
 */
export function buildUpstreamHeaders(
  incoming: Headers,
  locals: BridgeLocals,
  options: UpstreamHeaderOptions = {}
): Headers {
  const headers = new Headers(incoming);
  headers.delete("content-length");
  headers.delete("host");
  for (const name of HOP_BY_HOP) headers.delete(name);

  if (options.injectSession && !headers.has("authorization") && locals.sessionToken) {
    headers.set("authorization", `Bearer ${locals.sessionToken}`);
  }
  if (options.injectTenant && !headers.has("x-tenant-id") && locals.tenantId) {
    headers.set("x-tenant-id", locals.tenantId);
  }
  return headers;
}
