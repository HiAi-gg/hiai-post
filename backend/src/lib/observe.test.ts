/**
 * Unit tests for the hiai-observe telemetry emitter (backend/src/lib/observe.ts).
 *
 * The ONLY boundary mocked is `globalThis.fetch`; everything else (config
 * derivation, OTLP payload building, sensitive-metadata filtering, correlation
 * id → traceId mapping, error swallowing) runs for real. Covers:
 *   - no-op when unconfigured (zero fetch calls, resolves immediately)
 *   - configured: OTLP /v1/logs POST with the verified Bearer API-key contract
 *   - bounded timeout wiring + abort-safety
 *   - correlation fields (correlationId → traceId, tenant/user ids)
 *   - no secret leakage (API key never serialized; secret-shaped metadata
 *     keys dropped)
 *   - telemetry never fails the product request (observeCall rethrows the
 *     operation's own error, emits success/failure events)
 *
 * Run with: npx vitest run src/lib/observe.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Base env for the config import chain (config.ts exits without these).
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-key-min-32-characters-long";
process.env.TOKEN_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import {
  getObserveConfig,
  isObserveEnabled,
  normalizeErrorCode,
  observeCall,
  observeEvent,
} from "./observe.js";

const API_KEY = "observe-test-api-key-12345";
const PROJECT = "proj-test";

function configuredEnv() {
  process.env.HIAI_OBSERVE_URL = "http://observe.test:8001/";
  process.env.HIAI_OBSERVE_API_KEY = API_KEY;
  process.env.HIAI_OBSERVE_PROJECT = PROJECT;
  process.env.HIAI_OBSERVE_TIMEOUT_MS = "200";
}

function unconfiguredEnv() {
  delete process.env.HIAI_OBSERVE_URL;
  delete process.env.HIAI_OBSERVE_API_KEY;
  delete process.env.HIAI_OBSERVE_PROJECT;
  delete process.env.HIAI_OBSERVE_TIMEOUT_MS;
}

afterEach(() => {
  vi.unstubAllGlobals();
  unconfiguredEnv(); // leave the shared env clean for other tests
});

/** Parse the OTLP log record out of the body passed to fetch. */
function parseSentRecord(fetchMock: ReturnType<typeof vi.fn>) {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return parseRecordAt(fetchMock, 0);
}

/** Parse the OTLP log record out of the Nth fetch call (0-based). */
function parseRecordAt(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const [calledUrl, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  const payload = JSON.parse(String(init.body)) as {
    resourceLogs: Array<{
      scopeLogs: Array<{ logRecords: Array<Record<string, unknown>> }>;
    }>;
  };
  const record = payload.resourceLogs[0].scopeLogs[0].logRecords[0];
  const attributes = (record.attributes ?? []) as Array<{
    key: string;
    value: { stringValue?: string; intValue?: string };
  }>;
  const attr = (key: string) => attributes.find((a) => a.key === key)?.value;
  return { calledUrl, init, record, attr };
}

/** Parse the OTLP log record of a fetch call into a flat key → string map. */
function parseRecordAttrs(
  fetchMock: ReturnType<typeof vi.fn>,
  index: number
): Record<string, string> {
  const { record } = parseRecordAt(fetchMock, index);
  return Object.fromEntries(
    ((record.attributes ?? []) as Array<{ key: string; value: { stringValue?: string } }>).map(
      (a) => [a.key, a.value.stringValue ?? ""]
    )
  );
}

describe("observe config", () => {
  it("is disabled (no-op) when the API key is unset", () => {
    unconfiguredEnv();
    const cfg = getObserveConfig();
    expect(cfg.enabled).toBe(false);
    expect(isObserveEnabled()).toBe(false);
    expect(cfg.timeoutMs).toBe(2000); // safe default
  });

  it("is enabled and trims the URL when configured", () => {
    configuredEnv();
    const cfg = getObserveConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.url).toBe("http://observe.test:8001");
    expect(cfg.apiKey).toBe(API_KEY);
    expect(cfg.project).toBe(PROJECT);
    expect(cfg.timeoutMs).toBe(200);
  });
});

describe("no-op when unconfigured", () => {
  it("emits nothing and performs zero fetch calls", async () => {
    unconfiguredEnv();
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    observeEvent({
      kind: "writer",
      outcome: "start",
      operation: "writer.generate",
      message: "writer.generate started",
      correlationId: "run-1",
    });
    // Fire-and-forget emits resolve synchronously-ish; give the microtask queue a tick.
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("observeCall runs the operation directly with zero overhead", async () => {
    unconfiguredEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await observeCall(
      { kind: "writer", operation: "writer.generate" },
      async () => "done"
    );
    expect(result).toBe("done");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("configured emitter", () => {
  it("POSTs an OTLP /v1/logs payload with the Bearer API-key contract", async () => {
    configuredEnv();
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    observeEvent({
      kind: "writer",
      outcome: "success",
      operation: "writer.generate",
      message: "writer.generate succeeded",
      correlationId: "11111111-aaaa-4aaa-8aaa-111111111111",
      tenantId: "tenant-1",
      userId: "user-1",
      status: 201,
      durationMs: 42,
      metadata: { backend: "hiai-kit:content.article", ok: true },
    });
    await Promise.resolve();

    const { calledUrl, init, record, attr } = parseSentRecord(fetchMock);
    expect(calledUrl).toBe("http://observe.test:8001/v1/logs");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${API_KEY}`);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init.signal).toBeInstanceOf(AbortSignal);

    expect(record.severityText).toBe("INFO");
    expect(attr("event.kind")?.stringValue).toBe("writer");
    expect(attr("event.outcome")?.stringValue).toBe("success");
    expect(attr("event.operation")?.stringValue).toBe("writer.generate");
    expect(attr("event.source")?.stringValue).toBe("hiai-post");
    expect(attr("correlation.id")?.stringValue).toBe("11111111-aaaa-4aaa-8aaa-111111111111");
    expect(attr("tenant.id")?.stringValue).toBe("tenant-1");
    expect(attr("user.id")?.stringValue).toBe("user-1");
    expect(attr("status.code")?.intValue).toBe("201");
    expect(attr("duration.ms")?.intValue).toBe("42");
    expect(attr("metadata.backend")?.stringValue).toBe("hiai-kit:content.article");
    expect(attr("metadata.ok")?.stringValue).toBe("true");
    expect(record.traceId).toBe("11111111aaaa4aaa8aaa111111111111");
    expect(record.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("maps the correlation id to a 32-char OTLP traceId even for short ids", async () => {
    configuredEnv();
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    observeEvent({
      kind: "mcp",
      outcome: "failure",
      operation: "mcp.tools.call:writer_generate",
      message: "failed",
      correlationId: "run-abc",
      errorCode: "VALIDATION",
    });
    await Promise.resolve();

    const { record } = parseSentRecord(fetchMock);
    expect(record.severityText).toBe("ERROR");
    // Non-hex characters are stripped; the traceId is padded to exactly 32 hex.
    expect(record.traceId).toBe("abc".padEnd(32, "0"));
    expect(record.traceId).toHaveLength(32);
  });

  it("never serializes the API key or secret-shaped metadata values", async () => {
    configuredEnv();
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    observeEvent({
      kind: "api",
      outcome: "failure",
      operation: "api.request",
      message: "api POST /api/v1/posts failed",
      correlationId: "req-1",
      metadata: {
        apiKey: "sk-super-secret-value",
        authorization: "Bearer shh",
        password: "hunter2",
        tenantId: "tenant-ok",
        statusText: "ok",
      },
    });
    await Promise.resolve();

    const { calledUrl, init, attr } = parseSentRecord(fetchMock);
    // The configured key appears ONLY in the auth header, never in the body.
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${API_KEY}`);
    const body = JSON.stringify(JSON.parse(String(init.body)));
    expect(body).not.toContain(API_KEY);
    expect(body).not.toContain("sk-super-secret-value");
    expect(body).not.toContain("Bearer shh");
    expect(body).not.toContain("hunter2");
    expect(calledUrl).toContain("/v1/logs");
    // The dropped keys are absent; benign metadata survives.
    expect(attr("metadata.tenantId")?.stringValue).toBe("tenant-ok");
    expect(attr("metadata.statusText")?.stringValue).toBe("ok");
  });

  it("truncates over-long message and metadata strings", async () => {
    configuredEnv();
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const long = "x".repeat(10_000);
    observeEvent({
      kind: "carousel",
      outcome: "success",
      operation: "carousel.create",
      message: `done ${long}`,
      correlationId: "c1",
      metadata: { blob: long },
    });
    await Promise.resolve();

    const { record, attr } = parseSentRecord(fetchMock);
    expect(String((record.body as { stringValue?: unknown }).stringValue).length).toBeLessThan(600);
    expect(attr("metadata.blob")?.stringValue?.length).toBeLessThan(600);
  });

  it("bounded timeout: aborts the in-flight fetch within the configured window and swallows", async () => {
    configuredEnv();
    process.env.HIAI_OBSERVE_TIMEOUT_MS = "40";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      // Resolve only when the AbortSignal fires — proves the timeout wiring.
      await new Promise<void>((resolve) =>
        init?.signal?.addEventListener("abort", () => resolve())
      );
      (fetchMock as unknown as { abortedAt: number }).abortedAt = Date.now();
      throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const startedAt = Date.now();
    expect(() =>
      observeEvent({
        kind: "writer",
        outcome: "start",
        operation: "writer.generate",
        message: "start",
      })
    ).not.toThrow();

    // Give the fire-and-forget send a moment: the signal must abort the fetch
    // (mock resolves only on abort) and the failure must be swallowed.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((fetchMock as unknown as { abortedAt: number }).abortedAt).toBeGreaterThan(0);
    expect((fetchMock as unknown as { abortedAt: number }).abortedAt - startedAt).toBeLessThan(
      1000
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("never rejects the caller when hiai-observe is unreachable", async () => {
    configuredEnv();
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    // observeEvent returns void and must not throw.
    expect(() =>
      observeEvent({
        kind: "hiai-kit",
        outcome: "failure",
        operation: "hiai-kit.http",
        message: "failed",
        correlationId: "r1",
      })
    ).not.toThrow();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("observeCall wrapper", () => {
  it("emits start + success and returns the operation result", async () => {
    configuredEnv();
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await observeCall(
      {
        kind: "writer",
        operation: "writer.rewrite",
        tenantId: "t1",
        userId: "u1",
        enrich: { success: () => ({ backend: "hiai-kit:content.article" }) },
      },
      async () => ({ ok: true })
    );

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2); // start + success
    const startAttrs = parseRecordAttrs(fetchMock, 0);
    const successAttrs = parseRecordAttrs(fetchMock, 1);
    expect(startAttrs["event.outcome"]).toBe("start");
    expect(successAttrs["event.outcome"]).toBe("success");
    expect(successAttrs["metadata.backend"]).toBe("hiai-kit:content.article");
    // Correlation id is shared between start and success events.
    expect(startAttrs["correlation.id"]).toBeTruthy();
    expect(successAttrs["correlation.id"]).toBe(startAttrs["correlation.id"]);
  });

  it("emits start + failure and rethrows the operation's own error", async () => {
    configuredEnv();
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const boom = new Error("model unreachable");
    (boom as { code?: string }).code = "INTERNAL";

    await expect(
      observeCall(
        {
          kind: "carousel",
          operation: "carousel.create",
          enrich: { failure: () => ({ jobId: "none" }) },
        },
        async () => {
          throw boom;
        }
      )
    ).rejects.toThrow("model unreachable");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init2] = fetchMock.mock.calls[1] as [string, RequestInit];
    const payload2 = JSON.parse(String(init2.body));
    const record2 = payload2.resourceLogs[0].scopeLogs[0].logRecords[0];
    const attr2 = Object.fromEntries(
      (record2.attributes as Array<{ key: string; value: { stringValue?: string } }>).map((a) => [
        a.key,
        a.value.stringValue,
      ])
    );
    expect(attr2["event.outcome"]).toBe("failure");
    expect(attr2["error.code"]).toBe("INTERNAL");
    expect(attr2["metadata.jobId"]).toBe("none");
  });

  it("normalizeErrorCode falls back to INTERNAL for non-errors", () => {
    expect(normalizeErrorCode(new Error("x"))).toBe("INTERNAL");
    expect(normalizeErrorCode({ code: "VALIDATION" })).toBe("INTERNAL");
    expect(normalizeErrorCode("nope")).toBe("INTERNAL");
  });
});
