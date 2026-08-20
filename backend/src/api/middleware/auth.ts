import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import {
  API_KEY_PREFIX,
  resolveApiKeyForAuth,
  shouldTouchKey,
  touchApiKey,
} from "../../services/apiKeys.js";

const cfg = getConfig();

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface JwtPayload {
  sub?: string;
  email?: string;
  role?: string;
  name?: string;
  tenantId?: string;
  tenant_id?: string;
  iat?: number;
  exp?: number;
}

/**
 * Identifies how the authenticated principal was established. `tenant.ts`
 * and `rbac.ts` branch on this: session principals get tenant scope from the
 * `X-Tenant-Id` header (validated against `tenant_members`), admin-JWT
 * principals (machine-to-machine bridge with hiai-admin) get it from the
 * verified JWT claims (or the host-proxy-set header as a controlled
 * compatibility fallback), and API-key principals get it from the key's own
 * tenant row (never from request input).
 */
export type PrincipalSource = "session" | "admin-jwt" | "api-key";

export interface PrincipalInfo {
  source: PrincipalSource;
  claims?: JwtPayload;
  /**
   * Resolved API-key principal (source === "api-key"). The tenant id here is
   * the DB-verified value from the key row — client-supplied tenant headers
   * are ignored for these principals.
   */
  apiKey?: {
    id: string;
    tenantId: string;
    name: string;
    scopes: string[];
  };
}

/**
 * Verify an HS256 JWT minted by an external service (e.g. hiai-admin's
 * `mintBackendToken`). Uses `node:crypto` to avoid pulling `jose` just for
 * symmetric verification. Returns the payload claims on success or `null`
 * if the token is malformed, has a bad signature, or is expired.
 */
export function verifyAdminJwt(token: string, secret: string): JwtPayload | null {
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  let header: { alg?: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")) as { alg?: string };
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;

  const expected = createHmac("sha256", secret).update(signingInput).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signatureB64, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let payload: JwtPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as JwtPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;

  return payload;
}

function looksLikeJwt(token: string): boolean {
  return token.split(".").length === 3;
}

/**
 * Authentication guard. Register INLINE on an Elysia app or route plugin
 * (`.onBeforeHandle(authGuard)`), BEFORE the tenant guard.
 *
 * Resolves the authenticated principal and stashes it on the context:
 *   - `ctx.user`  → { id, email, name, role }
 *   - `ctx.auth`  → { source: "session" | "admin-jwt", claims? }
 *
 * Two principal sources are accepted:
 *   1. Admin-JWT (INT-POST bridge): an HS256 token minted by hiai-admin and
 *      signed with `HIAI_ADMIN_JWT_SECRET`. Verified locally without a
 *      round-trip to Better Auth.
 *   2. API key (Work API / MCP machine auth): a `hpk_<secret>` credential
 *      resolved by SHA-256 hash against the tenant-scoped `api_keys` table.
 *      The key's OWN tenant row is the trust anchor — the client cannot
 *      influence the tenant via headers/query/body. `last_used_at` is
 *      bumped best-effort (throttled, fire-and-forget).
 *   3. Better Auth session: the Bearer token is validated against
 *      `{BETTER_AUTH_URL}/api/auth/get-session`.
 *
 * On failure the guard short-circuits with a 401 — it never relies on the
 * global error handler for its status code.
 *
 * NOTE: this must be a plain function, not a hook-only Elysia plugin: under
 * Elysia 1.4.x, hooks contributed by plugin instances used via `.use()`
 * have their returned short-circuit bodies dropped (and their context
 * mutations are unreliable), so guards are composed inline instead.
 */
export async function authGuard(ctx: any) {
  const set = ctx.set;
  const request = ctx.request as Request;

  // Outer chain (e.g. protectedApp) already authenticated this request.
  if (ctx.user) return;

  const authHeader = request.headers.get("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    if (set) set.status = 401;
    return { error: "Missing or invalid Authorization header", code: "UNAUTHENTICATED" };
  }

  const token = authHeader.slice(7);

  // Work API machine auth: `hpk_<secret>` credentials resolved by SHA-256
  // hash against the tenant-scoped api_keys table. Runs BEFORE the admin-JWT
  // and session paths — an hpk_ token must never be treated as a session.
  if (token.startsWith(API_KEY_PREFIX)) {
    let key = null;
    try {
      key = await resolveApiKeyForAuth(token);
    } catch (err) {
      logger.warn({ err }, "API key resolution failed; treating as unauthenticated");
    }
    if (!key) {
      if (set) set.status = 401;
      // Deliberately opaque: never reveal revoked vs expired vs unknown.
      return { error: "Invalid API key", code: "UNAUTHENTICATED" };
    }
    // Best-effort last-used bookkeeping (throttled per key, never fatal).
    if (shouldTouchKey(key)) {
      void touchApiKey(key.id).catch(() => {});
    }
    const principalId = `apikey:${key.id}`;
    ctx.user = {
      id: principalId,
      email: `${principalId}@api.invalid`,
      name: key.name,
      role: "machine",
    };
    ctx.auth = {
      source: "api-key",
      apiKey: {
        id: key.id,
        tenantId: key.tenantId,
        name: key.name,
        scopes: (key.scopes ?? []) as string[],
      },
    } satisfies PrincipalInfo;
    return;
  }

  // Cross-service auth bridge (INT-POST): when an admin-issued HS256 token
  // arrives and the shared secret is configured, verify locally without
  // hitting Better Auth. This is the path hiai-admin's proxy takes.
  if (cfg.HIAI_ADMIN_JWT_SECRET && looksLikeJwt(token)) {
    const claims = verifyAdminJwt(token, cfg.HIAI_ADMIN_JWT_SECRET);
    if (claims?.sub && claims.email && claims.role) {
      ctx.user = {
        id: claims.sub,
        email: claims.email,
        name: claims.name ?? claims.email,
        role: claims.role,
      };
      ctx.auth = { source: "admin-jwt", claims } satisfies PrincipalInfo;
      return;
    }
    logger.debug("HS256 admin JWT present but invalid; falling back to session");
  }

  // Verify via Better Auth session token
  try {
    const response = await fetch(`${cfg.BETTER_AUTH_URL}/api/auth/get-session`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: `better-auth.session_token=${token}`,
      },
    });

    if (!response.ok) {
      if (set) set.status = 401;
      return { error: "Invalid session", code: "UNAUTHENTICATED" };
    }

    const data = (await response.json()) as { user?: AuthUser; session?: { userId: string } };
    if (!data.user) {
      if (set) set.status = 401;
      return { error: "No user in session", code: "UNAUTHENTICATED" };
    }

    ctx.user = data.user;
    ctx.auth = { source: "session" } satisfies PrincipalInfo;
    return;
  } catch (err) {
    logger.debug({ err }, "Auth verification failed");
    if (set) set.status = 401;
    return { error: "Authentication failed", code: "UNAUTHENTICATED" };
  }
}
