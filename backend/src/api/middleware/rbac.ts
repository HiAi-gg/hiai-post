/**
 * RBAC middleware for tenant-scoped routes.
 *
 * Hierarchy (high → low): owner > admin > editor > viewer
 *
 * Usage:
 *   import { rbacMiddleware } from "../middleware/rbac.js";
 *
 *   .use(rbacMiddleware({ required: "editor" }))   // applies to all
 *                                                     routes chained AFTER
 *
 * The middleware reads `tenantId` and `user` from context (set by
 * authMiddleware + tenantMiddleware) and looks up the user's role in
 * `tenant_members`. Anonymous (no user) requests bypass RBAC by
 * design — they are typically machine-to-machine (cron, webhooks).
 *
 * On success, the resolved `role` is stashed on the context as
 * `context.role` so downstream handlers can branch on it.
 *
 * On failure, returns 403 with a structured payload describing why.
 *
 * Implementation note: this middleware does a DB lookup per request.
 * For hot paths, cache the lookup in Redis (key: rbac:{tenantId}:{userId})
 * with a 60s TTL. Out of scope for the initial POC.
 */

import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
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
}

/**
 * Pure RBAC check — does the DB lookup, returns the outcome.
 * Side effects: one DB select per call (fail-closed on DB error).
 */
export async function checkRbac(input: RbacCheckInput, required: Role): Promise<RbacOutcome> {
  const { tenantId, user } = input;
  const userId = user?.id;

  // No tenant context → defer to tenant middleware (defer = bypass here).
  if (!tenantId) return { ok: true, bypass: true };

  // No user → machine-to-machine (cron, webhook, Better Auth).
  if (!userId) return { ok: true, bypass: true };

  let role: Role | null = null;
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
 * Returns an Elysia plugin that enforces the given role on any route
 * registered after it. Install AFTER `authMiddleware` and
 * `tenantMiddleware` — it depends on `ctx.user` and `ctx.tenantId`.
 */
export function rbacMiddleware(options: RbacOptions) {
  return new Elysia({ name: `rbac-${options.required}` }).onBeforeHandle(async (ctx) => {
    const outcome = await checkRbac(ctx as RbacCheckInput, options.required);

    if (!outcome.ok) {
      ctx.set.status = outcome.status;
      return outcome.body;
    }

    // Bypass path — no role to stash.
    if ("bypass" in outcome) return;

    // Stash resolved role on context for downstream handlers.
    (ctx as { role?: Role }).role = outcome.role;
  });
}

// Convenience presets — share a role tier across multiple routes.
export const requireViewer = () => rbacMiddleware({ required: "viewer" });
export const requireEditor = () => rbacMiddleware({ required: "editor" });
export const requireAdmin = () => rbacMiddleware({ required: "admin" });
export const requireOwner = () => rbacMiddleware({ required: "owner" });
