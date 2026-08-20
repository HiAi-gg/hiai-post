import { and, eq } from "drizzle-orm";
import { type TenantRole, tenantMembers, tenants } from "../../db/schema.js";
import { db } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import { apiKeyRoleForScopes } from "../../services/apiKeys.js";
import type { PrincipalInfo } from "./auth.js";

/**
 * Tenant scoping + membership guard.
 *
 * Replaces the previous trust-on-header behavior: a client-supplied
 * `X-Tenant-Id` is no longer accepted on its own. The tenant is derived from
 * the authenticated principal (`ctx.user` / `ctx.auth`, set by
 * `authGuard`), then validated against the database:
 *
 *   - **Session principals (Better Auth users):** the tenant comes from the
 *     `X-Tenant-Id` header, but is only honored when the authenticated user
 *     has a `tenant_members` row for it. Not a member → 403
 *     `TENANT_ACCESS_DENIED`.
 *
 *   - **Admin-JWT principals (INT-POST machine bridge with hiai-admin):** the
 *     tenant comes from the verified JWT claims (`tenant_id` / `tenantId`).
 *     A claim is server-issued by the host proxy and is the preferred source.
 *     When the token carries no tenant claim, the `X-Tenant-Id` header is
 *     accepted as a controlled compatibility fallback (the host proxy sets
 *     it; the request has already been authenticated with the shared secret).
 *     Membership is not consulted for these principals: hiai-admin users
 *     live in a different user database, so the trust anchor is the verified
 *     HS256 JWT itself, not a `tenant_members` row. If both a claim and a
 *     header are present they must agree → mismatch is a 403.
 *
 *   - **API-key principals (Work API / MCP machine auth):** the tenant comes
 *     exclusively from the key's OWN row (`auth.apiKey.tenantId`, resolved by
 *     hash in authGuard). Client-supplied `X-Tenant-Id` is IGNORED entirely —
 *     a machine key can only ever act in the tenant that issued it.
 *     Membership is not consulted; the role floor is derived from the key's
 *     scopes via `apiKeyRoleForScopes` (owner/admin/editor/viewer).
 *
 * The tenant must exist and be `active`, otherwise the request is rejected
 * (403). On success the guard stashes the derived scope on the context:
 * `ctx.tenantId`, `ctx.tenantRole` (resolved membership role, or the
 * scope-derived role for machine principals) and `ctx.tenantSource`. The
 * authenticated user id is also stashed as `ctx.userId` so services record
 * the acting principal (session user, admin-JWT sub, or `apikey:<id>`).
 *
 * NOTE: this must be a plain function, not a hook-only Elysia plugin: under
 * Elysia 1.4.x, hooks contributed by plugin instances used via `.use()`
 * have their returned short-circuit bodies dropped, so guards are composed
 * inline instead (`protectedApp` and every protected route plugin register
 * `.onBeforeHandle(authGuard).onBeforeHandle(tenantGuard)`).
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Injectable DB access so unit tests can exercise `resolveTenantScope` without a database. */
export interface TenantLookup {
  findTenant(tenantId: string): Promise<{ id: string; status: string } | undefined>;
  findMembership(tenantId: string, userId: string): Promise<{ role: TenantRole } | undefined>;
}

const defaultLookup: TenantLookup = {
  async findTenant(tenantId) {
    const [row] = await db
      .select({ id: tenants.id, status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return row;
  },
  async findMembership(tenantId, userId) {
    const [row] = await db
      .select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
      .limit(1);
    return row;
  },
};

export type TenantOutcome =
  | {
      ok: true;
      tenantId: string;
      tenantRole: TenantRole | null;
      source: "claim" | "header" | "api-key";
    }
  | { ok: false; status: number; body: Record<string, unknown> };

export interface TenantCheckInput {
  user?: { id?: string } | null;
  auth?: PrincipalInfo | null;
  headerTenantId: string | null;
}

/**
 * Resolve and validate the tenant scope for an authenticated request.
 * Pure decision logic (DB access goes through `lookup`) so it can be unit
 * tested like `checkRbac`.
 */
export async function resolveTenantScope(
  input: TenantCheckInput,
  lookup: TenantLookup = defaultLookup
): Promise<TenantOutcome> {
  const { user, auth, headerTenantId } = input;
  const userId = user?.id;

  if (!userId) {
    return {
      ok: false,
      status: 401,
      body: { error: "Unauthorized", code: "UNAUTHENTICATED" },
    };
  }

  const isApiKeyPrincipal = auth?.source === "api-key";
  const isMachinePrincipal = auth?.source === "admin-jwt" || isApiKeyPrincipal;
  // API-key principals carry the DB-verified tenant from their own row;
  // admin-JWT principals carry it in the verified JWT claims.
  const claimTenantId = isApiKeyPrincipal
    ? auth?.apiKey?.tenantId
    : (auth?.claims?.tenant_id ?? auth?.claims?.tenantId);

  // 1. Pick the tenant candidate from the principal, not from the client alone.
  let tenantId: string;
  let source: "claim" | "header" | "api-key";

  if (isMachinePrincipal && claimTenantId) {
    // Admin-JWT: a contradicting header is a mismatch. API-key principals
    // IGNORE the header entirely — the key row is the only tenant authority.
    if (auth?.source === "admin-jwt" && headerTenantId && claimTenantId !== headerTenantId) {
      return {
        ok: false,
        status: 403,
        body: {
          error: "forbidden",
          code: "TENANT_MISMATCH",
          message: "JWT tenant claim does not match X-Tenant-Id header",
        },
      };
    }
    tenantId = claimTenantId;
    source = isApiKeyPrincipal ? "api-key" : "claim";
  } else {
    if (!headerTenantId) {
      return {
        ok: false,
        status: 400,
        body: { error: "X-Tenant-Id header is required", code: "TENANT_HEADER_REQUIRED" },
      };
    }
    tenantId = headerTenantId;
    source = "header";
  }

  // 2. Format check (a malformed ID is a client error, not a 403).
  if (!UUID_RE.test(tenantId)) {
    return {
      ok: false,
      status: 400,
      body: { error: "Invalid tenant ID format", code: "INVALID_TENANT_ID" },
    };
  }

  // 3. The tenant must exist and be active.
  let tenant: { id: string; status: string } | undefined;
  try {
    tenant = await lookup.findTenant(tenantId);
  } catch (err) {
    logger.error({ err, tenantId, userId }, "tenant lookup failed");
    return {
      ok: false,
      status: 500,
      body: { error: "Internal error", code: "TENANT_LOOKUP_FAILED" },
    };
  }

  if (!tenant) {
    return {
      ok: false,
      status: 403,
      body: { error: "forbidden", code: "TENANT_NOT_FOUND", message: "Tenant not found" },
    };
  }
  if (tenant.status !== "active") {
    return {
      ok: false,
      status: 403,
      body: { error: "forbidden", code: "TENANT_SUSPENDED", message: "Tenant is not active" },
    };
  }

  // 4. Membership validation.
  //    - Session principals: a `tenant_members` row must exist.
  //    - Machine principals (admin-JWT / api-key): skipped — the verified
  //      credential (JWT signature / hashed key row) is the trust anchor.
  //      Admin-JWT is treated as owner-equivalent; API-key principals get a
  //      scope-derived role floor so the shared RBAC guards apply.
  if (isMachinePrincipal) {
    const role: TenantRole = isApiKeyPrincipal
      ? apiKeyRoleForScopes(auth?.apiKey?.scopes ?? [])
      : "owner";
    return { ok: true, tenantId, tenantRole: role, source };
  }

  try {
    const membership = await lookup.findMembership(tenantId, userId);
    if (!membership) {
      return {
        ok: false,
        status: 403,
        body: {
          error: "forbidden",
          code: "TENANT_ACCESS_DENIED",
          message: "You are not a member of this tenant",
        },
      };
    }
    return { ok: true, tenantId, tenantRole: membership.role, source };
  } catch (err) {
    logger.error({ err, tenantId, userId }, "tenant membership lookup failed");
    return {
      ok: false,
      status: 500,
      body: { error: "Internal error", code: "TENANT_LOOKUP_FAILED" },
    };
  }
}

/**
 * Elysia guard. Register INLINE (`onBeforeHandle(tenantGuard)`) AFTER
 * `authGuard` — it depends on `ctx.user` / `ctx.auth`. Register BEFORE any
 * RBAC guard, which consumes the stashed `ctx.tenantId` / `ctx.tenantRole`.
 */
export async function tenantGuard(ctx: any) {
  // Outer chain (protectedApp) already resolved the scope — the route
  // plugins install the same guard for self-containment, so skip.
  if (ctx.tenantScoped === true) return;

  const outcome = await resolveTenantScope({
    user: ctx.user,
    auth: ctx.auth,
    headerTenantId: ctx.request.headers.get("X-Tenant-Id"),
  });

  if (!outcome.ok) {
    ctx.set.status = outcome.status;
    return outcome.body;
  }

  ctx.tenantId = outcome.tenantId;
  ctx.tenantRole = outcome.tenantRole;
  ctx.tenantSource = outcome.source;
  ctx.tenantScoped = true;
  // Propagate the acting principal id so services record createdBy/updatedBy
  // (session user id, admin-JWT sub, or `apikey:<id>`).
  ctx.userId = ctx.user?.id;
}
