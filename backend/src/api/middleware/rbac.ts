/**
 * RBAC guard for tenant-scoped routes.
 *
 * Hierarchy (high → low): owner > admin > editor > viewer
 *
 * Usage (register INLINE, after the auth + tenant guards):
 *   import { rbacGuard, requireEditor } from "../middleware/rbac.js";
 *
 *   .onBeforeHandle(authGuard)
 *   .onBeforeHandle(tenantGuard)
 *   .onBeforeHandle(requireEditor())   // applies to all routes chained AFTER
 *
 * The guard reads `tenantId`, `user` and the pre-resolved `tenantRole` from
 * context (set by `authGuard` + `tenantGuard`). `tenantGuard` has already
 * validated that the user is a member of the tenant (or that the request
 * came from a verified admin-JWT machine principal) and stashes the resolved
 * role on `context.tenantRole`, so this guard uses that value instead of
 * repeating the DB lookup. The `tenantId`/`userId` bypass branches below are
 * kept only as a defensive fallback for routes installed without the tenant
 * guard — under `protectedApp` they are never reached.
 *
 * On success, the resolved `role` is stashed on the context as
 * `context.role` so downstream handlers can branch on it.
 *
 * On failure, returns 403 with a structured payload describing why.
 *
 * Implementation note: the role is resolved by `tenantGuard` per
 * request. For hot paths, cache the lookup in Redis (key: rbac:{tenantId}:{userId})
 * with a 60s TTL. Out of scope for the initial POC.
 */

import { and, eq } from "drizzle-orm";
import { type TenantRole, tenantMembers } from "../../db/schema.js";
import { db } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";

export type Role = TenantRole;

// Numeric rank so a higher role automatically satisfies a lower
// requirement. Order matters: do not reorder without auditing callers.
const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

export function hasAtLeast(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

interface RbacOptions {
  required: Role;
}

/**
 * Outcome of an RBAC check. Three branches:
 *   - { ok: true,  role: Role }            → pass, role is stashed
 *   - { ok: true,  bypass: true }          → no user / no tenant — pass
 *   - { ok: false, status, body }          → fail with explicit response
 *
 * Extracted as a pure function so unit tests can exercise it without
 * needing to spin up an Elysia app.
 */
export type RbacOutcome =
  | { ok: true; role: Role }
  | { ok: true; bypass: true }
  | { ok: false; status: number; body: Record<string, unknown> };

export interface RbacCheckInput {
  tenantId?: string | null;
  user?: { id?: string } | null;
  /**
   * Role pre-resolved by `tenantGuard` (membership lookup for session
   * principals, `"owner"` for admin-JWT machine principals). When present,
   * the DB lookup is skipped — this avoids a second query per request and
   * lets machine principals pass without a `tenant_members` row.
   */
  tenantRole?: Role | null;
}

/**
 * Pure RBAC check — does the DB lookup (unless `tenantRole` is pre-resolved),
 * returns the outcome. Side effects: one DB select per call when the role has
 * not already been resolved (fail-closed on DB error).
 */
export async function checkRbac(input: RbacCheckInput, required: Role): Promise<RbacOutcome> {
  const { tenantId, user, tenantRole: resolvedRole } = input;
  const userId = user?.id;

  // No tenant context → defer to tenant middleware (defer = bypass here).
  if (!tenantId) return { ok: true, bypass: true };

  // No user → machine-to-machine (cron, webhook, Better Auth).
  if (!userId) return { ok: true, bypass: true };

  let role: Role | null = resolvedRole ?? null;
  if (role === null) {
    try {
      const rows = await db
        .select({ role: tenantMembers.role })
        .from(tenantMembers)
        .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
        .limit(1);
      role = (rows[0]?.role as Role | undefined) ?? null;
    } catch (err) {
      logger.error({ err, tenantId, userId }, "rbac lookup failed");
      return {
        ok: false,
        status: 500,
        body: { error: "Internal error", code: "RBAC_LOOKUP_FAILED" },
      };
    }
  }

  if (role === null) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "forbidden",
        code: "TENANT_ACCESS_DENIED",
        message: "You are not a member of this tenant",
        required_role: required,
      },
    };
  }

  if (!hasAtLeast(role, required)) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "forbidden",
        code: "INSUFFICIENT_ROLE",
        message: `This action requires role '${required}' or higher`,
        user_role: role,
        required_role: required,
      },
    };
  }

  return { ok: true, role };
}

/**
 * Returns an Elysia `onBeforeHandle` guard that enforces the given role on
 * any route it is registered on. Install AFTER `authGuard` and
 * `tenantGuard` — it depends on `ctx.user`, `ctx.tenantId` and the
 * pre-resolved `ctx.tenantRole`.
 *
 * NOTE: this must be a plain function, not a hook-only Elysia plugin: under
 * Elysia 1.4.x, hooks contributed by plugin instances used via `.use()`
 * have their returned short-circuit bodies dropped, so guards are composed
 * inline instead.
 */
export function rbacGuard(options: RbacOptions) {
  return async (ctx: any) => {
    const outcome = await checkRbac(
      ctx as RbacCheckInput & { tenantRole?: Role | null },
      options.required
    );

    if (!outcome.ok) {
      ctx.set.status = outcome.status;
      return outcome.body;
    }

    // Bypass path — no role to stash.
    if ("bypass" in outcome) return;

    // Stash resolved role on context for downstream handlers.
    ctx.role = outcome.role;
  };
}

// Convenience presets — share a role tier across multiple routes.
export const requireViewer = () => rbacGuard({ required: "viewer" });
export const requireEditor = () => rbacGuard({ required: "editor" });
export const requireAdmin = () => rbacGuard({ required: "admin" });
export const requireOwner = () => rbacGuard({ required: "owner" });
