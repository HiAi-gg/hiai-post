/**
 * HTTP integration tests for the carousel routes.
 *
 * Mounts the REAL `carouselsRoutes` plugin with the real auth → tenant →
 * rbac middleware chain, backed by an in-memory fake db + mocked
 * redis/logger + stubbed Better Auth session fetch. The ONLY external
 * boundary mocked is the hiai-kit adapter: `createHiaiKitClient` is stubbed
 * to return a fake carousel client (importOriginal keeps the real
 * HiaiKitError normalization). Covers:
 *   - gate envelopes (401/400/403) and RBAC (viewer read-only, editor write,
 *     admin-only approve)
 *   - POST /api/v1/carousels → 201 with { kind: "carousel" } bodyJson
 *   - tenant isolation at the route level (cross-tenant read/regenerate 404)
 *   - revision preservation (full + slide regeneration append, never rewrite)
 *   - adapter failures → normalized capability error, never fake success
 *   - approval flow (submit-review → approve)
 *
 * Run with: npx vitest run tests/integration/carousels-routes.test.ts
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
  const client = {
    carousel: {
      createJob: vi.fn(),
      regenerateSlide: vi.fn(),
      getJob: vi.fn(),
      getSlideJson: vi.fn(),
      listJobs: vi.fn(),
      getJobBySlug: vi.fn(),
      getCover: vi.fn(),
      saveSlideJson: vi.fn(),
      uploadSlidePng: vi.fn(),
      getSlidePng: vi.fn(),
      addBlankSlide: vi.fn(),
      editCover: vi.fn(),
    },
  };
  return {
    TENANT_A,
    TENANT_B,
    JOB_ID,
    client,
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

// Mock ONLY the adapter boundary: `createHiaiKitClient` returns the fake
// carousel client; the real HiaiKitError classes/envelope stay intact via
// importOriginal.
vi.mock("../../src/integrations/hiai-kit/index.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/integrations/hiai-kit/index.js")
  >();
  return {
    ...actual,
    createHiaiKitClient: () => state.client,
  };
});

const { Elysia } = await import("elysia");
const { HiaiKitError } = await import("../../src/integrations/hiai-kit/index.js");
const { carouselsRoutes } = await import("../../src/api/routes/carousels.js");

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
  .use(carouselsRoutes);

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

/** A document conforming to the verified hiai-kit slide document shape. */
const validSlideDoc = {
  version: 1,
  width: 1080,
  height: 1350,
  background: {
    type: "gradient",
    gradient: {
      type: "linear",
      angle: 135,
      stops: [
        { offset: 0, color: "#667eea" },
        { offset: 100, color: "#764ba2" },
      ],
    },
  },
  elements: [
    {
      id: "title",
      type: "text",
      x: 80,
      y: 160,
      rotation: 0,
      opacity: 1,
      visible: true,
      text: "10 AI tools",
      fontSize: 72,
      fontFamily: "Inter",
      fontWeight: "bold",
      fontStyle: "normal",
      textDecoration: "none",
      fill: "#ffffff",
      align: "left",
      lineHeight: 1.1,
      letterSpacing: 0,
      width: 920,
      height: 120,
      padding: 0,
    },
    {
      id: "body",
      type: "text",
      x: 80,
      y: 340,
      rotation: 0,
      opacity: 1,
      visible: true,
      text: "Why AI tools matter",
      fontSize: 36,
      fontFamily: "Inter",
      fontWeight: "normal",
      fontStyle: "normal",
      textDecoration: "none",
      fill: "#ffffff",
      align: "left",
      lineHeight: 1.4,
      letterSpacing: 0,
      width: 920,
      height: 300,
      padding: 0,
    },
  ],
};

function stubDoneJob() {
  state.client.carousel.createJob.mockResolvedValue({
    jobId: state.JOB_ID,
    slug: "10-ai-tools",
  });
  state.client.carousel.getJob.mockResolvedValue({
    jobId: state.JOB_ID,
    slug: "10-ai-tools",
    carouselTitle: "10 AI tools",
    status: "done",
    step: "done",
    stepIndex: 2,
    totalSteps: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    error: null,
    slideWidth: 1080,
    slideHeight: 1350,
    result: { coverImagePath: null, slidePngPaths: ["/s1.png", "/s2.png"] },
  });
  state.client.carousel.regenerateSlide.mockResolvedValue({
    json: { width: 1080, height: 1350, title: "Slide 1 v2" },
  });
  state.client.carousel.getSlideJson.mockResolvedValue({
    width: 1080,
    height: 1350,
    background: { color: "#111" },
  });
  state.client.carousel.saveSlideJson.mockResolvedValue({
    ok: true,
    json: validSlideDoc,
  });
  state.client.carousel.uploadSlidePng.mockResolvedValue({
    ok: true,
    fileName: "slide_1.png",
  });
  state.client.carousel.addBlankSlide.mockResolvedValue({
    slideNumber: 3,
    json: validSlideDoc,
  });
  state.client.carousel.editCover.mockResolvedValue({
    coverImagePath: "cover.png",
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
}

beforeEach(() => {
  stubSessionFetch();
  state.db._tables.content_items = [];
  state.db._tables.content_item_revisions = [];
  vi.clearAllMocks();
  stubDoneJob();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("gate envelopes", () => {
  it("returns 401 without an Authorization header", async () => {
    const { status, body } = await request("/api/v1/carousels", {
      headers: { "X-Tenant-Id": state.TENANT_A },
    });
    expect(status).toBe(401);
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("returns 400 when X-Tenant-Id is missing", async () => {
    const { status, body } = await request("/api/v1/carousels", {
      headers: { Authorization: "Bearer viewer-token" },
    });
    expect(status).toBe(400);
    expect(body.code).toBe("TENANT_HEADER_REQUIRED");
  });

  it("returns 403 for a tenant the user is not a member of", async () => {
    const { status, body } = await request("/api/v1/carousels", {
      headers: auth("outsider-token", state.TENANT_A),
    });
    expect(status).toBe(403);
    expect(body.code).toBe("TENANT_ACCESS_DENIED");
  });
});

describe("RBAC on carousel routes", () => {
  it("lets a viewer list carousels but denies creating one", async () => {
    const list = await request("/api/v1/carousels", {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);

    const denied = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("viewer-token", state.TENANT_A),
      body: carouselInput,
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("INSUFFICIENT_ROLE");
    expect(state.client.carousel.createJob).not.toHaveBeenCalled();
  });

  it("lets an editor create (201) but not approve; admin approves", async () => {
    const created = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    expect(created.status).toBe(201);
    expect(created.body.job).toEqual({ jobId: state.JOB_ID, slug: "10-ai-tools" });
    const itemId = created.body.item.id;

    const denied = await request(`/api/v1/carousels/${itemId}/approve`, {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("INSUFFICIENT_ROLE");
  });
});

describe("carousel lifecycle", () => {
  it("creates a carousel with { kind: 'carousel' } bodyJson through the adapter", async () => {
    const { status, body } = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { ...carouselInput, tenantId: state.TENANT_B }, // body tenantId must be ignored
    });
    expect(status).toBe(201);
    expect(body.item.tenantId).toBe(state.TENANT_A);
    expect(body.item.source).toBe("web"); // session principal → interactive web UI
    expect(body.item.currentRevisionNumber).toBe(1);
    expect(body.item.bodyJson).toMatchObject({
      kind: "carousel",
      jobId: state.JOB_ID,
      jobStatus: "running",
      slides: carouselInput.slides,
    });
    expect(state.client.carousel.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ carouselTitle: "10 AI tools", designPreset: "bold" })
    );

    const fetched = await request(`/api/v1/carousels/${body.item.id}`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(fetched.status).toBe(200);
    expect(fetched.body.item.bodyJson.kind).toBe("carousel");
  });

  it("exposes revisions, live job status and slide documents", async () => {
    const created = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    const itemId = created.body.item.id;

    const revisions = await request(`/api/v1/carousels/${itemId}/revisions`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(revisions.status).toBe(200);
    expect(revisions.body.revisions).toHaveLength(1);
    expect(revisions.body.revisions[0].revisionNumber).toBe(1);

    const job = await request(`/api/v1/carousels/${itemId}/job`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(job.status).toBe(200);
    expect(job.body.job.status).toBe("done");
    expect(state.client.carousel.getJob).toHaveBeenCalledWith(state.JOB_ID);

    const slide = await request(`/api/v1/carousels/${itemId}/slides/1/json`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(slide.status).toBe(200);
    expect(slide.body.json).toMatchObject({ width: 1080 });
  });

  it("returns 400 for an invalid slide index", async () => {
    const created = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    const { status, body } = await request(
      `/api/v1/carousels/${created.body.item.id}/slides/99/regenerate`,
      { method: "POST", headers: auth("editor-token", state.TENANT_A), body: {} }
    );
    expect(status).toBe(400);
    expect(body.error).toBe("Validation failed");
    expect(state.client.carousel.regenerateSlide).not.toHaveBeenCalled();
  });
});

describe("tenant isolation at the route level", () => {
  it("returns 404 for another tenant's carousel on every scoped route", async () => {
    const created = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    const itemId = created.body.item.id;
    state.client.carousel.getJob.mockClear();

    const get = await request(`/api/v1/carousels/${itemId}`, {
      headers: auth("viewer-b-token", state.TENANT_B),
    });
    expect(get.status).toBe(404);
    expect(get.body.code).toBe("NOT_FOUND");

    const regen = await request(`/api/v1/carousels/${itemId}/regenerate`, {
      method: "POST",
      headers: auth("editor-b-token", state.TENANT_B),
      body: {},
    });
    expect(regen.status).toBe(404);

    const slideRegen = await request(`/api/v1/carousels/${itemId}/slides/1/regenerate`, {
      method: "POST",
      headers: auth("editor-b-token", state.TENANT_B),
      body: {},
    });
    expect(slideRegen.status).toBe(404);

    const job = await request(`/api/v1/carousels/${itemId}/job`, {
      headers: auth("viewer-b-token", state.TENANT_B),
    });
    expect(job.status).toBe(404);
    expect(state.client.carousel.getJob).not.toHaveBeenCalled();
    // No cross-tenant mutations.
    expect(state.client.carousel.createJob).toHaveBeenCalledTimes(1);
    expect(state.client.carousel.regenerateSlide).not.toHaveBeenCalled();
  });

  it("lists only the principal tenant's carousels", async () => {
    await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-b-token", state.TENANT_B),
      body: { ...carouselInput, carouselTitle: "B deck" },
    });

    const list = await request(`/api/v1/carousels?tenantId=${state.TENANT_B}`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].title).toBe("10 AI tools");
  });
});

describe("revision preservation over HTTP", () => {
  it("full regeneration appends a revision; original bodyJson preserved", async () => {
    const created = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    const itemId = created.body.item.id;
    const nextJobId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    state.client.carousel.createJob.mockResolvedValue({
      jobId: nextJobId,
      slug: "10-ai-tools-v2",
    });

    const regen = await request(`/api/v1/carousels/${itemId}/regenerate`, {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { slides: [{ title: "New intro", content: "Updated" }, { title: "Pricing", content: "Free" }] },
    });
    expect(regen.status).toBe(200);
    expect(regen.body.item.bodyJson.jobId).toBe(nextJobId);
    expect(regen.body.revision.changeNote).toBe("Full carousel regenerated");
    // Regeneration appended a revision → the current-revision pointer advanced.
    expect(regen.body.item.currentRevisionNumber).toBe(2);
    expect(regen.body.revision.revisionNumber).toBe(2);

    const revisions = await request(`/api/v1/carousels/${itemId}/revisions`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(revisions.body.revisions).toHaveLength(2);
    expect(revisions.body.revisions.map((r: any) => r.revisionNumber)).toEqual([2, 1]);
    expect(revisions.body.revisions[1].bodyJson.jobId).toBe(state.JOB_ID);
    expect(revisions.body.revisions[1].bodyJson.slides).toEqual(carouselInput.slides);
  });

  it("slide regeneration persists the regenerated document and preserves history", async () => {
    const created = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    const itemId = created.body.item.id;

    const regen = await request(`/api/v1/carousels/${itemId}/slides/1/regenerate`, {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { description: "punchier" },
    });
    expect(regen.status).toBe(200);
    expect(regen.body.slide.doc).toMatchObject({ title: "Slide 1 v2" });
    expect(regen.body.item.currentRevisionNumber).toBe(2);
    expect(state.client.carousel.regenerateSlide).toHaveBeenCalledWith(
      state.JOB_ID,
      1,
      "punchier"
    );

    const revisions = await request(`/api/v1/carousels/${itemId}/revisions`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(revisions.body.revisions).toHaveLength(2);
    expect(revisions.body.revisions[0].bodyJson.slides[0].doc).toMatchObject({ title: "Slide 1 v2" });
    // Original revision untouched.
    expect(revisions.body.revisions[1].bodyJson.slides[0].doc).toBeUndefined();
  });
});

describe("adapter failures surface honestly", () => {
  it("maps an auth-blocked hiai-kit 401 to a normalized error and persists nothing", async () => {
    state.client.carousel.createJob.mockRejectedValue(
      new HiaiKitError("HIAI_KIT_ERROR", "Authentication required", 401, {
        path: "/api/v1/carousel",
        correlationId: "corr-1",
      })
    );
    const { status, body } = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    expect(status).toBe(401);
    expect(body.error).toBe("HIAI_KIT_ERROR");
    expect(body.code).toBe("HIAI_KIT_ERROR");
    expect(state.db._tables.content_items).toHaveLength(0);
  });

  it("maps an adapter timeout to 504 and leaves history unchanged", async () => {
    const created = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    const itemId = created.body.item.id;

    state.client.carousel.createJob.mockRejectedValue(
      new HiaiKitError("TIMEOUT", "hiai-kit request timed out after 7000ms", 504, {
        correlationId: "corr-2",
        path: "/api/v1/carousel",
        timeoutMs: 7000,
      })
    );
    const regen = await request(`/api/v1/carousels/${itemId}/regenerate`, {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: {},
    });
    expect(regen.status).toBe(504);
    expect(regen.body.code).toBe("TIMEOUT");

    const revisions = await request(`/api/v1/carousels/${itemId}/revisions`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(revisions.body.revisions).toHaveLength(1);
  });
});

describe("approval flow over HTTP", () => {
  it("draft → submit-review → approve with admin", async () => {
    const created = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    const itemId = created.body.item.id;

    const reviewed = await request(`/api/v1/carousels/${itemId}/submit-review`, {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
    });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.item.status).toBe("in_review");

    const approved = await request(`/api/v1/carousels/${itemId}/approve`, {
      method: "POST",
      headers: auth("admin-token", state.TENANT_A),
    });
    expect(approved.status).toBe(200);
    expect(approved.body.item.status).toBe("approved");
  });

  it("request-changes records the reviewer note and resubmission works", async () => {
    const created = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    const itemId = created.body.item.id;
    await request(`/api/v1/carousels/${itemId}/submit-review`, {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
    });

    const requested = await request(`/api/v1/carousels/${itemId}/request-changes`, {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { note: "tone down the hype" },
    });
    expect(requested.status).toBe(200);
    expect(requested.body.item.status).toBe("changes_requested");
    expect(requested.body.item.reviewNote).toBe("tone down the hype");

    const resubmitted = await request(`/api/v1/carousels/${itemId}/submit-review`, {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
    });
    expect(resubmitted.body.item.status).toBe("in_review");
  });
});

describe("slide document save over HTTP", () => {
  it("PUT persists the document, advances the revision, and read-back returns it", async () => {
    const created = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    const itemId = created.body.item.id;

    const saved = await request(`/api/v1/carousels/${itemId}/slides/2/json`, {
      method: "PUT",
      headers: auth("editor-token", state.TENANT_A),
      body: validSlideDoc,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.item.currentRevisionNumber).toBe(2);
    expect(saved.body.revision.changeNote).toBe("Slide 2 document saved");
    expect(saved.body.revision.revisionNumber).toBe(2);
    expect(saved.body.slide).toMatchObject({
      title: "Pricing",
      content: "Free vs paid",
    });
    expect(saved.body.slide.doc).toEqual(validSlideDoc);
    // Only the selected slide changed — slide 1 untouched.
    expect(saved.body.item.bodyJson.slides[0].doc).toBeUndefined();

    // Read-back via GET /:id and GET /:id/revisions.
    const fetched = await request(`/api/v1/carousels/${itemId}`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(fetched.status).toBe(200);
    expect(fetched.body.item.bodyJson.slides[1].doc).toEqual(validSlideDoc);

    const revisions = await request(`/api/v1/carousels/${itemId}/revisions`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(revisions.body.revisions).toHaveLength(2);
    expect(revisions.body.revisions[0].bodyJson.slides[1].doc).toEqual(validSlideDoc);
    // Original revision untouched.
    expect(revisions.body.revisions[1].bodyJson.slides).toEqual(carouselInput.slides);
  });

  it("rejects an invalid document with 400 and persists nothing (no fake success)", async () => {
    const created = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    const itemId = created.body.item.id;

    const invalid = await request(`/api/v1/carousels/${itemId}/slides/1/json`, {
      method: "PUT",
      headers: auth("editor-token", state.TENANT_A),
      body: { foo: "bar" },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("VALIDATION");
    expect(invalid.body.error).toBe("Validation failed");

    const revisions = await request(`/api/v1/carousels/${itemId}/revisions`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(revisions.body.revisions).toHaveLength(1);
    expect(revisions.body.revisions[0].revisionNumber).toBe(1);

    const fetched = await request(`/api/v1/carousels/${itemId}`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(fetched.body.item.currentRevisionNumber).toBe(1);
    expect(fetched.body.item.bodyJson.slides[0].doc).toBeUndefined();
    expect(fetched.body.item.bodyJson.slides[1].doc).toBeUndefined();
  });

  it("rejects an invalid slide index with 400 and persists nothing", async () => {
    const created = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    const itemId = created.body.item.id;

    const invalid = await request(`/api/v1/carousels/${itemId}/slides/99/json`, {
      method: "PUT",
      headers: auth("editor-token", state.TENANT_A),
      body: validSlideDoc,
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("Validation failed");

    const revisions = await request(`/api/v1/carousels/${itemId}/revisions`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(revisions.body.revisions).toHaveLength(1);
  });

  it("denies viewers (403) without touching the item", async () => {
    const created = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    const itemId = created.body.item.id;

    const denied = await request(`/api/v1/carousels/${itemId}/slides/1/json`, {
      method: "PUT",
      headers: auth("viewer-token", state.TENANT_A),
      body: validSlideDoc,
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("INSUFFICIENT_ROLE");

    const revisions = await request(`/api/v1/carousels/${itemId}/revisions`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(revisions.body.revisions).toHaveLength(1);
  });

  it("returns 404 for another tenant's carousel and never mutates it", async () => {
    const created = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    const itemId = created.body.item.id;

    const denied = await request(`/api/v1/carousels/${itemId}/slides/1/json`, {
      method: "PUT",
      headers: auth("editor-b-token", state.TENANT_B),
      body: validSlideDoc,
    });
    expect(denied.status).toBe(404);
    expect(denied.body.code).toBe("NOT_FOUND");

    const revisions = await request(`/api/v1/carousels/${itemId}/revisions`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(revisions.body.revisions).toHaveLength(1);
    expect(revisions.body.revisions[0].revisionNumber).toBe(1);

    const fetched = await request(`/api/v1/carousels/${itemId}`, {
      headers: auth("viewer-token", state.TENANT_A),
    });
    expect(fetched.body.item.currentRevisionNumber).toBe(1);
    expect(fetched.body.item.bodyJson.slides[0].doc).toBeUndefined();
  });
});

describe("add blank slide and cover edit", () => {
  it("adds a blank slide and appends a revision", async () => {
    const created = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    const itemId = created.body.item.id;

    const added = await request(`/api/v1/carousels/${itemId}/slides/add`, {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
    });
    expect(added.status).toBe(200);
    expect(added.body.slideNumber).toBe(3);
    expect(added.body.item.bodyJson.slides).toHaveLength(3);
    expect(state.client.carousel.addBlankSlide).toHaveBeenCalledWith(state.JOB_ID);

    const revisions = await request(`/api/v1/carousels/${itemId}/revisions`, {
      headers: auth("editor-token", state.TENANT_A),
    });
    expect(revisions.body.revisions).toHaveLength(2);
    expect(revisions.body.revisions[0].changeNote).toBe("Blank slide 3 added");
  });

  it("edits the cover through the kit adapter", async () => {
    const created = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    const itemId = created.body.item.id;

    const edited = await request(`/api/v1/carousels/${itemId}/cover/edit`, {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { description: "make the sky darker" },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.coverImagePath).toBe("cover.png");
    expect(state.client.carousel.editCover).toHaveBeenCalledWith(state.JOB_ID, "make the sky darker");
  });

  it("rejects an empty cover description", async () => {
    const created = await request("/api/v1/carousels", {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: carouselInput,
    });
    const denied = await request(`/api/v1/carousels/${created.body.item.id}/cover/edit`, {
      method: "POST",
      headers: auth("editor-token", state.TENANT_A),
      body: { description: "" },
    });
    expect(denied.status).toBe(400);
    expect(state.client.carousel.editCover).not.toHaveBeenCalled();
  });
});
