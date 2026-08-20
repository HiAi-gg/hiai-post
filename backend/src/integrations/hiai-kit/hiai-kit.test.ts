/**
 * Adapter tests for the hiai-kit integration boundary.
 *
 * The ONLY boundary mocked is the external HTTP layer (`globalThis.fetch`);
 * everything else (schemas, error normalization, correlation ids, carousel
 * job lifecycle) runs for real. No hiai-kit service is required.
 *
 * Run with: bunx vitest run src/integrations/hiai-kit/hiai-kit.test.ts
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Env for the lazy config/logger import chain (config.ts exits without these).
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-key-min-32-characters-long";
process.env.TOKEN_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.HIAI_KIT_URL = "http://localhost:3000/";
process.env.HIAI_KIT_TIMEOUT_MS = "7000";
process.env.HIAI_KIT_COOKIE = "session=abc";
process.env.HIAI_KIT_TOKEN = "tok123";

import {
  type CreateCarouselInput,
  createHiaiKitClient,
  HiaiKitError,
  hiaiKitConfig,
  hiaiKitConfigSummary,
} from "./index.js";

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const researchReport = {
  query: "hello",
  sources: [{ url: "https://example.com", title: "Example" }],
  summary: "Research summary",
  keyInsights: ["insight"],
  trendingAngles: ["angle"],
};

const completedResearchRun = {
  runId: "run-1",
  capabilityId: "research.general",
  status: "completed",
  output: researchReport,
  artifacts: [],
  sources: [],
  warnings: [],
  errors: [],
};

const manifest = {
  id: "research.general",
  version: "0.1.0",
  type: "workflow",
  description: "General web research",
  inputSchema: { name: "object", fields: [{ name: "topic", required: true }] },
  outputSchema: { name: "object", fields: [] },
  status: "experimental",
  supportsStreaming: false,
  supportsAsync: true,
  requiredProviders: ["openrouter"],
  requiredTools: [],
  tests: [],
};

const carouselJob = {
  jobId: JOB_ID,
  slug: "my-carousel",
  carouselTitle: "My Carousel",
  status: "running",
  step: "marketing",
  stepIndex: 0,
  totalSteps: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  error: null,
  slideWidth: 1024,
  slideHeight: 1024,
  result: { coverImagePath: null, slidePngPaths: [] },
};

const carouselInput: CreateCarouselInput = {
  carouselTitle: "My Carousel",
  slides: [{ title: "Slide 1", content: "Hello" }],
  designPreset: "minimal",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetchOnce(impl: (url: unknown, init?: RequestInit) => Promise<Response>) {
  const mockFetch = vi.fn(impl);
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

describe("hiai-kit config", () => {
  it("reads server-side env into a config and never exposes secrets in summaries", () => {
    const cfg = hiaiKitConfig();
    expect(cfg.url).toBe("http://localhost:3000"); // trailing slash trimmed
    expect(cfg.timeoutMs).toBe(7000);
    expect(cfg.cookie).toBe("session=abc");
    expect(cfg.token).toBe("tok123");

    const summary = hiaiKitConfigSummary(cfg);
    expect(summary.hasCookie).toBe(true);
    expect(summary.hasToken).toBe(true);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("abc");
    expect(serialized).not.toContain("tok123");
  });
});

describe("capability client", () => {
  it("dispatches research.general via the capability envelope and validates the response", async () => {
    const mockFetch = mockFetchOnce(async () => jsonResponse(200, completedResearchRun));
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    const result = await client.capabilities.researchGeneral({ topic: "Hello world" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("http://kit.test/api/v1/capabilities/research.general/run");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("x-trace-id")).toBeTruthy();
    expect(JSON.parse(String(init.body))).toEqual({ input: { topic: "Hello world" } });
    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({ summary: "Research summary" });
  });

  it("surfaces sanitized run failures (provider_config_missing) without throwing", async () => {
    const failedRun = {
      runId: "run-2",
      capabilityId: "research.general",
      status: "failed",
      output: null,
      artifacts: [],
      sources: [],
      warnings: [],
      errors: [
        { code: "provider_config_missing", message: "OPENROUTER_API_KEY is not configured" },
      ],
    };
    mockFetchOnce(async () => jsonResponse(200, failedRun));
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    const result = await client.capabilities.researchGeneral({ topic: "t" });
    expect(result.status).toBe("failed");
    expect(result.output).toBeNull();
    expect(result.errors[0].code).toBe("provider_config_missing");
  });

  it("maps a 404 capability_not_found to CAPABILITY_UNAVAILABLE with hiai-kit requestId", async () => {
    mockFetchOnce(async () =>
      jsonResponse(404, {
        error: true,
        code: "capability_not_found",
        message: "Capability not found: research.general",
        requestId: "req_404_1",
      })
    );
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    await expect(
      client.capabilities.runCapability("research.general", { topic: "t" })
    ).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
      status: 404,
      requestId: "req_404_1",
    });
  });

  it("maps a 401 (no session configured) to HIAI_KIT_ERROR without claiming auth", async () => {
    mockFetchOnce(async () =>
      jsonResponse(401, {
        error: true,
        code: 401,
        message: "Authentication required",
        requestId: "req_401_1",
      })
    );
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    await expect(
      client.capabilities.runCapability("research.general", { topic: "t" })
    ).rejects.toMatchObject({
      code: "HIAI_KIT_ERROR",
      status: 401,
    });
  });

  it("maps a 400 validation_error to VALIDATION_ERROR", async () => {
    mockFetchOnce(async () =>
      jsonResponse(400, {
        error: true,
        code: "validation_error",
        message: "Invalid request",
        requestId: "req_400_1",
      })
    );
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    await expect(
      client.capabilities.runCapability("research.general", { topic: "t" })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });

  it("rejects with TIMEOUT when the HTTP boundary aborts", async () => {
    const abortError = Object.assign(new Error("The operation was aborted."), {
      name: "AbortError",
    });
    const mockFetch = mockFetchOnce(async (_url, init) => {
      // Signal is wired to the configured timeout.
      expect(init?.signal).toBeDefined();
      throw abortError;
    });
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 1234 });

    await expect(
      client.capabilities.runCapability("research.general", { topic: "t" })
    ).rejects.toMatchObject({
      code: "TIMEOUT",
      status: 504,
      details: { timeoutMs: 1234 },
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("maps network failures to HIAI_KIT_ERROR (502)", async () => {
    mockFetchOnce(async () => {
      throw new TypeError("fetch failed");
    });
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    await expect(
      client.capabilities.runCapability("research.general", { topic: "t" })
    ).rejects.toMatchObject({
      code: "HIAI_KIT_ERROR",
      status: 502,
    });
  });

  it("rejects with HIAI_KIT_ERROR when the response violates the contract", async () => {
    const missingRunId = { ...completedResearchRun };
    delete (missingRunId as { runId?: string }).runId;
    mockFetchOnce(async () => jsonResponse(200, missingRunId));
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    await expect(
      client.capabilities.runCapability("research.general", { topic: "t" })
    ).rejects.toMatchObject({
      code: "HIAI_KIT_ERROR",
      status: 502,
    });
  });

  it("validates input client-side and never calls the network", async () => {
    const mockFetch = mockFetchOnce(async () => jsonResponse(200, completedResearchRun));
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    await expect(client.capabilities.researchGeneral({ topic: "" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("supports the async responseMode envelope (202 accepted)", async () => {
    mockFetchOnce(async () => jsonResponse(202, { runId: "run-async-1", status: "accepted" }));
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    const accepted = await client.capabilities.runCapability(
      "research.general",
      { topic: "t" },
      { responseMode: "async" }
    );
    expect(accepted).toEqual({ runId: "run-async-1", status: "accepted" });
  });

  it("reads run records, manifests and the manifest list", async () => {
    mockFetchOnce(async () =>
      jsonResponse(200, {
        run: { ...completedResearchRun, createdAt: "2026-01-01T00:00:00.000Z" },
      })
    );
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });
    const record = await client.capabilities.getRun("run-1");
    expect(record.runId).toBe("run-1");
    expect(record.status).toBe("completed");

    mockFetchOnce(async () => jsonResponse(200, { capability: manifest }));
    const fetched = await client.capabilities.getCapabilityManifest("research.general");
    expect(fetched.id).toBe("research.general");
    expect(fetched.supportsAsync).toBe(true);

    const mockList = mockFetchOnce(async () => jsonResponse(200, { capabilities: [manifest] }));
    const list = await client.capabilities.listCapabilities("active");
    expect(list).toHaveLength(1);
    const [listUrl] = mockList.mock.calls[0] as [string];
    expect(listUrl).toBe("http://kit.test/api/v1/capabilities?status=active");
  });

  it("forwards configured credentials as headers and never leaks them in errors", async () => {
    const mockFetch = mockFetchOnce(async () =>
      jsonResponse(500, {
        error: true,
        code: "internal_error",
        message: "boom",
        requestId: "req_500_1",
      })
    );
    const client = createHiaiKitClient({
      url: "http://kit.test",
      timeoutMs: 5000,
      cookie: "session=abc",
      token: "tok123",
    });

    const err = await client.capabilities
      .runCapability("research.general", { topic: "t" })
      .catch((e: unknown) => e);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Cookie")).toBe("session=abc");
    expect(headers.get("Authorization")).toBe("Bearer tok123");
    expect(err).toBeInstanceOf(HiaiKitError);
    expect((err as HiaiKitError).message).not.toContain("abc");
    expect((err as HiaiKitError).message).not.toContain("tok123");
    expect((err as HiaiKitError).requestId).toBe("req_500_1");
  });

  it("keeps the outgoing x-trace-id as the error correlation id", async () => {
    const mockFetch = mockFetchOnce(async () =>
      jsonResponse(404, {
        error: true,
        code: "capability_not_found",
        message: "gone",
      })
    );
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    const err = await client.capabilities
      .runCapability("research.general", { topic: "t" })
      .catch((e: unknown) => e);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const traceId = new Headers(init.headers).get("x-trace-id");
    expect((err as HiaiKitError).correlationId).toBe(traceId);
  });
});

describe("carousel client", () => {
  it("creates a job with the typed payload", async () => {
    const mockFetch = mockFetchOnce(async () =>
      jsonResponse(200, { jobId: JOB_ID, slug: "my-carousel" })
    );
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    const result = await client.carousel.createJob(carouselInput);
    expect(result).toEqual({ jobId: JOB_ID, slug: "my-carousel" });
    const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("http://kit.test/api/v1/carousel");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(carouselInput);
  });

  it("gets a job, by slug, lists jobs and reads slide JSON", async () => {
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    mockFetchOnce(async () => jsonResponse(200, carouselJob));
    const job = await client.carousel.getJob(JOB_ID);
    expect(job.status).toBe("running");
    expect(job.result.slidePngPaths).toEqual([]);

    mockFetchOnce(async () => jsonResponse(200, carouselJob));
    const bySlug = await client.carousel.getJobBySlug("my-carousel");
    expect(bySlug.slug).toBe("my-carousel");

    mockFetchOnce(async () => jsonResponse(200, { jobs: [carouselJob] }));
    const jobs = await client.carousel.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].jobId).toBe(JOB_ID);

    mockFetchOnce(async () => jsonResponse(200, { title: "Slide 1", content: "Hello" }));
    const slide = await client.carousel.getSlideJson(JOB_ID, 1);
    expect(slide).toMatchObject({ title: "Slide 1" });
  });

  it("regenerates a slide with an optional description", async () => {
    const mockFetch = mockFetchOnce(async () =>
      jsonResponse(200, { json: { title: "Slide 1 v2" } })
    );
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    const result = await client.carousel.regenerateSlide(JOB_ID, 1, "make it punchier");
    expect(result.json).toMatchObject({ title: "Slide 1 v2" });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ description: "make it punchier" });
  });

  it("fetches the cover as binary without exposing the hiai-kit URL shape", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const mockFetch = mockFetchOnce(
      async () => new Response(pngBytes, { status: 200, headers: { "Content-Type": "image/png" } })
    );
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    const cover = await client.carousel.getCover(JOB_ID);
    expect(cover.contentType).toBe("image/png");
    expect(new Uint8Array(cover.data)).toEqual(pngBytes);
    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toBe(`http://kit.test/api/v1/carousel/${JOB_ID}/cover.png`);
  });

  it("rejects invalid job ids / slide numbers client-side without a network call", async () => {
    const mockFetch = mockFetchOnce(async () => jsonResponse(200, carouselJob));
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    await expect(client.carousel.getJob("not-a-uuid")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
    await expect(client.carousel.getSlideJson(JOB_ID, 0)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
    await expect(client.carousel.regenerateSlide(JOB_ID, 11)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("maps a generic carousel 404 to HIAI_KIT_ERROR (only capability 404s are CAPABILITY_UNAVAILABLE)", async () => {
    mockFetchOnce(async () =>
      jsonResponse(404, { error: true, code: 404, message: "Not found", requestId: "req_x" })
    );
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    await expect(client.carousel.getJob(JOB_ID)).rejects.toMatchObject({
      code: "HIAI_KIT_ERROR",
      status: 404,
      requestId: "req_x",
    });
  });

  it("validates the create payload client-side (e.g. > MAX_CAROUSEL_SLIDES)", async () => {
    const mockFetch = mockFetchOnce(async () => jsonResponse(200, { jobId: JOB_ID, slug: "s" }));
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    const tooManySlides: CreateCarouselInput = {
      carouselTitle: "T",
      slides: Array.from({ length: 11 }, (_, i) => ({ title: `S${i}`, content: "c" })),
      designPreset: "bold",
    };
    await expect(client.carousel.createJob(tooManySlides)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("normalizes error envelopes via toHiaiKitErrorEnvelope", async () => {
    mockFetchOnce(async () =>
      jsonResponse(404, { error: true, code: "capability_not_found", message: "gone" })
    );
    const client = createHiaiKitClient({ url: "http://kit.test", timeoutMs: 5000 });

    const err = await client.capabilities
      .runCapability("research.general", { topic: "t" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HiaiKitError);
    const envelope = (await import("./errors.js")).toHiaiKitErrorEnvelope(err);
    expect(envelope).toMatchObject({ error: "CAPABILITY_UNAVAILABLE", status: 404 });
  });
});
