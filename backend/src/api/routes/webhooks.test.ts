/**
 * Tests for the hiai-store webhook receiver (backend/src/api/routes/webhooks.ts)
 * including its hiai-observe instrumentation (`webhook.store_product` events).
 *
 * The ONLY boundaries mocked are `lib/config.js` (webhook secret), `lib/db.js`
 * (in-memory fake db) and `lib/logger.js`; the route, secret verification,
 * dedup hash, draft insert and telemetry emission all run for real.
 *
 * NOTE: the 503 NOT_CONFIGURED path is not covered here because `getConfig`
 * is mocked with a static secret — it remains the documented exit when
 * `HIAI_STORE_WEBHOOK_SECRET` is unset in production.
 *
 * Run with: npx vitest run src/api/routes/webhooks.test.ts
 */
import { createHash } from "node:crypto";
import { Elysia } from "elysia";
import { afterEach, describe, expect, it, vi } from "vitest";

const { fakeDb } = vi.hoisted(() => ({ fakeDb: { db: null as any } }));

vi.mock("../../lib/config.js", () => ({
  getConfig: () => ({
    HIAI_STORE_WEBHOOK_SECRET: "store-shared-secret",
  }),
}));

vi.mock("../../lib/db.js", async () => {
  const { makeFakeDb } = await import("../../__tests__/helpers/fake-db.js");
  fakeDb.db = makeFakeDb();
  return {
    db: fakeDb.db,
    checkDbHealth: async () => true,
    withTransaction: async (fn: (tx: any) => Promise<unknown>) => fn(fakeDb.db),
  };
});

vi.mock("../../lib/logger.js", () => {
  const noop = () => {};
  return {
    logger: {
      child: () => ({ warn: noop, error: noop, info: noop, debug: noop }),
      info: noop,
    },
  };
});

import { webhooksRoutes } from "./webhooks.js";

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECRET = "store-shared-secret";
const WEBHOOK_URL = "http://localhost/api/v1/webhooks/store-product";

const payload = {
  tenantId: TENANT_ID,
  productId: "prod-7",
  productName: "Hoverboard",
  productUrl: "https://store.example/hoverboard",
  productImage: "https://store.example/hoverboard.png",
  platform: "shopify",
};

/** Mirror of the route's idempotency hash: SHA-256(tenantId:productId:platform). */
function dedupHash(tenantId: string, productId: string, platform: string): string {
  return createHash("sha256")
    .update(`${tenantId}:${productId}:${platform}`)
    .digest("hex")
    .slice(0, 16);
}

const app = new Elysia().use(webhooksRoutes);

function post(body: unknown, secret = SECRET): Promise<Response> {
  return app.handle(
    new Request(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": secret,
      },
      body: JSON.stringify(body),
    })
  );
}

/** Observe (OTLP /v1/logs) fetch calls only. */
function observeCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/logs")) as Array<
    [string, RequestInit]
  >;
}

function parseObserveAttrs(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const [, init] = observeCalls(fetchMock)[index];
  const payload2 = JSON.parse(String(init.body)) as {
    resourceLogs: Array<{ scopeLogs: Array<{ logRecords: Array<Record<string, unknown>> }> }>;
  };
  const record = payload2.resourceLogs[0].scopeLogs[0].logRecords[0];
  return Object.fromEntries(
    (
      (record.attributes ?? []) as Array<{
        key: string;
        value: { stringValue?: string; intValue?: string };
      }>
    ).map((a) => [a.key, a.value.stringValue ?? a.value.intValue ?? ""])
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.HIAI_OBSERVE_URL;
  delete process.env.HIAI_OBSERVE_API_KEY;
  delete process.env.HIAI_OBSERVE_PROJECT;
  delete process.env.HIAI_OBSERVE_TIMEOUT_MS;
  // Reset storage between tests.
  fakeDb.db._tables.posts = [];
  fakeDb.db._tables.tenants = [];
});

describe("webhook observability (hiai-observe)", () => {
  function configuredObserve() {
    process.env.HIAI_OBSERVE_URL = "http://observe.test:8001";
    process.env.HIAI_OBSERVE_API_KEY = "observe-test-key";
    process.env.HIAI_OBSERVE_PROJECT = "proj-test";
  }

  function seedTenant(status = "active") {
    fakeDb.db._tables.tenants = [
      { id: TENANT_ID, status, slug: "acme", name: "Acme", createdAt: new Date() },
    ];
  }

  it("emits a failure event (INVALID_SIGNATURE) when the shared secret mismatches", async () => {
    configuredObserve();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await post(payload, "wrong-secret");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.status).toBe(401);
    const attrs = parseObserveAttrs(fetchMock, 0);
    expect(attrs["event.kind"]).toBe("webhook");
    expect(attrs["event.operation"]).toBe("webhook.store_product");
    expect(attrs["event.outcome"]).toBe("failure");
    expect(attrs["error.code"]).toBe("INVALID_SIGNATURE");
    expect(attrs["status.code"]).toBe("401");
    expect(attrs["correlation.id"]).toBeTruthy();
    expect(observeCalls(fetchMock)).toHaveLength(1);
  });

  it("emits a failure event (TENANT_NOT_FOUND) for an unknown tenant", async () => {
    configuredObserve();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await post(payload); // no tenants seeded
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.status).toBe(400);
    const attrs = parseObserveAttrs(fetchMock, 0);
    expect(attrs["event.outcome"]).toBe("failure");
    expect(attrs["error.code"]).toBe("TENANT_NOT_FOUND");
    expect(attrs["tenant.id"]).toBe(TENANT_ID);
    expect(attrs["metadata.platform"]).toBe("shopify");
  });

  it("emits a failure event (TENANT_SUSPENDED) for an inactive tenant", async () => {
    configuredObserve();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    seedTenant("suspended");

    const res = await post(payload);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.status).toBe(400);
    const attrs = parseObserveAttrs(fetchMock, 0);
    expect(attrs["event.outcome"]).toBe("failure");
    expect(attrs["error.code"]).toBe("TENANT_SUSPENDED");
    expect(attrs["tenant.id"]).toBe(TENANT_ID);
  });

  it("creates a draft post (201) and emits a success event with the post id", async () => {
    configuredObserve();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    seedTenant("active");

    const res = await post(payload);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.post.id).toBeTruthy();
    expect(body.post.status).toBe("draft");

    const attrs = parseObserveAttrs(fetchMock, 0);
    expect(attrs["event.outcome"]).toBe("success");
    expect(attrs["status.code"]).toBe("201");
    expect(attrs["metadata.postId"]).toBe(body.post.id);
    expect(attrs["metadata.productId"]).toBe("prod-7");
    expect(attrs["metadata.platform"]).toBe("shopify");
    expect(attrs["tenant.id"]).toBe(TENANT_ID);

    // The draft was persisted with the idempotency hash.
    const rows = fakeDb.db._tables.posts;
    expect(rows).toHaveLength(1);
    expect(rows[0].contentHash).toBe(dedupHash(TENANT_ID, "prod-7", "shopify"));
  });

  it("deduplicates (200) and emits a success event flagged deduplicated", async () => {
    configuredObserve();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    seedTenant("active");
    fakeDb.db._tables.posts = [
      {
        id: "existing-post-1",
        tenantId: TENANT_ID,
        contentHash: dedupHash(TENANT_ID, "prod-7", "shopify"),
      },
    ];

    const res = await post(payload);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deduplicated).toBe(true);
    expect(fakeDb.db._tables.posts).toHaveLength(1); // no second insert

    const attrs = parseObserveAttrs(fetchMock, 0);
    expect(attrs["event.outcome"]).toBe("success");
    expect(attrs["status.code"]).toBe("200");
    expect(attrs["metadata.deduplicated"]).toBe("true");
    expect(attrs["metadata.postId"]).toBe("existing-post-1");
  });

  it("is a telemetry no-op when HIAI_OBSERVE_* is unconfigured", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    seedTenant("active");

    const res = await post(payload);

    expect(res.status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
