/**
 * HTTP integration tests for the Phase 3 shared product foundation routes.
 *
 * Mounts the REAL route plugins (contentRoutes, projectsRoutes) with the
 * real auth → tenant → rbac middleware chain, backed by an in-memory fake
 * db + mocked redis/logger + stubbed Better Auth session fetch. Covers:
 *   - auth / tenant / rbac gate status envelopes (401/400/403)
 *   - tenant isolation at the route level (query/body tenantId is ignored)
 *   - RBAC: viewer read-only; editor write; admin-only approve
 *   - service error envelopes: 404 NOT_FOUND, 409 INVALID_TRANSITION,
 *     400 VALIDATION with details
 *
 * Run with: npx vitest run tests/integration/content-routes.test.ts
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
      { tenantId: state.TENANT_B, userId: "user-viewer-b", role: "viewer" },
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
  return { logger: { child: () => ({ warn: noop, error: noop, info: noop, debug: noop }), ...{ warn: noop, error: noop, info: noop, debug: noop } } };
});

const { Elysia } = await import("elysia");
const { contentRoutes } = await import("../../src/api/routes/content.js");
const { projectsRoutes } = await import("../../src/api/routes/projects.js");

/** Mock Better Auth get-session: each token maps to a user. */
function stubSessionFetch() {
  const users: Record<string, { id: string; email: string; name: string; role: string }> = {
    "viewer-token": { id: "user-viewer", email: "viewer@example.com", name: "Viewer", role: "user" },
    "editor-token": { id: "user-editor", email: "editor@example.com", name: "Editor", role: "user" },
    "admin-token": { id: "user-admin", email: "admin@example.com", name: "Admin", role: "user" },
    "outsider-token": { id: "user-outsider", email: "o@example.com", name: "Outsider", role: "user" },
    "viewer-b-token": { id: "user-viewer-b", email: "vb@example.com", name: "ViewerB", role: "user" },
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
  .use(projectsRoutes)
  .use(contentRoutes);

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
    const { status, body } = await request("/api/v1/content", {
      headers: { "X-Tenant-Id": state.TENANT_A },
    });
    expect(status).toBe(401);
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("returns 400 when X-Tenant-Id is missing", async () => {
    const { status, body } = await request("/api/v1/content", {
      headers: { Authorization: "Bearer viewer-token" },
    });
    expect(status).toBe(400);
    expect(body.code).toBe("TENANT_HEADER_REQUIRED");
  });

  it("returns 403 for a tenant the user is not a member of", async () => {
    const { status, body } = await request("/api/v1/content", {
      headers: auth("outsider-token", state.TENANT_A),
    });
    expect(status).toBe(403);
    expect(body.code).toBe("TENANT_ACCESS_DENIED");
  });
});

describe("RBAC on content routes", () => {
  it("lets a viewer list content items (200)", async () => {
    const { status, body } = await request("/api/v1/content", {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.pagination.total).toBe(0);
  });

  it("denies a viewer creating a content item (403 INSUFFICIENT_ROLE)", async () => {
    const { status, body } = await request("/api/v1/content", {
      method: "POST",
      headers: auth("viewer-token", state.TENANT_A),
      body: { title: "nope" },
    });
    expect(status).toBe(403);
    expect(body.code).toBe("INSUFFICIENT_ROLE");
  });

  it("lets an editor create a content item (201) and approve requires admin (403)", async () => {
    const created = await request("/api/v1/content", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { title: "Launch copy", bodyText: "Draft body" },
    });
    expect(created.status).toBe(201);
    expect(created.body.item).toMatchObject({
      title: "Launch copy",
      status: "draft",
      tenantId: state.TENANT_A,
      source: "web", // session principal → interactive web UI
      currentRevisionNumber: 1,
    });
    const itemId = created.body.item.id;

    // Editor cannot approve (governance = admin+).
    const denied = await request(`/api/v1/content/${itemId}/approve`, {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("INSUFFICIENT_ROLE");
  });
});

describe("tenant isolation at the route level", () => {
  it("ignores query/body tenantId — scopes to the principal tenant", async () => {
    // Create an item in tenant A as editor.
    const created = await request("/api/v1/content", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { title: "A-item", tenantId: state.TENANT_B }, // body tenantId must be ignored
    });
    expect(created.status).toBe(201);
    expect(created.body.item.tenantId).toBe(state.TENANT_A);

    // List with a query tenantId pointing at tenant B — still only tenant A items.
    const list = await request(`/api/v1/content?tenantId=${state.TENANT_B}`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].title).toBe("A-item");
  });

  it("returns 404 for an item in another tenant", async () => {
    const created = await request("/api/v1/content", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { title: "secret" },
    });
    const itemId = created.body.item.id;

    // A member of tenant B must not see tenant A's item.
    const { status, body } = await request(`/api/v1/content/${itemId}`, {
      headers: auth("viewer-b-token", state.TENANT_B),
    });
    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });
});

describe("service error envelopes over HTTP", () => {
  it("returns 404 NOT_FOUND for a missing content item", async () => {
    const { status, body } = await request(
      "/api/v1/content/99999999-9999-4999-8999-999999999999",
      { headers: auth("viewer-token", state.TENANT_A) }
    );
    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 400 VALIDATION with details for an invalid body", async () => {
    const { status, body } = await request("/api/v1/content", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { title: "" },
    });
    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION");
    expect(body.details).toBeDefined();
  });

  it("returns 409 INVALID_TRANSITION when approving a draft", async () => {
    const created = await request("/api/v1/content", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { title: "draft item" },
    });
    const itemId = created.body.item.id;

    const { status, body } = await request(`/api/v1/content/${itemId}/approve`, {
      method: "POST",
      headers: auth("admin-token", state.TENANT_A),
    });
    expect(status).toBe(409);
    expect(body.code).toBe("INVALID_TRANSITION");
    expect(body.error).toContain("Cannot 'approve' from status 'draft'");
  });
});

describe("full approval flow over HTTP", () => {
  it("draft → submit-review → approve with admin", async () => {
    const created = await request("/api/v1/content", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { title: "campaign copy" },
    });
    const itemId = created.body.item.id;

    const reviewed = await request(`/api/v1/content/${itemId}/submit-review`, {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
    });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.item.status).toBe("in_review");

    const approved = await request(`/api/v1/content/${itemId}/approve`, {
      method: "POST",
      headers: auth("admin-token", state.TENANT_A),
    });
    expect(approved.status).toBe(200);
    expect(approved.body.item.status).toBe("approved");
  });

  it("projects: editor creates a project + brand; viewer reads context", async () => {
    const created = await request("/api/v1/projects", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { name: "Q3 Launch", description: "summer" },
    });
    expect(created.status).toBe(201);
    const projectId = created.body.project.id;

    const brand = await request(`/api/v1/projects/${projectId}/brands`, {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { name: "Nike", voice: "bold" },
    });
    expect(brand.status).toBe(201);
    expect(brand.body.brand.projectId).toBe(projectId);

    const context = await request(`/api/v1/projects/${projectId}/context`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(context.status).toBe(200);
    expect(context.body.brands).toHaveLength(1);

    // Viewer cannot create a project.
    const denied = await request("/api/v1/projects", {
      method: "POST",
      headers: auth("viewer-token", state.TENANT_A),
      body: { name: "x" },
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("INSUFFICIENT_ROLE");
  });
});

describe("Phase 2 — brand context fields on projects/brands", () => {
  it("persists and returns the full project brand context", async () => {
    const created = await request("/api/v1/projects", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: {
        name: "Flagship",
        description: "Launch program",
        defaultLanguage: "en-US",
        targetAudience: "Series A marketing leads",
        tone: "confident",
        contentGuidelines: "No superlatives",
        businessContext: "Analytics SaaS",
        references: [{ type: "style-guide", url: "https://example.com/style", title: "Style guide" }],
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.project).toMatchObject({
      name: "Flagship",
      defaultLanguage: "en-US",
      targetAudience: "Series A marketing leads",
      tone: "confident",
      contentGuidelines: "No superlatives",
      businessContext: "Analytics SaaS",
    });
    expect(created.body.project.references).toHaveLength(1);

    const projectId = created.body.project.id;
    const fetched = await request(`/api/v1/projects/${projectId}`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(fetched.status).toBe(200);
    expect(fetched.body.project.defaultLanguage).toBe("en-US");

    const context = await request(`/api/v1/projects/${projectId}/context`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(context.status).toBe(200);
    expect(context.body.project.tone).toBe("confident");
    expect(context.body.project.businessContext).toBe("Analytics SaaS");

    // Partial update leaves the other context fields intact.
    const updated = await request(`/api/v1/projects/${projectId}`, {
      method: "PUT",
      headers: auth("editor-token", state.TENANT_A),
      body: { tone: "punchy" },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.project.tone).toBe("punchy");
    expect(updated.body.project.defaultLanguage).toBe("en-US");
  });
});

describe("Phase 2 — content source + current revision pointer over HTTP", () => {
  it("returns source and currentRevisionNumber, advancing on revisions and restore", async () => {
    const created = await request("/api/v1/content", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { title: "v1" },
    });
    const itemId = created.body.item.id;
    expect(created.body.item.source).toBe("web");
    expect(created.body.item.currentRevisionNumber).toBe(1);

    // Revision #2 → pointer advances.
    await request(`/api/v1/content/${itemId}/revisions`, {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { bodyText: "v2 body" },
    });
    const afterRev = await request(`/api/v1/content/${itemId}`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(afterRev.body.item.currentRevisionNumber).toBe(2);

    // List shows the pointer too.
    const list = await request("/api/v1/content", {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(list.body.items[0].currentRevisionNumber).toBe(2);

    // Restore revision #1 → appends revision #3, pointer becomes 3.
    const revisions = await request(`/api/v1/content/${itemId}/revisions`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    const rev1 = revisions.body.revisions.find((r: any) => r.revisionNumber === 1);
    const restored = await request(`/api/v1/content/${itemId}/revisions/${rev1.id}/restore`, {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
    });
    expect(restored.status).toBe(200);
    expect(restored.body.item.currentRevisionNumber).toBe(3);
    expect(restored.body.revision.revisionNumber).toBe(3);

    // Append-only history preserved: 3 revisions, all intact.
    const afterRestore = await request(`/api/v1/content/${itemId}/revisions`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(afterRestore.body.revisions).toHaveLength(3);
  });

  it("overrides any client-provided source with the principal-derived value", async () => {
    const created = await request("/api/v1/content", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { title: "lying", source: "webhook" }, // client cannot mislabel provenance
    });
    expect(created.status).toBe(201);
    expect(created.body.item.source).toBe("web");
  });
});

describe("Phase 2 — cross-tenant revision access (negative)", () => {
  it("denies listing/creating/restoring revisions on another tenant's item (404)", async () => {
    const created = await request("/api/v1/content", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { title: "A secret" },
    });
    const itemId = created.body.item.id;

    // List revisions as a tenant-B editor → 404 (item not in tenant B).
    const list = await request(`/api/v1/content/${itemId}/revisions`, {
      headers: auth("editor-b-token", state.TENANT_B),
    });
    expect(list.status).toBe(404);
    expect(list.body.code).toBe("NOT_FOUND");

    // Create a revision as tenant B → 404 (getContentItem gate).
    const createRev = await request(`/api/v1/content/${itemId}/revisions`, {
      method: "POST",
      headers: auth("editor-b-token", state.TENANT_B),
      body: { bodyText: "pwned" },
    });
    expect(createRev.status).toBe(404);
    expect(createRev.body.code).toBe("NOT_FOUND");

    // Restore as tenant B → 404.
    const restore = await request(
      `/api/v1/content/${itemId}/revisions/99999999-9999-4999-8999-999999999999/restore`,
      {
        method: "POST",
        headers: auth("editor-b-token", state.TENANT_B),
      }
    );
    expect(restore.status).toBe(404);
    expect(restore.body.code).toBe("NOT_FOUND");

    // Tenant A's history is untouched.
    const listA = await request(`/api/v1/content/${itemId}/revisions`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(listA.body.revisions).toHaveLength(1);
  });
});
