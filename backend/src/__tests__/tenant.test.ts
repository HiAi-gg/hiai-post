/**
 * Tests for tenant scope resolution (membership validation).
 * Run with: npx vitest run src/__tests__/tenant.test.ts
 *
 * Verifies the pure `resolveTenantScope` decision logic (principal-derived
 * tenant + tenant existence + membership) with an injected in-memory lookup,
 * without spinning up an Elysia app or a database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Set required env vars BEFORE the dynamic import. tenant.ts transitively
// pulls in db.ts -> logger.ts -> getConfig(); without these, config.ts
// calls process.exit(1) and the suite fails to load.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-key-min-32-characters-long";
process.env.TOKEN_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.HIAI_ADMIN_JWT_SECRET ??= "shared-admin-jwt-secret-32chars-please";

vi.mock("../lib/db.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
  },
}));

vi.mock("../lib/logger.js", () => {
  const childLogger = {
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
  };
  const pinoLogger = {
    child: () => childLogger,
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  return { logger: pinoLogger };
});

const { resolveTenantScope } = await import("../api/middleware/tenant.js");

import type { TenantLookup } from "../api/middleware/tenant.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

interface FakeRow {
  id?: string;
  status?: string;
  role?: string;
}

function makeLookup(overrides?: {
  tenant?: FakeRow | null;
  membership?: { role: string } | null;
}): { lookup: TenantLookup; calls: { tenant: string[]; membership: string[][] } } {
  const calls: { tenant: string[]; membership: string[][] } = { tenant: [], membership: [] };
  const lookup: TenantLookup = {
    findTenant: async (tenantId) => {
      calls.tenant.push(tenantId);
      // `undefined` → default active tenant; `null` → tenant does not exist.
      const tenant =
        overrides?.tenant === undefined ? { id: tenantId, status: "active" } : overrides.tenant;
      return tenant
        ? { id: String(tenant.id ?? tenantId), status: String(tenant.status) }
        : undefined;
    },
    findMembership: async (tenantId, userId) => {
      calls.membership.push([tenantId, userId]);
      // `undefined` → default member; `null` → not a member.
      const membership =
        overrides?.membership === undefined ? { role: "viewer" } : overrides.membership;
      return membership
        ? { role: membership.role as "viewer" | "editor" | "admin" | "owner" }
        : undefined;
    },
  };
  return { lookup, calls };
}

// resolveTenantScope only reads `user.id`; the richer fields are ignored.
const sessionUser = { id: "user-1" };

describe("tenant — session principal (Better Auth user)", () => {
  beforeEach(() => {});

  it("grants a member access and derives tenantId from the header", async () => {
    const { lookup } = makeLookup({ membership: { role: "editor" } });
    const out = await resolveTenantScope(
      { user: sessionUser, auth: { source: "session" }, headerTenantId: TENANT_A },
      lookup
    );
    expect(out).toEqual({ ok: true, tenantId: TENANT_A, tenantRole: "editor", source: "header" });
  });

  it("denies a non-member with 403 TENANT_ACCESS_DENIED", async () => {
    const { lookup } = makeLookup({ membership: null });
    const out = await resolveTenantScope(
      { user: sessionUser, auth: { source: "session" }, headerTenantId: TENANT_A },
      lookup
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(403);
      expect(out.body.code).toBe("TENANT_ACCESS_DENIED");
    }
  });

  it("denies a header tenant that does not exist with 403 TENANT_NOT_FOUND", async () => {
    const { lookup } = makeLookup({ tenant: null });
    const out = await resolveTenantScope(
      { user: sessionUser, auth: { source: "session" }, headerTenantId: TENANT_B },
      lookup
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(403);
      expect(out.body.code).toBe("TENANT_NOT_FOUND");
    }
  });

  it("denies a suspended tenant with 403 TENANT_SUSPENDED", async () => {
    const { lookup } = makeLookup({ tenant: { id: TENANT_A, status: "suspended" } });
    const out = await resolveTenantScope(
      { user: sessionUser, auth: { source: "session" }, headerTenantId: TENANT_A },
      lookup
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(403);
      expect(out.body.code).toBe("TENANT_SUSPENDED");
    }
  });

  it("rejects a missing header with 400 TENANT_HEADER_REQUIRED", async () => {
    const out = await resolveTenantScope(
      { user: sessionUser, auth: { source: "session" }, headerTenantId: null },
      makeLookup().lookup
    );
    expect(out).toEqual({
      ok: false,
      status: 400,
      body: { error: "X-Tenant-Id header is required", code: "TENANT_HEADER_REQUIRED" },
    });
  });

  it("rejects a malformed tenant id with 400 INVALID_TENANT_ID", async () => {
    const out = await resolveTenantScope(
      { user: sessionUser, auth: { source: "session" }, headerTenantId: "not-a-uuid" },
      makeLookup().lookup
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(400);
      expect(out.body.code).toBe("INVALID_TENANT_ID");
    }
  });

  it("rejects an unauthenticated request with 401", async () => {
    const out = await resolveTenantScope(
      { user: null, auth: null, headerTenantId: TENANT_A },
      makeLookup().lookup
    );
    expect(out).toEqual({
      ok: false,
      status: 401,
      body: { error: "Unauthorized", code: "UNAUTHENTICATED" },
    });
  });

  it("returns 500 when the tenant lookup fails", async () => {
    const lookup: TenantLookup = {
      findTenant: async () => {
        throw new Error("db down");
      },
      findMembership: async () => ({ role: "viewer" }),
    };
    const out = await resolveTenantScope(
      { user: sessionUser, auth: { source: "session" }, headerTenantId: TENANT_A },
      lookup
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(500);
      expect(out.body.code).toBe("TENANT_LOOKUP_FAILED");
    }
  });

  it("returns 500 when the membership lookup fails", async () => {
    const lookup: TenantLookup = {
      findTenant: async (tenantId) => ({ id: tenantId, status: "active" }),
      findMembership: async () => {
        throw new Error("db down");
      },
    };
    const out = await resolveTenantScope(
      { user: sessionUser, auth: { source: "session" }, headerTenantId: TENANT_A },
      lookup
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(500);
    }
  });
});

describe("tenant — admin-JWT machine principal (INT-POST bridge)", () => {
  it("scopes to the verified JWT tenant claim", async () => {
    const { lookup, calls } = makeLookup();
    const out = await resolveTenantScope(
      {
        user: { id: "svc-1" },
        auth: { source: "admin-jwt", claims: { sub: "svc-1", tenant_id: TENANT_A } },
        headerTenantId: null,
      },
      lookup
    );
    expect(out).toEqual({ ok: true, tenantId: TENANT_A, tenantRole: "owner", source: "claim" });
    // Membership is not consulted for machine principals.
    expect(calls.membership).toHaveLength(0);
  });

  it("accepts both spellings of the tenant claim", async () => {
    const { lookup } = makeLookup();
    const out = await resolveTenantScope(
      {
        user: { id: "svc-1" },
        auth: { source: "admin-jwt", claims: { sub: "svc-1", tenantId: TENANT_A } },
        headerTenantId: null,
      },
      lookup
    );
    expect(out).toEqual({ ok: true, tenantId: TENANT_A, tenantRole: "owner", source: "claim" });
  });

  it("rejects a claim/header mismatch with 403 TENANT_MISMATCH", async () => {
    const out = await resolveTenantScope(
      {
        user: { id: "svc-1" },
        auth: { source: "admin-jwt", claims: { sub: "svc-1", tenant_id: TENANT_A } },
        headerTenantId: TENANT_B,
      },
      makeLookup().lookup
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(403);
      expect(out.body.code).toBe("TENANT_MISMATCH");
    }
  });

  it("accepts a matching claim and header (claim wins)", async () => {
    const { lookup } = makeLookup();
    const out = await resolveTenantScope(
      {
        user: { id: "svc-1" },
        auth: { source: "admin-jwt", claims: { sub: "svc-1", tenant_id: TENANT_A } },
        headerTenantId: TENANT_A,
      },
      lookup
    );
    expect(out).toEqual({ ok: true, tenantId: TENANT_A, tenantRole: "owner", source: "claim" });
  });

  it("falls back to the header when the JWT has no tenant claim (controlled compat path)", async () => {
    const { lookup, calls } = makeLookup();
    const out = await resolveTenantScope(
      {
        user: { id: "svc-1" },
        auth: { source: "admin-jwt", claims: { sub: "svc-1" } },
        headerTenantId: TENANT_A,
      },
      lookup
    );
    expect(out).toEqual({ ok: true, tenantId: TENANT_A, tenantRole: "owner", source: "header" });
    expect(calls.membership).toHaveLength(0);
  });

  it("still validates tenant existence for machine principals", async () => {
    const { lookup } = makeLookup({ tenant: null });
    const out = await resolveTenantScope(
      {
        user: { id: "svc-1" },
        auth: { source: "admin-jwt", claims: { sub: "svc-1", tenant_id: TENANT_B } },
        headerTenantId: null,
      },
      lookup
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(403);
      expect(out.body.code).toBe("TENANT_NOT_FOUND");
    }
  });
});
