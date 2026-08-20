/**
 * HTTP integration tests for the Writer routes (/api/v1/writer).
 *
 * Mounts the REAL writer route plugin with the real auth → tenant → rbac
 * middleware chain, backed by an in-memory fake db + mocked redis/logger +
 * stubbed Better Auth session fetch. The EXTERNAL CAPABILITY BOUNDARY is
 * mocked at the module level (hiai-kit `createHiaiKitClient` and the
 * temporary local social writer) — the writer service, content/revision
 * services and persistence all run for real against the fake db. Covers:
 *   - auth / tenant / rbac gate envelopes (401/400/403)
 *   - RBAC: viewer denied, editor can generate/rewrite
 *   - body tenantId is ignored; tenant isolation (cross-tenant rewrite → 404)
 *   - runtime validation (400 VALIDATION with details)
 *   - hiai-kit article path + temporary local social_post fallback
 *   - hiai-kit failure → 502 envelope with correlation id
 *   - rewrite preserves prior revisions (revision history via /api/v1/content)
 *   - approval flow via the EXISTING content routes (submit-review/approve)
 *
 * Run with: npx vitest run tests/integration/writer-routes.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Env BEFORE any module that reads config at load time.
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
    db: null as any,
    // External capability boundary fakes (module-mocked).
    hiaiKitArticle: vi.fn(async () => ({
      runId: "run-article-integration",
      capabilityId: "content.article",
      status: "completed" as const,
      output: {
        intent: "article",
        artifact: { outline: ["Intro"] },
        formatted: "## Generated article body",
        generatedAt: new Date().toISOString(),
      },
      artifacts: [],
      sources: [],
      warnings: [],
      errors: [],
    })),
    socialWriter: vi.fn(async () => ({
      title: "Social post",
      bodyText: "[instagram]\nLaunch copy\n#launch\n\n---\n\n[x]\nLaunch copy x\n#launch",
      bodyJson: {
        variants: [
          { platform: "instagram", content: "Launch copy", hashtags: ["#launch"] },
          { platform: "x", content: "Launch copy x", hashtags: ["#launch"] },
        ],
      },
      backend: "local:content-generate",
      correlationId: "local-correlation-integration",
    })),
  };
});

vi.mock("../../src/lib/db.js", async () => {
  const { makeFakeDb } = await import("../../src/__tests__/helpers/fake-db.js");
  const db = makeFakeDb({
    tenants: [
      { id: state.TENANT_A, status: "active" },
      { id: state.TENANT_B, status: "active" },
    ],
    tenant_members: [
      { tenantId: state.TENANT_A, userId: "user-viewer", role: "viewer" },
      { tenantId: state.TENANT_A, userId: "user-editor", role: "editor" },
      { tenantId: state.TENANT_A, userId: "user-admin", role: "admin" },
      { tenantId: state.TENANT_B, userId: "user-editor-b", role: "editor" },
    ],
  });
  state.db = db;
  return {
    db,
    checkDbHealth: async () => true,
    withTransaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
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

// The external capability boundary — module-level fakes (no network/LLM).
vi.mock("../../src/integrations/hiai-kit/index.js", () => ({
  createHiaiKitClient: () => ({ capabilities: { contentArticle: state.hiaiKitArticle } }),
}));

vi.mock("../../src/services/writer-local.js", () => ({
  localMastraSocialWriter: state.socialWriter,
}));

const { Elysia } = await import("elysia");
const { contentRoutes } = await import("../../src/api/routes/content.js");
const { writerRoutes } = await import("../../src/api/routes/writer.js");

/** Mock Better Auth get-session: each token maps to a user. */
function stubSessionFetch() {
  const users: Record<string, { id: string; email: string; name: string; role: string }> = {
    "viewer-token": { id: "user-viewer", email: "viewer@example.com", name: "Viewer", role: "user" },
    "editor-token": { id: "user-editor", email: "editor@example.com", name: "Editor", role: "user" },
    "admin-token": { id: "user-admin", email: "admin@example.com", name: "Admin", role: "user" },
    "outsider-token": { id: "user-outsider", email: "o@example.com", name: "Outsider", role: "user" },
    "editor-b-token": { id: "user-editor-b", email: "eb@example.com", name: "EditorB", role: "user" },
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
    })
  );
}

const app = new Elysia()
  .onError(({ code, error, set }: any) => {
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
  .use(contentRoutes)
  .use(writerRoutes);

async function request(
  path: string,
  init?: { headers?: Record<string, string>; method?: string; body?: unknown }
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { ...(init?.headers ?? {}) };
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
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

const auth = (token: string, tenantId: string) => ({
  Authorization: `Bearer ${token}`,
  "X-Tenant-Id": tenantId,
});

beforeEach(() => {
  stubSessionFetch();
  state.hiaiKitArticle.mockClear();
  state.socialWriter.mockClear();
  state.db._tables.content_items = [];
  state.db._tables.content_item_revisions = [];
  state.db._tables.projects = [];
  state.db._tables.brands = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("gate envelopes", () => {
  it("returns 401 without an Authorization header", async () => {
    const { status, body } = await request("/api/v1/writer/generate", {
      method: "POST",
      headers: { "X-Tenant-Id": state.TENANT_A },
      body: { contentType: "article", topic: "t" },
    });
    expect(status).toBe(401);
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("returns 400 when X-Tenant-Id is missing", async () => {
    const { status, body } = await request("/api/v1/writer/generate", {
      method: "POST",
      headers: { Authorization: "Bearer editor-token" },
      body: { contentType: "article", topic: "t" },
    });
    expect(status).toBe(400);
    expect(body.code).toBe("TENANT_HEADER_REQUIRED");
  });

  it("returns 403 for a tenant the user is not a member of", async () => {
    const { status, body } = await request("/api/v1/writer/generate", {
      method: "POST",
      headers: auth("outsider-token", state.TENANT_A),
      body: { contentType: "article", topic: "t" },
    });
    expect(status).toBe(403);
    expect(body.code).toBe("TENANT_ACCESS_DENIED");
  });
});

describe("RBAC on writer routes", () => {
  it("denies a viewer generating content (403 INSUFFICIENT_ROLE)", async () => {
    const { status, body } = await request("/api/v1/writer/generate", {
      method: "POST",
      headers: auth("viewer-token", state.TENANT_A),
      body: { contentType: "article", topic: "t" },
    });
    expect(status).toBe(403);
    expect(body.code).toBe("INSUFFICIENT_ROLE");
  });

  it("lets an editor generate an article via hiai-kit (201)", async () => {
    const { status, body } = await request("/api/v1/writer/generate", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { contentType: "article", topic: "Launch story" },
    });
    expect(status).toBe(201);
    expect(state.hiaiKitArticle).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "Launch story", outcome: "draft" })
    );
    expect(body.item).toMatchObject({
      title: "Launch story",
      bodyText: "## Generated article body",
      status: "draft",
      tenantId: state.TENANT_A,
      source: "web", // session principal → interactive web UI
      currentRevisionNumber: 1,
    });
    expect(body.item.bodyJson).toMatchObject({
      contentType: "article",
      backend: "hiai-kit:content.article",
      correlationId: "run-article-integration",
    });
    expect(body.revision.revisionNumber).toBe(1);
    expect(body.backend).toBe("hiai-kit:content.article");
    expect(body.correlationId).toBe("run-article-integration");
  });

  it("ignores a body tenantId — scopes to the principal tenant", async () => {
    const { status, body } = await request("/api/v1/writer/generate", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { contentType: "article", topic: "t", tenantId: state.TENANT_B },
    });
    expect(status).toBe(201);
    expect(body.item.tenantId).toBe(state.TENANT_A);
  });
});

describe("social_post uses the temporary local fallback", () => {
  it("generates via the local writer adapter (explicit fallback label)", async () => {
    const { status, body } = await request("/api/v1/writer/generate", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { contentType: "social_post", topic: "Launch day" },
    });
    expect(status).toBe(201);
    expect(state.socialWriter).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "Launch day" })
    );
    expect(body.item.bodyJson).toMatchObject({
      contentType: "social_post",
      backend: "local:content-generate",
    });
    expect(body.backend).toBe("local:content-generate");
    expect(body.item.bodyText).toContain("[instagram]");
  });
});

describe("service error envelopes over HTTP", () => {
  it("returns 400 VALIDATION with details for an invalid body", async () => {
    const { status, body } = await request("/api/v1/writer/generate", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { contentType: "article", topic: "" },
    });
    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION");
    expect(body.details).toBeDefined();
  });

  it("maps a hiai-kit failure to 502 with correlation id", async () => {
    const { HiaiKitError } = await import("../../src/integrations/hiai-kit/errors.js");
    state.hiaiKitArticle.mockRejectedValueOnce(
      new HiaiKitError("HIAI_KIT_ERROR", "upstream exploded", 502, {
        correlationId: "corr-xyz",
        path: "/api/v1/capabilities/content.article/run",
      })
    );
    const { status, body } = await request("/api/v1/writer/generate", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { contentType: "article", topic: "t" },
    });
    expect(status).toBe(502);
    expect(body).toMatchObject({
      error: "HIAI_KIT_ERROR",
      message: "upstream exploded",
      correlationId: "corr-xyz",
    });
  });
});

describe("rewrite preserves prior revisions", () => {
  it("appends revision #2 and keeps revision #1 (via existing content routes)", async () => {
    const created = await request("/api/v1/writer/generate", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { contentType: "article", topic: "Original title" },
    });
    expect(created.status).toBe(201);
    const itemId = created.body.item.id;

    const rewritten = await request("/api/v1/writer/rewrite", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { contentItemId: itemId, instruction: "expand the intro" },
    });
    expect(rewritten.status).toBe(200);
    expect(rewritten.body.revision.revisionNumber).toBe(2);
    expect(rewritten.body.item.title).toBe("Original title");
    // Rewrite appended a revision → the current-revision pointer advanced.
    expect(rewritten.body.item.currentRevisionNumber).toBe(2);

    // Revision history is readable through the EXISTING content route.
    const history = await request(`/api/v1/content/${itemId}/revisions`, {
      headers: auth("editor-token", state.TENANT_A),
    });
    expect(history.status).toBe(200);
    expect(history.body.revisions).toHaveLength(2);
    expect(history.body.revisions.map((r: any) => r.revisionNumber)).toEqual([2, 1]);
    expect(history.body.revisions[1].title).toBe("Original title");
  });

  it("returns 404 when rewriting another tenant's item", async () => {
    const created = await request("/api/v1/writer/generate", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { contentType: "social_post", topic: "secret" },
    });
    const itemId = created.body.item.id;

    const { status, body } = await request("/api/v1/writer/rewrite", {
      method: "POST",
      headers: auth("editor-b-token", state.TENANT_B),
      body: { contentItemId: itemId, instruction: "steal it" },
    });
    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("rejects a rewrite with an empty instruction (400 VALIDATION)", async () => {
    const created = await request("/api/v1/writer/generate", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { contentType: "social_post", topic: "t" },
    });
    const { status, body } = await request("/api/v1/writer/rewrite", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { contentItemId: created.body.item.id, instruction: "" },
    });
    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION");
  });
});

describe("approval via existing content routes", () => {
  it("generated item flows draft → in_review → approved", async () => {
    const created = await request("/api/v1/writer/generate", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { contentType: "social_post", topic: "approve me" },
    });
    const itemId = created.body.item.id;
    expect(created.body.item.status).toBe("draft");

    const reviewed = await request(`/api/v1/content/${itemId}/submit-review`, {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
    });
    expect(reviewed.body.item.status).toBe("in_review");

    const approved = await request(`/api/v1/content/${itemId}/approve`, {
      method: "POST",
      headers: auth("admin-token", state.TENANT_A),
    });
    expect(approved.status).toBe(200);
    expect(approved.body.item.status).toBe("approved");
  });
});
