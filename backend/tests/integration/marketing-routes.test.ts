/**
 * HTTP integration tests for the marketing proxy (/api/v1/marketing).
 *
 * Mounts the real marketing route plugin with auth → tenant → rbac.
 * The only mocked boundary is createHiaiKitClient().marketing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-key-min-32-characters-long";
process.env.BETTER_AUTH_URL ??= "http://localhost:50300";
process.env.TOKEN_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.HIAI_ADMIN_JWT_SECRET ??= "shared-admin-jwt-secret-32chars-please";
process.env.HIAI_KIT_URL ??= "http://localhost:3000";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const pipelineOutput = {
  topic: "AI tooling",
  researchUsedBrowser: false,
  researchSummary: "summary",
  draft: "draft text that is long enough",
  voiceScore: 0.82,
  finalText: "final post",
  truncated: false,
  charsUsed: 10,
  complianceOk: true,
  violations: [],
  published: false,
  messageId: null,
  blockedReason: null,
  duplicate: false,
  idempotencyKey: "daily:2026-08-20:1",
  startedAt: "2026-08-20T09:00:00.000Z",
  completedAt: "2026-08-20T09:00:02.000Z",
};

const state = vi.hoisted(() => ({
  marketing: {
    listAgents: vi.fn(),
    listTrends: vi.fn(),
    getEngagement: vi.fn(),
    runPipeline: vi.fn(),
  },
  db: null as unknown,
}));

vi.mock("../../src/lib/db.js", async () => {
  const { makeFakeDb } = await import("../../src/__tests__/helpers/fake-db.js");
  const db = makeFakeDb({
    tenants: [{ id: TENANT_A, status: "active" }],
    tenant_members: [
      { tenantId: TENANT_A, userId: "user-viewer", role: "viewer" },
      { tenantId: TENANT_A, userId: "user-editor", role: "editor" },
    ],
  });
  state.db = db;
  return {
    db,
    withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
});

vi.mock("../../src/lib/redis.js", () => ({
  redis: {
    incr: vi.fn(() => Promise.resolve(1)),
    pexpire: vi.fn(() => Promise.resolve(1)),
    pttl: vi.fn(() => Promise.resolve(100000)),
    zcard: vi.fn(() => Promise.resolve(0)),
    zrange: vi.fn(() => Promise.resolve([])),
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(() => Promise.resolve("OK")),
    del: vi.fn(() => Promise.resolve(1)),
    expire: vi.fn(() => Promise.resolve(1)),
  },
  connectRedis: vi.fn(() => Promise.resolve()),
  checkRedisHealth: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("../../src/lib/logger.js", () => {
  const noop = vi.fn();
  return {
    logger: {
      child: () => ({ warn: noop, error: noop, info: noop, debug: noop }),
      warn: noop,
      error: noop,
      info: noop,
      debug: noop,
    },
  };
});

vi.mock("../../src/integrations/hiai-kit/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/integrations/hiai-kit/index.js")>();
  return {
    ...actual,
    createHiaiKitClient: () => ({ marketing: state.marketing }),
  };
});

const { Elysia } = await import("elysia");
const { HiaiKitError } = await import("../../src/integrations/hiai-kit/index.js");
const { marketingRoutes } = await import("../../src/api/routes/marketing.js");

function stubSessionFetch() {
  const users: Record<string, { id: string; email: string; name: string; role: string }> = {
    "viewer-token": { id: "user-viewer", email: "viewer@example.com", name: "Viewer", role: "user" },
    "editor-token": { id: "user-editor", email: "editor@example.com", name: "Editor", role: "user" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const auth = headers.Authorization ?? headers.authorization ?? "";
      const token = String(auth).replace(/^Bearer /, "");
      const user = users[token];
      return new Response(JSON.stringify(user ? { user } : { user: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

const app = new Elysia()
  .onError(({ code, error, set }: { code: string; error: unknown; set: { status?: number } }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: "Validation failed", details: String(error) };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: "Not found" };
    }
    set.status = 500;
    return { error: "Internal server error" };
  })
  .use(marketingRoutes);

async function request(
  path: string,
  init?: { headers?: Record<string, string>; method?: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { ...(init?.headers ?? {}) };
  if (init?.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    }),
  );
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const auth = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "X-Tenant-Id": TENANT_A,
});

describe("marketing proxy routes", () => {
  beforeEach(() => {
    stubSessionFetch();
    state.marketing.listAgents.mockReset();
    state.marketing.listTrends.mockReset();
    state.marketing.getEngagement.mockReset();
    state.marketing.runPipeline.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unauthenticated GET /trends → 401", async () => {
    const res = await request("/api/v1/marketing/trends");
    expect(res.status).toBe(401);
  });

  it("viewer can list trends", async () => {
    state.marketing.listTrends.mockResolvedValueOnce([
      { id: 1, topic: "Bun runtime", source: "hackernews", score: "80", fetchedAt: "2026-08-20T00:00:00.000Z" },
    ]);
    const res = await request("/api/v1/marketing/trends", { headers: auth("viewer-token") });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ trends: [{ topic: "Bun runtime" }] });
  });

  it("viewer can list engagement", async () => {
    state.marketing.getEngagement.mockResolvedValueOnce({
      generatedAt: "2026-08-20T00:00:00.000Z",
      total: 1,
      top: [],
      lookbackDays: 7,
      pulled: 0,
    });
    const res = await request("/api/v1/marketing/engagement", { headers: auth("viewer-token") });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1, lookbackDays: 7 });
  });

  it("viewer cannot run the pipeline", async () => {
    const res = await request("/api/v1/marketing/pipeline", {
      method: "POST",
      headers: auth("viewer-token"),
      body: { chatId: 1, skipPublish: true, topic: "AI tooling trends" },
    });
    expect(res.status).toBe(403);
    expect(state.marketing.runPipeline).not.toHaveBeenCalled();
  });

  it("editor preview (skipPublish) returns kit output", async () => {
    state.marketing.runPipeline.mockResolvedValueOnce(pipelineOutput);
    const res = await request("/api/v1/marketing/pipeline", {
      method: "POST",
      headers: auth("editor-token"),
      body: { chatId: 99, skipPublish: true, topic: "AI tooling trends" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ topic: "AI tooling", published: false, voiceScore: 0.82 });
    expect(state.marketing.runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 99, skipPublish: true, topic: "AI tooling trends" }),
    );
  });

  it("rejects invalid pipeline body", async () => {
    const res = await request("/api/v1/marketing/pipeline", {
      method: "POST",
      headers: auth("editor-token"),
      body: { topic: "x" },
    });
    expect(res.status).toBe(400);
    expect(state.marketing.runPipeline).not.toHaveBeenCalled();
  });

  it("maps kit adapter errors to the envelope", async () => {
    state.marketing.runPipeline.mockRejectedValueOnce(
      new HiaiKitError("HIAI_KIT_ERROR", "kit down", 502, { correlationId: "corr-1", path: "/api/v1/marketing/pipeline" }),
    );
    const res = await request("/api/v1/marketing/pipeline", {
      method: "POST",
      headers: auth("editor-token"),
      body: { chatId: 1, skipPublish: true, topic: "AI tooling trends" },
    });
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: "HIAI_KIT_ERROR", correlationId: "corr-1" });
  });
});
