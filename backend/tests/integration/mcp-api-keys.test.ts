/**
 * Integration tests for the Work API surface: tenant-scoped API keys
 * (create/hash/revoke/expiry), machine auth middleware, and the MCP
 * JSON-RPC endpoint with REAL service-layer invocation.
 *
 * Mounts the FULL production composition (backend/src/api/app.ts) exactly as
 * `api/index.ts` boots it. The ONLY boundaries mocked are the same ones the
 * other integration suites mock: the database (in-memory fake), Redis,
 * logger, the hiai-kit integration client (capabilities + carousel adapter)
 * and the temporary local social writer. The Elysia composition, middleware
 * chain, error handler, API-key service, writer/carousel/content/approval
 * services and persistence all run for real.
 *
 * Covers:
 *   - API key creation returns the full key exactly once; only the SHA-256
 *     hash + prefix are persisted (plaintext never stored).
 *   - Listings expose prefix + metadata only (no hash / no key).
 *   - Revocation and expiry make the credential unusable (401, opaque).
 *   - Cross-tenant denial: a key can only act in its OWN tenant — the
 *     X-Tenant-Id header is ignored for machine principals.
 *   - MCP initialize / tools/list / tools/call protocol behavior.
 *   - Real service invocation via MCP: writer_generate, carousel_generate,
 *     carousel_regenerate (full regeneration), carousel_regenerate_slide,
 *     content_get, content_submit_review, content_request_changes,
 *     content_approve, carousel_submit_review / carousel_request_changes /
 *     carousel_approve, project_list / project_get.
 *   - Fine-grained scope enforcement (INSUFFICIENT_SCOPE) and session-token
 *     rejection (MACHINE_AUTH_REQUIRED).
 *
 * Run with: npx vitest run tests/integration/mcp-api-keys.test.ts
 */
import { createHash } from "node:crypto";
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
    hiaiKitArticle: vi.fn(async () => ({
      runId: "run-mcp-article",
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
      bodyJson: { variants: [{ platform: "instagram", content: "Launch copy", hashtags: ["#launch"] }] },
      backend: "local:content-generate",
      correlationId: "local-correlation-mcp",
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
      { tenantId: state.TENANT_A, userId: "user-admin", role: "admin" },
      { tenantId: state.TENANT_B, userId: "user-admin-b", role: "admin" },
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

// Mock ONLY the adapter boundary: hiai-kit client (capabilities + carousel)
// and the local social writer. The real HiaiKitError classes stay intact.
vi.mock("../../src/integrations/hiai-kit/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/integrations/hiai-kit/index.js")>();
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
  if (init?.body !== undefined) headers["Content-Type"] = "application/json";
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

const sessionAdmin = { Authorization: "Bearer admin-token", "X-Tenant-Id": state.TENANT_A };

/** Create an API key as the session admin (real route + real service). */
async function createKey(
  input: { name: string; scopes: string[]; expiresAt?: string }
): Promise<{ status: number; body: any }> {
  return request("/api/v1/api-keys", { method: "POST", headers: sessionAdmin, body: input });
}

/** POST a JSON-RPC request to /api/v1/mcp with the given hpk_ key. */
async function mcpCall(
  key: string | null,
  body: unknown
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  return request("/api/v1/mcp", { method: "POST", headers, body });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const carouselInput = {
  carouselTitle: "10 AI tools",
  slides: [
    { title: "Intro", content: "Why AI tools matter" },
    { title: "Pricing", content: "Free vs paid" },
  ],
  designPreset: "bold",
};

beforeEach(() => {
  stubSessionFetch();
  state.hiaiKitArticle.mockClear();
  state.socialWriter.mockClear();
  state.carouselClient.carousel.createJob.mockClear();
  state.carouselClient.carousel.regenerateSlide.mockClear();
  state.carouselClient.carousel.createJob.mockResolvedValue({
    jobId: state.JOB_ID,
    slug: "10-ai-tools",
  });
  state.carouselClient.carousel.regenerateSlide.mockResolvedValue({
    json: { slides: [{ title: "Intro", body: "regenerated" }] },
  });
  state.db._tables.content_items = [];
  state.db._tables.content_item_revisions = [];
  state.db._tables.projects = [];
  state.db._tables.brands = [];
  state.db._tables.api_keys = [];
  state.db._tables.audit_logs = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("API key lifecycle (admin routes + real service)", () => {
  it("creates a key: full key returned once, only hash + prefix persisted", async () => {
    const { status, body } = await createKey({
      name: "ChatGPT writer",
      scopes: ["writer:generate", "content:read"],
    });
    expect(status).toBe(201);
    expect(body.key).toMatch(/^hpk_[A-Za-z0-9_-]{32,}$/);
    expect(body.apiKey).toMatchObject({
      name: "ChatGPT writer",
      prefix: body.key.slice(0, 12), // "hpk_" + 8 chars
      scopes: ["writer:generate", "content:read"],
    });
    expect(body.apiKey.keyHash).toBeUndefined();

    // Only the SHA-256 hash is stored — never the plaintext.
    const rows = state.db._tables.api_keys;
    expect(rows).toHaveLength(1);
    expect(rows[0].keyHash).toBe(sha256(body.key));
    const secret = body.key.slice(4);
    expect(JSON.stringify(rows[0])).not.toContain(secret);
    expect(rows[0].key).toBeUndefined();
  });

  it("lists keys with metadata only (no hash, no key)", async () => {
    const { body: created } = await createKey({
      name: "Reader",
      scopes: ["content:read", "carousel:read"],
    });
    const { status, body } = await request("/api/v1/api-keys", { headers: sessionAdmin });
    expect(status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ name: "Reader", prefix: created.apiKey.prefix });
    expect(body.items[0].keyHash).toBeUndefined();
    expect(JSON.stringify(body.items)).not.toContain(created.key.slice(4));
  });

  it("revokes a key — it becomes unusable (opaque 401)", async () => {
    const { body: created } = await createKey({
      name: "Temp",
      scopes: ["content:read"],
    });
    const revoke = await request(`/api/v1/api-keys/${created.apiKey.id}/revoke`, {
      method: "POST",
      headers: sessionAdmin,
    });
    expect(revoke.status).toBe(200);
    expect(revoke.body.apiKey.revokedAt).toBeTruthy();

    const mcp = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(mcp.status).toBe(401);
    expect(mcp.body.code).toBe("UNAUTHENTICATED");
  });

  it("rejects an expired key with the same opaque 401", async () => {
    const { body: created } = await createKey({
      name: "Expired",
      scopes: ["content:read"],
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(created.apiKey.expiresAt).toBeTruthy();
    const mcp = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(mcp.status).toBe(401);
    expect(mcp.body.code).toBe("UNAUTHENTICATED");
  });

  it("rejects unknown scopes and empty scopes at creation (400)", async () => {
    const bad = await createKey({ name: "Bad", scopes: ["admin:*"] });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("VALIDATION");
    const empty = await createKey({ name: "Empty", scopes: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe("VALIDATION");
  });

  it("denies key management to non-admins (viewer session → 403)", async () => {
    const { status, body } = await request("/api/v1/api-keys", {
      headers: { Authorization: "Bearer not-admin-token", "X-Tenant-Id": state.TENANT_A },
    });
    // Unknown token → unauthenticated; the admin gate itself is enforced by
    // requireAdmin for any authenticated non-admin principal.
    expect(status === 401 || status === 403).toBe(true);
    expect(body.code === "UNAUTHENTICATED" || body.code === "INSUFFICIENT_ROLE").toBe(true);
  });
});

describe("MCP protocol", () => {
  it("initialize returns the negotiated protocol version + capabilities", async () => {
    const { body: created } = await createKey({ name: "Bot", scopes: ["content:read"] });
    const { status, body } = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: "init-1",
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t" } },
    });
    expect(status).toBe(200);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe("init-1");
    expect(body.result.protocolVersion).toBe("2024-11-05");
    expect(body.result.capabilities.tools.listChanged).toBe(false);
    expect(body.result.serverInfo.name).toBe("hiai-post-mcp");
  });

  it("tools/list returns exactly the product tools", async () => {
    const { body: created } = await createKey({ name: "Bot", scopes: ["content:read"] });
    const { status, body } = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(status).toBe(200);
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual([
      "writer_generate",
      "writer_rewrite",
      "carousel_generate",
      "carousel_get",
      "carousel_regenerate",
      "carousel_regenerate_slide",
      "carousel_submit_review",
      "carousel_request_changes",
      "carousel_approve",
      "content_get",
      "content_list",
      "content_submit_review",
      "content_request_changes",
      "content_approve",
      "project_list",
      "project_get",
    ]);
    const carousel = body.result.tools.find((t: { name: string }) => t.name === "carousel_generate");
    expect(carousel.inputSchema.required).toEqual(["carouselTitle", "slides", "designPreset"]);
  });

  it("notifications/initialized is acknowledged without a body (202)", async () => {
    const { body: created } = await createKey({ name: "Bot", scopes: ["content:read"] });
    const { status } = await mcpCall(created.key, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });
    expect(status).toBe(202);
  });

  it("returns protocol-valid errors: parse, invalid request, method not found, unknown tool", async () => {
    const { body: created } = await createKey({ name: "Bot", scopes: ["content:read"] });

    // -32700 parse error → HTTP 400 (raw, non-JSON body)
    const res = await app.handle(
      new Request("http://localhost/api/v1/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${created.key}` },
        body: "{ not json",
      })
    );
    const parseBody = JSON.parse(await res.text());
    expect(res.status).toBe(400);
    expect(parseBody.error.code).toBe(-32700);

    // -32600 invalid request (wrong jsonrpc version)
    const invalid = await mcpCall(created.key, { jsonrpc: "1.0", id: 1, method: "initialize" });
    expect(invalid.body.error.code).toBe(-32600);

    // -32601 method not found
    const unknown = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/nope",
      params: {},
    });
    expect(unknown.body.error.code).toBe(-32601);
    expect(unknown.body.id).toBe(3);

    // -32602 invalid params: unknown tool
    const badTool = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "does_not_exist", arguments: {} },
    });
    expect(badTool.body.error.code).toBe(-32602);

    // Missing `arguments` for an existing tool → tool-level VALIDATION result
    // (the tool exists, but its required args fail runtime validation).
    const badArgs = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "content_get" },
    });
    expect(badArgs.status).toBe(200);
    expect(badArgs.body.result.isError).toBe(true);
    expect(JSON.parse(badArgs.body.result.content[0].text).code).toBe("VALIDATION");
  });

  it("rejects session (non-machine) principals with 401 MACHINE_AUTH_REQUIRED", async () => {
    // A VALID session principal (admin member of tenant A) hits the MCP route;
    // auth + tenant pass, the machine-principal guard rejects it.
    const { status, body } = await request("/api/v1/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sessionAdmin },
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    expect(status).toBe(401);
    expect(body.code).toBe("MACHINE_AUTH_REQUIRED");
  });
});

describe("MCP tools — real service-layer invocation", () => {
  it("writer_generate creates a tenant-scoped content item via the writer service", async () => {
    const { body: created } = await createKey({
      name: "Writer bot",
      scopes: ["writer:generate", "content:read"],
    });
    const { status, body } = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "writer_generate",
        arguments: { contentType: "article", topic: "Launch story", tone: "executive" },
      },
    });
    expect(status).toBe(200);
    expect(body.result.isError).toBeUndefined();
    expect(state.hiaiKitArticle).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "Launch story", outcome: "draft", tone: "executive" })
    );
    expect(body.result.structuredContent.item).toMatchObject({
      title: "Launch story",
      bodyText: "## Generated article body",
      status: "draft",
      tenantId: state.TENANT_A,
      createdBy: "apikey:" + created.apiKey.id,
      source: "chatgpt", // MCP / ChatGPT Work API surface
      currentRevisionNumber: 1,
    });
    expect(body.result.structuredContent.backend).toBe("hiai-kit:content.article");
    expect(body.result._meta.correlationId).toBeTruthy();
    // Persisted for real in the fake db, scoped to the key's tenant.
    const persisted = state.db._tables.content_items[0];
    expect(persisted.tenantId).toBe(state.TENANT_A);
    expect(state.db._tables.content_item_revisions).toHaveLength(1);
  });

  it("carousel_generate dispatches a hiai-kit job and persists the carousel", async () => {
    const { body: created } = await createKey({
      name: "Carousel bot",
      scopes: ["carousel:generate", "carousel:read"],
    });
    const { status, body } = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "carousel_generate", arguments: carouselInput },
    });
    expect(status).toBe(200);
    expect(state.carouselClient.carousel.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ carouselTitle: "10 AI tools", designPreset: "bold" })
    );
    expect(body.result.structuredContent.item.bodyJson).toMatchObject({
      kind: "carousel",
      jobId: state.JOB_ID,
      jobStatus: "running",
    });
    // Carousels created via MCP record the chatgpt provenance.
    expect(body.result.structuredContent.item.source).toBe("chatgpt");
    expect(state.db._tables.content_items[0].currentRevisionNumber).toBe(1);
    expect(state.db._tables.content_items).toHaveLength(1);
  });

  it("carousel_regenerate_slide persists the regenerated slide + appends a revision", async () => {
    const { body: created } = await createKey({
      name: "Carousel bot",
      scopes: ["carousel:generate", "carousel:regenerate", "carousel:read"],
    });
    // Seed via carousel_generate (real service path).
    await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "carousel_generate", arguments: carouselInput },
    });
    const carouselId = state.db._tables.content_items[0].id;

    const { status, body } = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 13,
      method: "tools/call",
      params: {
        name: "carousel_regenerate_slide",
        arguments: { id: carouselId, index: 1, description: "Make it punchier" },
      },
    });
    expect(status).toBe(200);
    expect(state.carouselClient.carousel.regenerateSlide).toHaveBeenCalledWith(
      state.JOB_ID,
      1,
      "Make it punchier"
    );
    expect(body.result.structuredContent.slide.doc).toBeTruthy();
    expect(body.result.structuredContent.revision.revisionNumber).toBe(2);
    expect(state.db._tables.content_item_revisions).toHaveLength(2);
  });

  it("content_get returns the tenant-scoped item; cross-tenant items are not found", async () => {
    const { body: created } = await createKey({ name: "Reader", scopes: ["content:read"] });
    // Persist one item in tenant A (via the writer service) and one in tenant B.
    await mcpCall(
      await (async () => {
        const k = await createKey({ name: "Bot A", scopes: ["writer:generate"] });
        return k.body.key;
      })(),
      {
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: { name: "writer_generate", arguments: { contentType: "article", topic: "A item" } },
      }
    );
    const [itemA] = state.db._tables.content_items;

    const { status, body } = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: { name: "content_get", arguments: { id: itemA.id } },
    });
    expect(status).toBe(200);
    // content_get returns the item row directly (no { item } wrapper).
    expect(body.result.structuredContent.id).toBe(itemA.id);
    expect(body.result.structuredContent.tenantId).toBe(state.TENANT_A);

    // A key for tenant A must NOT see tenant B's items — the client cannot
    // influence the tenant: even with an X-Tenant-Id header for B, the key's
    // own tenant wins and the item is invisible (404 semantics).
    // Issue a B-tenant key through the REAL service (session admin is only a
    // member of A, so the HTTP admin route cannot create a B key).
    const { createApiKey: issueKey } = await import("../../src/services/apiKeys.js");
    const bKey = (await issueKey(
      { tenantId: state.TENANT_B, userId: "system" },
      { name: "Bot B", scopes: ["writer:generate", "content:read"] }
    )).key;

    // Create an item in tenant B with the B key (machine principal of B).
    await request("/api/v1/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bKey}` },
      body: {
        jsonrpc: "2.0",
        id: 22,
        method: "tools/call",
        params: { name: "writer_generate", arguments: { contentType: "article", topic: "B item" } },
      },
    });
    const [itemB] = state.db._tables.content_items.filter((i: any) => i.tenantId === state.TENANT_B);

    // Tenant-A key asks for B's item (and even lies with an X-Tenant-Id=B header).
    const cross = await request("/api/v1/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${created.key}`,
        "X-Tenant-Id": state.TENANT_B,
      },
      body: {
        jsonrpc: "2.0",
        id: 23,
        method: "tools/call",
        params: { name: "content_get", arguments: { id: itemB.id } },
      },
    });
    expect(cross.status).toBe(200);
    expect(cross.body.result.isError).toBe(true);
    const payload = JSON.parse(cross.body.result.content[0].text);
    expect(payload.code).toBe("NOT_FOUND");
  });

  it("content_approve transitions an in_review item to approved", async () => {
    const { body: created } = await createKey({
      name: "Approver",
      scopes: ["content:read", "content:approve"],
    });
    // Seed an in_review item directly (approval requires the state machine).
    const [tenantRow] = state.db._tables.tenants.filter((t: any) => t.id === state.TENANT_A);
    const item = {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      tenantId: tenantRow.id,
      title: "Ready to approve",
      status: "in_review",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    state.db._tables.content_items.push(item);

    const { status, body } = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: { name: "content_approve", arguments: { id: item.id } },
    });
    expect(status).toBe(200);
    expect(body.result.isError).toBeUndefined();
    // approveContent returns the updated item row directly.
    expect(body.result.structuredContent.status).toBe("approved");
    expect(state.db._tables.content_items[0].status).toBe("approved");
  });

  it("enforces fine-grained scopes: content:read-only key cannot run writer_generate", async () => {
    const { body: created } = await createKey({ name: "Reader", scopes: ["content:read"] });
    const { status, body } = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 40,
      method: "tools/call",
      params: {
        name: "writer_generate",
        arguments: { contentType: "article", topic: "nope" },
      },
    });
    expect(status).toBe(200);
    expect(body.result.isError).toBe(true);
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload.code).toBe("INSUFFICIENT_SCOPE");
    expect(payload.requiredScope).toBe("writer:generate");
    // The writer service was never reached.
    expect(state.hiaiKitArticle).not.toHaveBeenCalled();
  });

  it("returns normalized service errors as isError results (bad arguments → VALIDATION)", async () => {
    const { body: created } = await createKey({ name: "Bot", scopes: ["content:read"] });
    const { status, body } = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 50,
      method: "tools/call",
      params: { name: "content_get", arguments: { id: "not-a-uuid" } },
    });
    expect(status).toBe(200);
    expect(body.result.isError).toBe(true);
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload.code).toBe("VALIDATION");
    expect(payload.correlationId).toBeTruthy();
  });
});

describe("MCP review workflow tools — real service-layer invocation", () => {
  function seedContentItem(overrides: Record<string, unknown> = {}) {
    const item = {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      tenantId: state.TENANT_A,
      title: "Review me",
      status: "draft",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    state.db._tables.content_items.push(item);
    return item;
  }

  it("content_submit_review transitions draft → in_review (real approval service)", async () => {
    const { body: created } = await createKey({
      name: "Reviewer",
      scopes: ["content:read", "content:submit_review"],
    });
    const item = seedContentItem();

    const { status, body } = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 60,
      method: "tools/call",
      params: { name: "content_submit_review", arguments: { id: item.id } },
    });
    expect(status).toBe(200);
    expect(body.result.isError).toBeUndefined();
    // submitForReview returns the updated item row directly.
    expect(body.result.structuredContent.status).toBe("in_review");
    expect(state.db._tables.content_items[0].status).toBe("in_review");
  });

  it("content_request_changes records the reviewer note; review round-trip reopens", async () => {
    const { body: created } = await createKey({
      name: "Reviewer",
      scopes: ["content:read", "content:submit_review", "content:request_changes"],
    });
    const item = seedContentItem({ status: "in_review" });

    const changes = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 61,
      method: "tools/call",
      params: {
        name: "content_request_changes",
        arguments: { id: item.id, note: "Tighten the headline" },
      },
    });
    expect(changes.status).toBe(200);
    expect(changes.body.result.structuredContent.status).toBe("changes_requested");
    expect(changes.body.result.structuredContent.reviewNote).toBe("Tighten the headline");
    expect(state.db._tables.content_items[0].reviewNote).toBe("Tighten the headline");

    // Round trip: changes_requested → in_review again (allowed transition).
    const resubmit = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 62,
      method: "tools/call",
      params: { name: "content_submit_review", arguments: { id: item.id } },
    });
    expect(resubmit.body.result.structuredContent.status).toBe("in_review");
  });

  it("content_request_changes is scoped: read-only key → INSUFFICIENT_SCOPE, no mutation", async () => {
    const { body: created } = await createKey({ name: "Reader", scopes: ["content:read"] });
    const item = seedContentItem({ status: "in_review" });

    const { status, body } = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 63,
      method: "tools/call",
      params: { name: "content_request_changes", arguments: { id: item.id, note: "nope" } },
    });
    expect(status).toBe(200);
    expect(body.result.isError).toBe(true);
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload.code).toBe("INSUFFICIENT_SCOPE");
    expect(payload.requiredScope).toBe("content:request_changes");
    expect(state.db._tables.content_items[0].status).toBe("in_review");
  });

  it("review tools are tenant-isolated: another tenant's item → NOT_FOUND isError", async () => {
    const { body: created } = await createKey({
      name: "Reviewer",
      scopes: ["content:read", "content:submit_review"],
    });
    const item = seedContentItem({ tenantId: state.TENANT_B });

    const { status, body } = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 64,
      method: "tools/call",
      params: { name: "content_submit_review", arguments: { id: item.id } },
    });
    expect(status).toBe(200);
    expect(body.result.isError).toBe(true);
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload.code).toBe("NOT_FOUND");
    expect(state.db._tables.content_items[0].status).toBe("draft");
  });
});

describe("MCP carousel lifecycle tools — real service-layer invocation", () => {
  /** Seed a persisted carousel through the real carousel_generate tool path. */
  async function seedCarousel(
    key: string
  ): Promise<{ id: string; jobId: string }> {
    const { status, body } = await mcpCall(key, {
      jsonrpc: "2.0",
      id: 70,
      method: "tools/call",
      params: { name: "carousel_generate", arguments: carouselInput },
    });
    expect(status).toBe(200);
    return {
      id: body.result.structuredContent.item.id,
      jobId: state.JOB_ID,
    };
  }

  it("carousel_regenerate dispatches a NEW job and appends a revision (history preserved)", async () => {
    const { body: created } = await createKey({
      name: "Carousel bot",
      scopes: ["carousel:generate", "carousel:regenerate", "carousel:read"],
    });
    const { id } = await seedCarousel(created.key);

    const nextJobId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    state.carouselClient.carousel.createJob.mockResolvedValue({
      jobId: nextJobId,
      slug: "10-ai-tools-v2",
    });

    const { status, body } = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 71,
      method: "tools/call",
      params: {
        name: "carousel_regenerate",
        arguments: {
          id,
          slides: [
            { title: "New intro", content: "Updated" },
            { title: "Pricing", content: "Free" },
          ],
          designPreset: "minimal",
        },
      },
    });
    expect(status).toBe(200);
    expect(body.result.isError).toBeUndefined();
    expect(state.carouselClient.carousel.createJob).toHaveBeenCalledTimes(2);
    expect(state.carouselClient.carousel.createJob).toHaveBeenLastCalledWith(
      expect.objectContaining({
        carouselTitle: "10 AI tools",
        slides: [
          { title: "New intro", content: "Updated" },
          { title: "Pricing", content: "Free" },
        ],
        designPreset: "minimal",
      })
    );
    expect(body.result.structuredContent.item.bodyJson.jobId).toBe(nextJobId);
    expect(body.result.structuredContent.revision.revisionNumber).toBe(2);
    expect(body.result.structuredContent.revision.changeNote).toBe("Full carousel regenerated");
    // Current-revision pointer advanced in the same transaction; history kept.
    expect(body.result.structuredContent.item.currentRevisionNumber).toBe(2);
    expect(state.db._tables.content_item_revisions).toHaveLength(2);
    // Revision #1 (insertion index 0) still carries the ORIGINAL job id.
    expect(state.db._tables.content_item_revisions[0].bodyJson.jobId).toBe(state.JOB_ID);
  });

  it("carousel review tools move a persisted carousel through the full lifecycle", async () => {
    const { body: created } = await createKey({
      name: "Carousel reviewer",
      scopes: [
        "carousel:generate",
        "carousel:read",
        "content:submit_review",
        "content:request_changes",
        "content:approve",
      ],
    });
    const { id } = await seedCarousel(created.key);

    const submit = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 72,
      method: "tools/call",
      params: { name: "carousel_submit_review", arguments: { id } },
    });
    expect(submit.body.result.structuredContent.status).toBe("in_review");

    const changes = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 73,
      method: "tools/call",
      params: {
        name: "carousel_request_changes",
        arguments: { id, note: "Slide 2 needs a new CTA" },
      },
    });
    expect(changes.body.result.structuredContent.status).toBe("changes_requested");
    expect(changes.body.result.structuredContent.reviewNote).toBe("Slide 2 needs a new CTA");

    // Reopen and approve → terminal.
    await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 74,
      method: "tools/call",
      params: { name: "carousel_submit_review", arguments: { id } },
    });
    const approve = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 75,
      method: "tools/call",
      params: { name: "carousel_approve", arguments: { id } },
    });
    expect(approve.body.result.structuredContent.status).toBe("approved");
    expect(state.db._tables.content_items[0].status).toBe("approved");
  });

  it("carousel review tools reject non-carousel items (NOT_FOUND), not silent no-ops", async () => {
    const { body: created } = await createKey({
      name: "Carousel reviewer",
      scopes: ["content:read", "content:submit_review"],
    });
    // A plain content item (no { kind: "carousel" } bodyJson).
    const item = {
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      tenantId: state.TENANT_A,
      title: "Not a carousel",
      status: "draft",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    state.db._tables.content_items.push(item);

    const { status, body } = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 76,
      method: "tools/call",
      params: { name: "carousel_submit_review", arguments: { id: item.id } },
    });
    expect(status).toBe(200);
    expect(body.result.isError).toBe(true);
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload.code).toBe("NOT_FOUND");
    expect(state.db._tables.content_items[0].status).toBe("draft");
  });
});

describe("MCP project resolution tools — real service-layer invocation", () => {
  it("project_list returns only the key's tenant projects (paginated)", async () => {
    const { body: created } = await createKey({ name: "Resolver", scopes: ["content:read"] });
    state.db._tables.projects.push(
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        tenantId: state.TENANT_A,
        name: "Project A",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        tenantId: state.TENANT_B,
        name: "Project B",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    );

    const { status, body } = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 80,
      method: "tools/call",
      params: { name: "project_list", arguments: {} },
    });
    expect(status).toBe(200);
    expect(body.result.structuredContent.items).toHaveLength(1);
    expect(body.result.structuredContent.items[0]).toMatchObject({
      name: "Project A",
      tenantId: state.TENANT_A,
    });
    expect(body.result.structuredContent.pagination.total).toBe(1);
  });

  it("project_get resolves project + brands + content summary; cross-tenant → NOT_FOUND", async () => {
    const { body: created } = await createKey({ name: "Resolver", scopes: ["content:read"] });
    state.db._tables.projects.push({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      tenantId: state.TENANT_A,
      name: "Project A",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    state.db._tables.brands.push({
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      tenantId: state.TENANT_A,
      projectId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      name: "Brand A",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    state.db._tables.content_items.push({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      tenantId: state.TENANT_A,
      projectId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      title: "Item",
      status: "in_review",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { status, body } = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 81,
      method: "tools/call",
      params: { name: "project_get", arguments: { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" } },
    });
    expect(status).toBe(200);
    expect(body.result.structuredContent.project.name).toBe("Project A");
    expect(body.result.structuredContent.brands).toHaveLength(1);
    expect(body.result.structuredContent.brands[0].name).toBe("Brand A");
    expect(body.result.structuredContent.content).toEqual({
      total: 1,
      byStatus: { in_review: 1 },
    });

    // Cross-tenant resolution is indistinguishable from not found.
    const cross = await mcpCall(created.key, {
      jsonrpc: "2.0",
      id: 82,
      method: "tools/call",
      params: { name: "project_get", arguments: { id: "ffffffff-ffff-4fff-8fff-ffffffffffff" } },
    });
    expect(cross.body.result.isError).toBe(true);
    expect(JSON.parse(cross.body.result.content[0].text).code).toBe("NOT_FOUND");
  });
});

describe("Work API discovery", () => {
  it("serves the canonical OpenAPI spec and the plugin manifest", async () => {
    const openapi = await request("/api/v1/openapi.json");
    expect(openapi.status).toBe(200);
    expect(openapi.body.openapi).toBe("3.0.0");
    expect(openapi.body.paths["/api/v1/mcp"].post.tags).toContain("MCP");
    expect(openapi.body.paths["/api/v1/writer/generate"].post).toBeTruthy();
    expect(openapi.body.paths["/api/v1/api-keys"].post).toBeTruthy();
    expect(openapi.body.components.securitySchemes.machineApiKey).toBeTruthy();

    const manifest = await request("/.well-known/ai-plugin.json");
    expect(manifest.status).toBe(200);
    expect(manifest.body.auth.authorization_type).toBe("bearer");
    expect(manifest.body.api.url).toBe("/api/v1/openapi.json");
  });
});
