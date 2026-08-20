/**
 * Production-composition HTTP integration test.
 *
 * Proves that the routes mounted in the REAL production application
 * composition (`backend/src/api/app.ts` — the exact module `api/index.ts`
 * boots) reach their handlers instead of 404ing. Regression guards for the
 * protected-application composition in `createProtectedApp()`: the writer
 * and carousel route plugins are mounted with the same auth → tenant →
 * audit → error-handler chain as every other protected route.
 *
 * What this proves:
 *   - POST /api/v1/writer/generate is registered inside the protected app:
 *     unauthenticated → 401 UNAUTHENTICATED (a missing route would 404),
 *     editor + valid body → 201 with a persisted item (handler ran).
 *   - POST /api/v1/carousels is registered inside the protected app:
 *     unauthenticated → 401 UNAUTHENTICATED, editor + valid body → 201.
 *   - Existing protected routes still resolve after the new mounts
 *     (GET /api/v1/content → 200) and unmatched paths still 404 — the new
 *     plugins did not shadow anything (route-ordering check).
 *
 * The ONLY boundaries mocked are the same ones the other integration
 * suites mock: the database (in-memory fake), Redis, logger, the hiai-kit
 * integration client (capabilities + carousel adapter) and the temporary
 * local social writer. The Elysia composition, middleware chain and error
 * handler are the REAL production ones.
 *
 * Run with: npx vitest run tests/integration/production-composition.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Env BEFORE any module that reads config at load time.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-key-min-32-characters-long";
process.env.BETTER_AUTH_URL ??= "http://localhost:50300";
process.env.TOKEN_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.HIAI_ADMIN_JWT_SECRET ??= "shared-admin-jwt-secret-32chars-please";
process.env.HIAI_KIT_URL ??= "http://localhost:3000";
process.env.HIAI_KIT_TIMEOUT_MS ??= "7000";

const state = vi.hoisted(() => {
  const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const JOB_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const carouselClient = {
    carousel: {
      createJob: vi.fn(),
      regenerateSlide: vi.fn(),
      getJob: vi.fn(),
      getSlideJson: vi.fn(),
      listJobs: vi.fn(),
      getJobBySlug: vi.fn(),
      getCover: vi.fn(),
    },
  };
  return {
    TENANT_A,
    TENANT_B,
    JOB_ID,
    carouselClient,
    db: null as any,
    // External capability boundary fakes (module-mocked).
    hiaiKitArticle: vi.fn(async () => ({
      runId: "run-composition-article",
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
      bodyText: "[instagram]\nLaunch copy\n#launch",
      bodyJson: {
        variants: [{ platform: "instagram", content: "Launch copy", hashtags: ["#launch"] }],
      },
      backend: "local:content-generate",
      correlationId: "local-correlation-composition",
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

// Mock ONLY the adapter boundary: `createHiaiKitClient` returns fakes for
// the capability client (writer) AND the carousel client. The real
// HiaiKitError classes/envelope stay intact via importOriginal.
vi.mock("../../src/integrations/hiai-kit/index.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/integrations/hiai-kit/index.js")
  >();
  return {
    ...actual,
    createHiaiKitClient: () => ({
      capabilities: { contentArticle: state.hiaiKitArticle },
      carousel: state.carouselClient.carousel,
    }),
  };
});

vi.mock("../../src/services/writer-local.js", () => ({
  localMastraSocialWriter: state.socialWriter,
}));

// The REAL production composition — the exact module api/index.ts boots.
const { createApiApp } = await import("../../src/api/app.js");

const app = createApiApp();

/** Mock Better Auth get-session: each token maps to a user. */
function stubSessionFetch() {
  const users: Record<string, { id: string; email: string; name: string; role: string }> = {
    "viewer-token": { id: "user-viewer", email: "viewer@example.com", name: "Viewer", role: "user" },
    "editor-token": { id: "user-editor", email: "editor@example.com", name: "Editor", role: "user" },
    "admin-token": { id: "user-admin", email: "admin@example.com", name: "Admin", role: "user" },
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

const carouselInput = {
  carouselTitle: "10 AI tools",
  slides: [
    { title: "Intro", content: "Why AI tools matter" },
    { title: "Pricing", content: "Free vs paid" },
  ],
  designPreset: "bold",
  handle: "@brand",
  ctaText: "Follow for more",
};

beforeEach(() => {
  stubSessionFetch();
  state.hiaiKitArticle.mockClear();
  state.socialWriter.mockClear();
  state.carouselClient.carousel.createJob.mockClear();
  state.db._tables.content_items = [];
  state.db._tables.content_item_revisions = [];
  state.db._tables.projects = [];
  state.db._tables.brands = [];
  state.db._tables.audit_logs = [];
  state.carouselClient.carousel.createJob.mockResolvedValue({
    jobId: state.JOB_ID,
    slug: "10-ai-tools",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("production composition: POST /api/v1/writer/generate", () => {
  it("is reachable — unauthenticated returns 401 (not 404)", async () => {
    const { status, body } = await request("/api/v1/writer/generate", {
      method: "POST",
      headers: { "X-Tenant-Id": state.TENANT_A },
      body: { contentType: "article", topic: "t" },
    });
    expect(status).toBe(401);
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("reaches the handler with an editor — 201 + persisted item", async () => {
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
    });
    expect(body.backend).toBe("hiai-kit:content.article");
    // The audit hook wrote a row for the mutating request.
    expect(state.db._tables.audit_logs).toHaveLength(1);
  });
});

describe("production composition: POST /api/v1/carousels", () => {
  it("is reachable — unauthenticated returns 401 (not 404)", async () => {
    const { status, body } = await request("/api/v1/carousels", {
      method: "POST",
      headers: { "X-Tenant-Id": state.TENANT_A },
      body: carouselInput,
    });
    expect(status).toBe(401);
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("reaches the handler with an editor — 201 + persisted carousel", async () => {
    const { status, body } = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    expect(status).toBe(201);
    expect(state.carouselClient.carousel.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ carouselTitle: "10 AI tools", designPreset: "bold" })
    );
    expect(body.item.bodyJson).toMatchObject({
      kind: "carousel",
      jobId: state.JOB_ID,
      jobStatus: "running",
    });
  });
});

describe("production composition: route ordering regression", () => {
  it("existing protected routes still resolve (GET /api/v1/content)", async () => {
    const { status, body } = await request("/api/v1/content", {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(status).toBe(200);
    expect(Array.isArray(body.items)).toBe(true);
  });

  it("unmatched paths still 404 via the real error handler", async () => {
    const { status, body } = await request("/api/v1/writer/does-not-exist", {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(status).toBe(404);
    expect(body.error).toBe("Not found");
  });
});
