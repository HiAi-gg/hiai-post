/**
 * Integration tests for tenant isolation at the HTTP layer.
 *
 * Builds a minimal Elysia app with the REAL auth → tenant → rbac middleware
 * chain (the same composition protectedApp uses) plus the real queue routes,
 * with `db`/`redis`/`logger` mocked. Covers:
 *   - member access (derived tenantId + resolved role)
 *   - cross-tenant denial (403 for a tenant the user is not a member of)
 *   - unauthenticated → 401, missing tenant header → 400
 *   - role enforcement (viewer vs admin route)
 *   - admin-JWT machine principals (tenant claim, mismatch rejection)
 *   - query-string tenantId is ignored (queue routes scope to ctx.tenantId)
 *
 * Run with: npx vitest run tests/integration/tenant-isolation.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

// Env must be set BEFORE importing modules that read config at load time.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-key-min-32-characters-long";
process.env.BETTER_AUTH_URL ??= "http://localhost:50300";
process.env.TOKEN_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.HIAI_ADMIN_JWT_SECRET ??= "shared-admin-jwt-secret-32chars-please";

const state = vi.hoisted(() => {
  const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  return {
    TENANT_A,
    TENANT_B,
    dbRows: {
      tenants: [
        { id: TENANT_A, status: "active" },
        { id: TENANT_B, status: "active" },
      ],
      tenant_members: [{ tenantId: TENANT_A, userId: "user-1", role: "viewer" }],
    } as Record<string, unknown[]>,
    zcardCalls: [] as string[],
    zrangeCalls: [] as string[],
    resetRedis() {
      this.zcardCalls = [];
      this.zrangeCalls = [];
    },
  };
});

const TENANT_A = state.TENANT_A;
const TENANT_B = state.TENANT_B;
const SECRET = "shared-admin-jwt-secret-32chars-please";

/** Extract bound parameter values from a drizzle where predicate. */
function predicateValues(predicate: unknown): string[] {
  const out: string[] = [];
  const walk = (c: any) => {
    if (c === null || c === undefined || typeof c !== "object") return;
    if (Array.isArray(c)) {
      for (const x of c) walk(x);
      return;
    }
    // SQL fragments carry `value` as an array of strings; bound parameters
    // carry it as a plain string.
    if (typeof c.value === "string") out.push(c.value);
    if (Array.isArray(c.queryChunks)) {
      for (const x of c.queryChunks) walk(x);
    }
  };
  const sql =
    typeof (predicate as any)?.getSQL === "function" ? (predicate as any).getSQL() : predicate;
  walk(sql?.queryChunks ?? predicate);
  return out;
}

vi.mock("../../src/lib/db.js", () => ({
  db: {
    select: () => ({
      from: (table: any) => ({
        where: (predicate: any) => ({
          limit: () => {
            const name: string | undefined = table?.[Symbol.for("drizzle:Name")];
            const rows = state.dbRows[name] ?? [];
            const values = predicateValues(predicate);
            if (name === "tenant_members" && values.length >= 2) {
              return Promise.resolve(
                rows.filter(
                  (r: any) => r.tenantId === values[0] && r.userId === values[1]
                )
              );
            }
            if (name === "tenants" && values.length >= 1) {
              return Promise.resolve(rows.filter((r: any) => r.id === values[0]));
            }
            return Promise.resolve(rows);
          },
        }),
      }),
    }),
  },
}));

vi.mock("../../src/lib/redis.js", () => ({
  redis: {
    incr: vi.fn(() => Promise.resolve(1)),
    pexpire: vi.fn(() => Promise.resolve(1)),
    pttl: vi.fn(() => Promise.resolve(1000)),
    zcard: vi.fn((key: string) => {
      state.zcardCalls.push(key);
      return Promise.resolve(3);
    }),
    zrange: vi.fn((key: string) => {
      state.zrangeCalls.push(key);
      return Promise.resolve([]);
    }),
    zrangebyscore: vi.fn(() => Promise.resolve([])),
    zremrangebyscore: vi.fn(() => Promise.resolve(0)),
    zscore: vi.fn(() => Promise.resolve(null)),
    zrem: vi.fn(() => Promise.resolve(1)),
    zadd: vi.fn(() => Promise.resolve(1)),
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(() => Promise.resolve("OK")),
    del: vi.fn(() => Promise.resolve(1)),
    expire: vi.fn(() => Promise.resolve(1)),
    ping: vi.fn(() => Promise.resolve("PONG")),
  },
  connectRedis: vi.fn(() => Promise.resolve()),
  checkRedisHealth: vi.fn(() => Promise.resolve(true)),
  enqueuePost: vi.fn(() => Promise.resolve()),
  dequeueDuePosts: vi.fn(() => Promise.resolve([])),
  removeQueuedPost: vi.fn(() => Promise.resolve()),
  getQueueSize: vi.fn(() => Promise.resolve(0)),
  checkPlatformRateLimit: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("../../src/lib/logger.js", () => ({
  logger: {
    child: () => ({
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { authGuard } = await import("../../src/api/middleware/auth.js");
const { tenantGuard } = await import("../../src/api/middleware/tenant.js");
const { requireAdmin, requireViewer } = await import("../../src/api/middleware/rbac.js");
const { queueRoutes } = await import("../../src/api/routes/queue.js");
const { Elysia } = await import("elysia");

/**
 * Mock the Better Auth `get-session` upstream that authGuard calls for
 * session principals. Only `Bearer session-token` resolves to a user.
 * Stubbed fresh per-test (afterEach unstubs globals).
 */
function stubSessionFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const auth = headers.Authorization ?? headers.authorization ?? "";
      const token = String(auth).replace(/^Bearer /, "");
      if (token === "session-token") {
        return new Response(
          JSON.stringify({
            user: { id: "user-1", email: "u@example.com", name: "U", role: "user" },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ user: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    })
  );
}

const app = new Elysia()
  .onBeforeHandle(authGuard)
  .onBeforeHandle(tenantGuard)
  .onBeforeHandle(requireViewer())
  .get("/api/v1/probe", ({ tenantId, tenantRole, tenantSource, user }: any) => ({
    tenantId,
    tenantRole,
    tenantSource,
    userId: user?.id,
  }))
  .use(queueRoutes)
  .onBeforeHandle(requireAdmin())
  .get("/api/v1/probe/admin", ({ tenantId }: any) => ({ tenantId }));

async function request(
  path: string,
  init?: { headers?: Record<string, string>; method?: string }
): Promise<{ status: number; body: any }> {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method: init?.method ?? "GET",
      headers: { ...(init?.headers ?? {}) },
    })
  );
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** Mint an HS256 admin JWT signed with the shared secret (hiai-admin contract). */
function mintAdminJwt(claims: Record<string, unknown>, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" }), "utf8").toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iat: nowSec, exp: nowSec + 3600, ...claims }),
    "utf8"
  ).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

beforeEach(() => {
  state.resetRedis();
  stubSessionFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("tenant isolation — member access", () => {
  it("grants a member access and derives tenantId from the principal", async () => {
    const { status, body } = await request("/api/v1/probe", {
      headers: { Authorization: "Bearer session-token", "X-Tenant-Id": TENANT_A },
    });
    expect(status).toBe(200);
    expect(body.tenantId).toBe(TENANT_A);
    expect(body.tenantRole).toBe("viewer");
    expect(body.tenantSource).toBe("header");
    expect(body.userId).toBe("user-1");
  });
});

describe("tenant isolation — cross-tenant denial", () => {
  it("denies a tenant the user is not a member of with 403", async () => {
    const { status, body } = await request("/api/v1/probe", {
      headers: { Authorization: "Bearer session-token", "X-Tenant-Id": TENANT_B },
    });
    expect(status).toBe(403);
    expect(body.code).toBe("TENANT_ACCESS_DENIED");
  });
});

describe("tenant isolation — auth failures", () => {
  it("returns 401 without an Authorization header", async () => {
    const { status, body } = await request("/api/v1/probe", {
      headers: { "X-Tenant-Id": TENANT_A },
    });
    expect(status).toBe(401);
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("returns 400 when the X-Tenant-Id header is missing", async () => {
    const { status, body } = await request("/api/v1/probe", {
      headers: { Authorization: "Bearer session-token" },
    });
    expect(status).toBe(400);
    expect(body.code).toBe("TENANT_HEADER_REQUIRED");
  });
});

describe("tenant isolation — role enforcement", () => {
  it("denies a viewer on an admin-only route with 403 INSUFFICIENT_ROLE", async () => {
    const { status, body } = await request("/api/v1/probe/admin", {
      headers: { Authorization: "Bearer session-token", "X-Tenant-Id": TENANT_A },
    });
    expect(status).toBe(403);
    expect(body.code).toBe("INSUFFICIENT_ROLE");
  });
});

describe("tenant isolation — admin-JWT machine principals", () => {
  it("scopes to the JWT tenant claim without a membership row", async () => {
    const token = mintAdminJwt({
      sub: "svc-1",
      email: "svc@example.com",
      role: "super_admin",
      tenant_id: TENANT_B,
    });
    const { status, body } = await request("/api/v1/probe", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(body.tenantId).toBe(TENANT_B);
    expect(body.tenantRole).toBe("owner");
    expect(body.tenantSource).toBe("claim");
  });

  it("rejects a claim/header tenant mismatch with 403", async () => {
    const token = mintAdminJwt({
      sub: "svc-1",
      email: "svc@example.com",
      role: "super_admin",
      tenant_id: TENANT_A,
    });
    const { status, body } = await request("/api/v1/probe", {
      headers: { Authorization: `Bearer ${token}`, "X-Tenant-Id": TENANT_B },
    });
    expect(status).toBe(403);
    expect(body.code).toBe("TENANT_MISMATCH");
  });

  it("rejects an unsigned/forged token with 401", async () => {
    const { status, body } = await request("/api/v1/probe", {
      headers: { Authorization: "Bearer not-a-real-token", "X-Tenant-Id": TENANT_A },
    });
    expect(status).toBe(401);
    expect(body.code).toBe("UNAUTHENTICATED");
  });
});

describe("tenant isolation — queue routes never trust query tenantId", () => {
  it("scopes queue reads to the derived tenant, ignoring ?tenantId=", async () => {
    const { status, body } = await request(
      `/api/v1/queue/status?tenantId=${TENANT_B}`,
      { headers: { Authorization: "Bearer session-token", "X-Tenant-Id": TENANT_A } }
    );
    expect(status).toBe(200);
    // The mock returns 3 for any zcard; the KEY must reference tenant A.
    expect(body.pending).toBe(3);
    expect(state.zcardCalls.some((key) => key.includes(TENANT_A))).toBe(true);
    expect(state.zcardCalls.some((key) => key.includes(TENANT_B))).toBe(false);
  });

  it("denies queue access for a tenant the user is not a member of", async () => {
    const { status, body } = await request("/api/v1/queue/status", {
      headers: { Authorization: "Bearer session-token", "X-Tenant-Id": TENANT_B },
    });
    expect(status).toBe(403);
    expect(body.code).toBe("TENANT_ACCESS_DENIED");
    expect(state.zcardCalls).toHaveLength(0);
  });
});
