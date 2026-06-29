/**
 * Tests for the RBAC middleware logic.
 * Run with: npx vitest run src/__tests__/rbac.test.ts
 *
 * Verifies the pure `checkRbac` function (DB lookup + role check)
 * without spinning up an Elysia app. The middleware wrapper is a
 * thin Elysia adapter over `checkRbac`, so testing the core logic
 * here is sufficient.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Set required env vars BEFORE the dynamic import. rbac.ts transitively
// pulls in db.ts -> logger.ts -> getConfig(); without these, config.ts
// calls process.exit(1) and the suite fails to load.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-key-min-32-characters-long";
process.env.TOKEN_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.MINIO_SECRET_KEY ??= "test-minio-secret";
process.env.HIAI_ADMIN_JWT_SECRET ??= "shared-admin-jwt-secret-32chars-please";

// --- Mocks -----------------------------------------------------------------

const dbState: { rows: Array<{ role: string }> } = { rows: [] };

vi.mock("../lib/db.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(dbState.rows),
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

const { hasAtLeast, checkRbac } = await import("../api/middleware/rbac.js");

// --- Tests -----------------------------------------------------------------

describe("rbac — hasAtLeast helper", () => {
  it("owner satisfies all lower roles", () => {
    expect(hasAtLeast("owner", "viewer")).toBe(true);
    expect(hasAtLeast("owner", "editor")).toBe(true);
    expect(hasAtLeast("owner", "admin")).toBe(true);
    expect(hasAtLeast("owner", "owner")).toBe(true);
  });

  it("admin does not satisfy owner", () => {
    expect(hasAtLeast("admin", "owner")).toBe(false);
    expect(hasAtLeast("admin", "admin")).toBe(true);
  });

  it("editor does not satisfy admin", () => {
    expect(hasAtLeast("editor", "admin")).toBe(false);
    expect(hasAtLeast("editor", "editor")).toBe(true);
    expect(hasAtLeast("editor", "viewer")).toBe(true);
  });

  it("viewer does not satisfy editor", () => {
    expect(hasAtLeast("viewer", "editor")).toBe(false);
    expect(hasAtLeast("viewer", "admin")).toBe(false);
    expect(hasAtLeast("viewer", "viewer")).toBe(true);
  });
});

describe("rbac — bypass paths", () => {
  beforeEach(() => {
    dbState.rows = [];
  });

  it("bypasses when no tenantId (defer to tenant middleware)", async () => {
    const out = await checkRbac({ tenantId: null, user: { id: "user-1" } }, "admin");
    expect(out).toEqual({ ok: true, bypass: true });
  });

  it("bypasses when no user (system/M2M)", async () => {
    const out = await checkRbac({ tenantId: "tenant-1", user: null }, "admin");
    expect(out).toEqual({ ok: true, bypass: true });
  });
});

describe("rbac — denial paths", () => {
  beforeEach(() => {
    dbState.rows = [];
  });

  it("returns 403 TENANT_ACCESS_DENIED when user is not a member", async () => {
    dbState.rows = []; // no membership row
    const out = await checkRbac({ tenantId: "tenant-1", user: { id: "user-x" } }, "viewer");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(403);
      expect(out.body.code).toBe("TENANT_ACCESS_DENIED");
      expect(out.body.required_role).toBe("viewer");
    }
  });

  it("returns 403 INSUFFICIENT_ROLE when role < required", async () => {
    dbState.rows = [{ role: "viewer" }];
    const out = await checkRbac({ tenantId: "tenant-1", user: { id: "user-1" } }, "admin");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(403);
      expect(out.body.code).toBe("INSUFFICIENT_ROLE");
      expect(out.body.user_role).toBe("viewer");
      expect(out.body.required_role).toBe("admin");
    }
  });
});

describe("rbac — success path", () => {
  beforeEach(() => {
    dbState.rows = [];
  });

  it("passes and stashes role on context when role >= required", async () => {
    dbState.rows = [{ role: "admin" }];
    const out = await checkRbac({ tenantId: "tenant-1", user: { id: "user-1" } }, "editor");
    expect(out).toEqual({ ok: true, role: "admin" });
  });

  it("owner passes through owner-only requirement", async () => {
    dbState.rows = [{ role: "owner" }];
    const out = await checkRbac({ tenantId: "tenant-1", user: { id: "user-1" } }, "owner");
    expect(out).toEqual({ ok: true, role: "owner" });
  });

  it("editor satisfies editor but not admin requirement", async () => {
    dbState.rows = [{ role: "editor" }];
    const passOut = await checkRbac({ tenantId: "t1", user: { id: "u1" } }, "editor");
    expect(passOut).toEqual({ ok: true, role: "editor" });
    const failOut = await checkRbac({ tenantId: "t1", user: { id: "u1" } }, "admin");
    expect(failOut.ok).toBe(false);
  });
});
