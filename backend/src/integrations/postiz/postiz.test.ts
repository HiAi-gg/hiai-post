/**
 * Unit tests for the Postiz integration boundary (backend/src/integrations/postiz).
 *
 * The ONLY external boundary mocked is `globalThis.fetch`; config derivation,
 * contract validation and error normalization all run for real. Covers:
 *   - config summary never leaks the API key
 *   - unconfigured client → NOT_CONFIGURED (503), never a fabricated success
 *   - submitPublication / syncStatus contracts (Bearer auth, correlation id,
 *     body shape, bounded timeout)
 *   - failure normalization (non-2xx → POSTIZ_ERROR with status, network
 *     failure → POSTIZ_ERROR, timeout → TIMEOUT, invalid input → VALIDATION_ERROR)
 *   - hiai-observe instrumentation: postiz.submit / postiz.status_sync
 *     start/success/failure events (observeCall wrapper), no-op when
 *     telemetry is unconfigured
 *
 * Run with: npx vitest run src/integrations/postiz/postiz.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Env for the lazy config import chain (config.ts exits without these).
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-key-min-32-characters-long";
process.env.TOKEN_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.POSTIZ_API_URL = "http://postiz.test:5000/";
process.env.POSTIZ_API_KEY = "postiz-test-key";
process.env.POSTIZ_TIMEOUT_MS = "5000";

import { createPostizClient } from "./client.js";
import { postizConfig, postizConfigSummary } from "./config.js";
import { PostizError, toPostizErrorEnvelope } from "./errors.js";
import { postizPublishIntentSchema, postizStatusRecordSchema } from "./schemas.js";

const INTENT = {
  externalProvider: "instagram",
  externalItemId: "item-uuid-1",
  scheduledAt: "2026-08-11T09:00:00.000Z",
  status: "scheduled" as const,
};

const RECORD = {
  externalProvider: "x",
  externalItemId: "item-uuid-2",
  scheduledAt: "2026-08-11T09:00:00.000Z",
  status: "published" as const,
  url: "https://x.com/acme/status/123",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  // Leave the shared env clean: observe must stay disabled for the other tests.
  delete process.env.HIAI_OBSERVE_URL;
  delete process.env.HIAI_OBSERVE_API_KEY;
  delete process.env.HIAI_OBSERVE_PROJECT;
  delete process.env.HIAI_OBSERVE_TIMEOUT_MS;
});

describe("postiz config", () => {
  it("reads env into a config and never exposes the key in summaries", () => {
    const cfg = postizConfig();
    expect(cfg.url).toBe("http://postiz.test:5000"); // trailing slash trimmed
    expect(cfg.timeoutMs).toBe(5000);
    expect(cfg.enabled).toBe(true);

    const summary = postizConfigSummary(cfg);
    expect(summary.hasApiKey).toBe(true);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("postiz-test-key");
    expect(serialized).not.toContain("test-key");
  });
});

describe("unconfigured boundary", () => {
  const unconfigured = { url: "", apiKey: "", timeoutMs: 5000, enabled: false };

  it("submitPublication throws NOT_CONFIGURED without calling fetch", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(201, { ok: true })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createPostizClient(unconfigured);

    await expect(client.submitPublication({ ...INTENT })).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("syncStatus throws NOT_CONFIGURED without calling fetch", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, { ok: true })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createPostizClient(unconfigured);

    await expect(client.syncStatus({ ...RECORD })).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("submitPublication", () => {
  const configured = {
    url: "http://postiz.test:5000",
    apiKey: "k",
    timeoutMs: 5000,
    enabled: true,
  };

  it("POSTs the intent with Bearer auth, correlation id and the typed body", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(201, { ok: true })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createPostizClient(configured);

    const result = await client.submitPublication({ ...INTENT });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("http://postiz.test:5000/api/v1/publications");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer k");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("x-trace-id")).toBeTruthy();
    expect(JSON.parse(String(init.body))).toEqual(INTENT);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toMatchObject({ accepted: true });
    expect(result.correlationId).toBeTruthy();
  });

  it("normalizes a non-2xx response to POSTIZ_ERROR with the upstream status", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(401, { error: "invalid key" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createPostizClient(configured);

    await expect(client.submitPublication({ ...INTENT })).rejects.toMatchObject({
      code: "POSTIZ_ERROR",
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes a network failure to POSTIZ_ERROR (502)", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createPostizClient(configured);

    await expect(client.submitPublication({ ...INTENT })).rejects.toMatchObject({
      code: "POSTIZ_ERROR",
      status: 502,
    });
  });

  it("normalizes a timeout to TIMEOUT (504)", async () => {
    const abortError = Object.assign(new Error("The operation was aborted."), {
      name: "AbortError",
    });
    const fetchMock = vi.fn(async (_url, init) => {
      expect(init?.signal).toBeDefined();
      throw abortError;
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createPostizClient({ ...configured, timeoutMs: 1234 });

    await expect(client.submitPublication({ ...INTENT })).rejects.toMatchObject({
      code: "TIMEOUT",
      status: 504,
      details: { timeoutMs: 1234 },
    });
  });

  it("rejects invalid intents client-side with VALIDATION_ERROR, no fetch", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(201, { ok: true })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createPostizClient(configured);

    await expect(
      client.submitPublication({ externalProvider: "", externalItemId: "", status: "scheduled" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    const badStatus = {
      externalProvider: "instagram",
      externalItemId: "i1",
      status: "not-a-status",
    } as unknown as Parameters<typeof client.submitPublication>[0];
    await expect(client.submitPublication(badStatus)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("syncStatus", () => {
  const configured = {
    url: "http://postiz.test:5000",
    apiKey: "k",
    timeoutMs: 5000,
    enabled: true,
  };

  it("POSTs the status record with url/error metadata", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, { ok: true })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createPostizClient(configured);

    const result = await client.syncStatus({ ...RECORD, error: "provider rate limited" });

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("http://postiz.test:5000/api/v1/publications/status");
    expect(JSON.parse(String(init.body))).toEqual({ ...RECORD, error: "provider rate limited" });
    expect(result.correlationId).toBeTruthy();
  });

  it("normalizes a non-2xx response to POSTIZ_ERROR", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(500, { error: "boom" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createPostizClient(configured);

    await expect(client.syncStatus({ ...RECORD })).rejects.toMatchObject({
      code: "POSTIZ_ERROR",
      status: 500,
    });
  });
});

describe("contracts", () => {
  it("accepts the generic metadata fields and rejects unknown statuses", () => {
    expect(postizPublishIntentSchema.safeParse(INTENT).success).toBe(true);
    expect(
      postizPublishIntentSchema.safeParse({ ...INTENT, status: "published", url: "https://x.co/1" })
        .success
    ).toBe(true);
    expect(postizPublishIntentSchema.safeParse({ ...INTENT, status: "weird" }).success).toBe(false);
    expect(postizPublishIntentSchema.safeParse({ ...INTENT, error: 42 }).success).toBe(false);
  });

  it("validates status records with optional url/error metadata", () => {
    expect(postizStatusRecordSchema.safeParse(RECORD).success).toBe(true);
    expect(postizStatusRecordSchema.safeParse({ ...RECORD, error: "nope" }).success).toBe(true);
    expect(postizStatusRecordSchema.safeParse({ ...RECORD, url: "not-a-url" }).success).toBe(false);
  });

  it("PostizError is a typed, envelopable error", () => {
    const err = new PostizError("TIMEOUT", "timed out", 504, { correlationId: "c1" });
    expect(toPostizErrorEnvelope(err)).toMatchObject({
      code: "TIMEOUT",
      status: 504,
      correlationId: "c1",
    });
    expect(toPostizErrorEnvelope(new Error("plain"))).toBeUndefined();
  });
});

describe("postiz observability (hiai-observe)", () => {
  const configured = {
    url: "http://postiz.test:5000",
    apiKey: "k",
    timeoutMs: 5000,
    enabled: true,
  };

  function configuredObserve() {
    process.env.HIAI_OBSERVE_URL = "http://observe.test:8001";
    process.env.HIAI_OBSERVE_API_KEY = "observe-test-key";
    process.env.HIAI_OBSERVE_PROJECT = "proj-test";
  }

  /** Observe (OTLP) fetch calls only — the postiz calls go to /api/v1/*. */
  function observeCalls(fetchMock: ReturnType<typeof vi.fn>) {
    return fetchMock.mock.calls.filter(([url]) => String(url).includes("/v1/logs")) as Array<
      [string, RequestInit]
    >;
  }

  function parseObserveAttrs(fetchMock: ReturnType<typeof vi.fn>, index: number) {
    const [, init] = observeCalls(fetchMock)[index];
    const payload = JSON.parse(String(init.body)) as {
      resourceLogs: Array<{ scopeLogs: Array<{ logRecords: Array<Record<string, unknown>> }> }>;
    };
    const record = payload.resourceLogs[0].scopeLogs[0].logRecords[0];
    return Object.fromEntries(
      ((record.attributes ?? []) as Array<{ key: string; value: { stringValue?: string } }>).map(
        (a) => [a.key, a.value.stringValue ?? ""]
      )
    );
  }

  it("emits postiz.submit start + success events around a live submission", async () => {
    configuredObserve();
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("/v1/logs")
        ? new Response("{}", { status: 200 })
        : jsonResponse(201, { ok: true })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createPostizClient(configured);

    const result = await client.submitPublication({ ...INTENT });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.accepted).toBe(true);
    // start + success (observe) + the postiz POST itself.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const startAttrs = parseObserveAttrs(fetchMock, 0);
    const successAttrs = parseObserveAttrs(fetchMock, 1);
    expect(startAttrs["event.kind"]).toBe("postiz");
    expect(startAttrs["event.operation"]).toBe("postiz.submit");
    expect(startAttrs["event.outcome"]).toBe("start");
    expect(startAttrs["metadata.externalProvider"]).toBe("instagram");
    expect(startAttrs["metadata.externalItemId"]).toBe("item-uuid-1");
    expect(successAttrs["event.outcome"]).toBe("success");
    expect(successAttrs["metadata.accepted"]).toBe("true");
    expect(successAttrs["metadata.correlationId"]).toBeTruthy();
    expect(successAttrs["correlation.id"]).toBe(startAttrs["correlation.id"]);
  });

  it("emits postiz.status_sync start + success events", async () => {
    configuredObserve();
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("/v1/logs")
        ? new Response("{}", { status: 200 })
        : jsonResponse(200, { ok: true })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createPostizClient(configured);

    await client.syncStatus({ ...RECORD });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const startAttrs = parseObserveAttrs(fetchMock, 0);
    const successAttrs = parseObserveAttrs(fetchMock, 1);
    expect(startAttrs["event.operation"]).toBe("postiz.status_sync");
    expect(startAttrs["metadata.externalProvider"]).toBe("x");
    expect(successAttrs["event.outcome"]).toBe("success");
  });

  it("emits postiz.submit start + failure (VALIDATION_ERROR) with no postiz call", async () => {
    configuredObserve();
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("/v1/logs")
        ? new Response("{}", { status: 200 })
        : jsonResponse(201, { ok: true })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createPostizClient(configured);

    await expect(
      client.submitPublication({ externalProvider: "", externalItemId: "", status: "scheduled" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Only the two observe events were emitted — the postiz fetch never ran.
    expect(observeCalls(fetchMock)).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const failAttrs = parseObserveAttrs(fetchMock, 1);
    expect(failAttrs["event.operation"]).toBe("postiz.submit");
    expect(failAttrs["event.outcome"]).toBe("failure");
    expect(failAttrs["error.code"]).toBe("VALIDATION_ERROR");
    expect(failAttrs["metadata.externalProvider"]).toBe("");
  });

  it("is a no-op for telemetry when HIAI_OBSERVE_* is unconfigured", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(201, { ok: true })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createPostizClient(configured);

    const result = await client.submitPublication({ ...INTENT });
    expect(result.accepted).toBe(true);
    // Exactly one fetch: the postiz POST. No observe events.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
