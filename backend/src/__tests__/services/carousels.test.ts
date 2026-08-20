/**
 * Unit tests for the carousel application service.
 *
 * The ONLY boundary mocked is the hiai-kit adapter (`CarouselAdapter` — a
 * fake object with vi.fn methods). The shared content/revision services run
 * against the in-memory fake db. Covers:
 *   - create persists ContentItem + revision #1 with bodyJson
 *     { kind: "carousel", ...actual slide data } and the normalized job;
 *   - tenant isolation: cross-tenant reads/regenerations are 404
 *     NOT_FOUND; created rows carry the principal tenant;
 *   - revision preservation: full + slide regeneration append NEW revisions
 *     and never rewrite history;
 *   - adapter failures (hiai-kit unavailable / auth-blocked) propagate and
 *     never leave a persisted "successful" item behind;
 *   - runtime validation envelopes.
 *
 * Run with: npx vitest run src/__tests__/services/carousels.test.ts
 */
import { describe, expect, it, vi } from "vitest";

// Env + module mocks BEFORE the service imports evaluate: the service
// imports lib/db.js (→ config.ts → logger.ts) and the hiai-kit integration
// module (→ config.ts); without these the config validator calls exit(1).
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-key-min-32-characters-long";
process.env.TOKEN_ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.HIAI_KIT_URL ??= "http://localhost:3000";
process.env.HIAI_KIT_TIMEOUT_MS ??= "7000";

vi.mock("../../lib/db.js", () => ({
  db: {},
  checkDbHealth: async () => true,
  withTransaction: async (fn: (tx: any) => Promise<unknown>) => fn({}),
}));

vi.mock("../../lib/logger.js", () => {
  const noop = () => {};
  return {
    logger: { child: () => ({ warn: noop, error: noop, info: noop, debug: noop }), info: noop },
  };
});

import type {
  CarouselJob,
  CreateCarouselResult,
  RegenerateSlideResult,
} from "../../integrations/hiai-kit/index.js";
import { HiaiKitError } from "../../integrations/hiai-kit/index.js";
import {
  type CarouselAdapter,
  createCarousel,
  getCarousel,
  getCarouselJob,
  getCarouselRevisions,
  getCarouselSlideJson,
  listCarousels,
  regenerateCarousel,
  regenerateSlide,
  saveCarouselSlideDocument,
} from "../../services/carousels.js";
import { NotFoundError, toErrorEnvelope, ValidationError } from "../../services/errors.js";
import { makeFakeDb } from "../helpers/fake-db.js";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ctxA = { tenantId: TENANT_A, userId: "user-1" };
const ctxB = { tenantId: TENANT_B, userId: "user-2" };

const input = {
  carouselTitle: "10 AI tools",
  slides: [
    { title: "Intro", content: "Why AI tools matter" },
    { title: "Pricing", content: "Free vs paid" },
  ],
  designPreset: "bold",
  handle: "@brand",
  ctaText: "Follow for more",
  styleDescription: "dark, punchy",
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
      shadow: { color: "#000", blur: 8, offsetX: 0, offsetY: 2, opacity: 0.4 },
    },
    {
      id: "accent",
      type: "rect",
      x: 80,
      y: 340,
      rotation: 0,
      opacity: 1,
      visible: true,
      width: 120,
      height: 12,
      fill: "#ff3366",
      cornerRadius: 6,
    },
    {
      id: "body",
      type: "text",
      x: 80,
      y: 380,
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

function fakeAdapter(overrides: Partial<CarouselAdapter> = {}) {
  const doneJob: CarouselJob = {
    jobId: JOB_ID,
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
  };
  const createJob = vi.fn(
    async (): Promise<CreateCarouselResult> => ({ jobId: JOB_ID, slug: "10-ai-tools" })
  );
  const regenerateSlide = vi.fn(
    async (): Promise<RegenerateSlideResult> => ({ json: { width: 1080, title: "Slide 1 v2" } })
  );
  const getJob = vi.fn(async (): Promise<CarouselJob> => doneJob);
  const getSlideJson = vi.fn(async () => ({
    width: 1080,
    height: 1350,
    background: { color: "#000" },
  }));
  const adapter = { createJob, regenerateSlide, getJob, getSlideJson, ...overrides };
  return adapter as CarouselAdapter & {
    createJob: typeof createJob;
    regenerateSlide: typeof regenerateSlide;
    getJob: typeof getJob;
    getSlideJson: typeof getSlideJson;
  };
}

describe("createCarousel", () => {
  it("persists item + revision #1 with { kind: 'carousel' } bodyJson and the normalized job", async () => {
    const db = makeFakeDb();
    const adapter = fakeAdapter();
    const result = await createCarousel(ctxA, input, { db: db as any, adapter });

    expect(adapter.createJob).toHaveBeenCalledTimes(1);
    expect(adapter.createJob).toHaveBeenCalledWith(
      expect.objectContaining({ carouselTitle: "10 AI tools" })
    );
    expect(result.job).toEqual({ jobId: JOB_ID, slug: "10-ai-tools" });

    const item = result.item;
    expect(item.tenantId).toBe(TENANT_A);
    expect(item.title).toBe("10 AI tools");
    expect(item.status).toBe("draft");
    expect(item.bodyJson.kind).toBe("carousel");
    expect(item.bodyJson).toMatchObject({
      jobId: JOB_ID,
      slug: "10-ai-tools",
      jobStatus: "running",
      designPreset: "bold",
      handle: "@brand",
      ctaText: "Follow for more",
      slides: [
        { title: "Intro", content: "Why AI tools matter" },
        { title: "Pricing", content: "Free vs paid" },
      ],
    });

    const revisions = await getCarouselRevisions(ctxA, item.id, { db: db as any });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      revisionNumber: 1,
      changeNote: "Initial version",
      bodyJson: { kind: "carousel", jobId: JOB_ID },
    });
  });

  it("rejects invalid input with a 400 VALIDATION envelope", async () => {
    const db = makeFakeDb();
    const adapter = fakeAdapter();
    try {
      await createCarousel(ctxA, { ...input, carouselTitle: "" }, { db: db as any, adapter });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const envelope = toErrorEnvelope(err);
      expect(envelope).toMatchObject({ error: "Validation failed", code: "VALIDATION" });
      expect(envelope.details).toBeDefined();
    }
    expect(adapter.createJob).not.toHaveBeenCalled();
    expect(db._tables.content_items ?? []).toHaveLength(0);
  });

  it("propagates adapter failures and never persists a fake success", async () => {
    const db = makeFakeDb();
    const adapter = fakeAdapter({
      createJob: vi.fn(async () => {
        throw new HiaiKitError("HIAI_KIT_ERROR", "Authentication required", 401, {
          path: "/api/v1/carousel",
        });
      }),
    });

    await expect(createCarousel(ctxA, input, { db: db as any, adapter })).rejects.toMatchObject({
      code: "HIAI_KIT_ERROR",
      status: 401,
    });
    expect(db._tables.content_items ?? []).toHaveLength(0);
    expect(db._tables.content_item_revisions ?? []).toHaveLength(0);
  });
});

describe("tenant isolation", () => {
  it("returns 404 NOT_FOUND for another tenant's carousel", async () => {
    const db = makeFakeDb();
    const adapter = fakeAdapter();
    const { item } = await createCarousel(ctxA, input, { db: db as any, adapter });

    await expect(getCarousel(ctxB, item.id, { db: db as any })).rejects.toThrow(NotFoundError);
    await expect(getCarouselRevisions(ctxB, item.id, { db: db as any })).rejects.toThrow(
      NotFoundError
    );
    await expect(regenerateCarousel(ctxB, item.id, {}, { db: db as any, adapter })).rejects.toThrow(
      NotFoundError
    );
    await expect(
      regenerateSlide(ctxB, item.id, 1, undefined, { db: db as any, adapter })
    ).rejects.toThrow(NotFoundError);
    await expect(getCarouselJob(ctxB, item.id, { db: db as any, adapter })).rejects.toThrow(
      NotFoundError
    );
    expect(adapter.getJob).not.toHaveBeenCalled();
    expect(adapter.createJob).toHaveBeenCalledTimes(1); // only the tenant-A create
  });

  it("lists only the principal tenant's carousels", async () => {
    const db = makeFakeDb();
    const adapter = fakeAdapter();
    await createCarousel(ctxA, input, { db: db as any, adapter });
    await createCarousel(ctxB, { ...input, carouselTitle: "B deck" }, { db: db as any, adapter });

    const { data, pagination } = await listCarousels(
      ctxA,
      { page: 1, limit: 20 },
      { db: db as any }
    );
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("10 AI tools");
    expect(pagination.total).toBe(1);
  });

  it("excludes non-carousel content items from the list", async () => {
    const db = makeFakeDb();
    const adapter = fakeAdapter();
    await createCarousel(ctxA, input, { db: db as any, adapter });
    // A plain article persists through the shared content service.
    const { createContentItem } = await import("../../services/content.js");
    await createContentItem(
      ctxA,
      { title: "an article", bodyJson: { kind: "article" } },
      db as any
    );

    const { data } = await listCarousels(ctxA, { page: 1, limit: 20 }, { db: db as any });
    expect(data).toHaveLength(1);
    expect(data[0].bodyJson.kind).toBe("carousel");
  });

  it("returns truthful totals/pages when non-carousel items share the tenant", async () => {
    const db = makeFakeDb();
    const adapter = fakeAdapter();
    const { createContentItem } = await import("../../services/content.js");
    // 3 carousels + 2 plain articles. The old implementation filtered AFTER
    // the DB page and reported the filtered page length as `total` (and
    // `totalPages` off it) — totals must reflect ALL carousels, not the page.
    for (let i = 1; i <= 3; i++) {
      await createCarousel(
        ctxA,
        { ...input, carouselTitle: `Deck ${i}` },
        { db: db as any, adapter }
      );
    }
    await createContentItem(ctxA, { title: "article 1", bodyJson: { kind: "article" } }, db as any);
    await createContentItem(ctxA, { title: "article 2", bodyJson: { kind: "article" } }, db as any);

    const page1 = await listCarousels(ctxA, { page: 1, limit: 2 }, { db: db as any });
    expect(page1.data).toHaveLength(2);
    expect(page1.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });

    const page2 = await listCarousels(ctxA, { page: 2, limit: 2 }, { db: db as any });
    expect(page2.data).toHaveLength(1);
    expect(page2.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });
});

describe("revision preservation", () => {
  it("full regeneration appends a new revision and preserves the original bodyJson", async () => {
    const db = makeFakeDb();
    const adapter = fakeAdapter();
    const { item } = await createCarousel(ctxA, input, { db: db as any, adapter });

    // The regeneration dispatches a NEW job with a different id.
    const nextJobId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    adapter.createJob.mockResolvedValue({ jobId: nextJobId, slug: "10-ai-tools-v2" });

    const result = await regenerateCarousel(
      ctxA,
      item.id,
      {
        slides: [
          { title: "New intro", content: "Updated" },
          { title: "Pricing", content: "Free" },
        ],
      },
      { db: db as any, adapter }
    );

    expect(result.job).toEqual({ jobId: nextJobId, slug: "10-ai-tools-v2" });
    expect(result.item.bodyJson).toMatchObject({
      jobId: nextJobId,
      jobStatus: "running",
      slides: [
        { title: "New intro", content: "Updated" },
        { title: "Pricing", content: "Free" },
      ],
    });

    const revisions = await getCarouselRevisions(ctxA, item.id, { db: db as any });
    expect(revisions).toHaveLength(2);
    expect(revisions.map((r) => r.revisionNumber)).toEqual([2, 1]);
    // The original revision still carries the ORIGINAL job + slides.
    expect(revisions[1]).toMatchObject({
      revisionNumber: 1,
      bodyJson: { jobId: JOB_ID, slides: input.slides },
    });
    expect(revisions[0].changeNote).toBe("Full carousel regenerated");
  });

  it("slide regeneration persists the actual regenerated document and appends a revision", async () => {
    const db = makeFakeDb();
    const adapter = fakeAdapter();
    const { item } = await createCarousel(ctxA, input, { db: db as any, adapter });

    const result = await regenerateSlide(ctxA, item.id, 2, "make the pricing slide punchier", {
      db: db as any,
      adapter,
    });

    expect(adapter.regenerateSlide).toHaveBeenCalledWith(
      JOB_ID,
      2,
      "make the pricing slide punchier"
    );
    expect(result.slide).toMatchObject({
      title: "Pricing",
      content: "Free vs paid",
      doc: { width: 1080, title: "Slide 1 v2" },
    });
    expect(result.slide.regeneratedAt).toBeTruthy();

    const revisions = await getCarouselRevisions(ctxA, item.id, { db: db as any });
    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toMatchObject({ revisionNumber: 2, changeNote: "Slide 2 regenerated" });
    expect(revisions[0].bodyJson.slides[1].doc).toEqual({ width: 1080, title: "Slide 1 v2" });
    // Slide 1 untouched, original revision untouched.
    expect(revisions[0].bodyJson.slides[0].doc).toBeUndefined();
    expect(revisions[1].bodyJson.slides).toEqual(input.slides);
  });

  it("rejects out-of-range slide indexes (400 VALIDATION)", async () => {
    const db = makeFakeDb();
    const adapter = fakeAdapter();
    const { item } = await createCarousel(ctxA, input, { db: db as any, adapter });

    await expect(
      regenerateSlide(ctxA, item.id, 0, undefined, { db: db as any, adapter })
    ).rejects.toThrow(ValidationError);
    await expect(
      regenerateSlide(ctxA, item.id, 3, undefined, { db: db as any, adapter })
    ).rejects.toThrow(ValidationError);
    expect(adapter.regenerateSlide).not.toHaveBeenCalled();
  });

  it("proxies live job status and slide documents through the adapter", async () => {
    const db = makeFakeDb();
    const adapter = fakeAdapter();
    const { item } = await createCarousel(ctxA, input, { db: db as any, adapter });

    const job = await getCarouselJob(ctxA, item.id, { db: db as any, adapter });
    expect(job.status).toBe("done");
    expect(adapter.getJob).toHaveBeenCalledWith(JOB_ID);

    const json = await getCarouselSlideJson(ctxA, item.id, 1, { db: db as any, adapter });
    expect(json).toMatchObject({ width: 1080 });
    expect(adapter.getSlideJson).toHaveBeenCalledWith(JOB_ID, 1);
  });

  it("surfaces adapter failures on regeneration without mutating history", async () => {
    const db = makeFakeDb();
    const adapter = fakeAdapter();
    const { item } = await createCarousel(ctxA, input, { db: db as any, adapter });

    // Regeneration hits the unavailable adapter (timeout) — the persisted
    // history must be untouched.
    adapter.createJob.mockRejectedValue(
      new HiaiKitError("TIMEOUT", "hiai-kit request timed out after 7000ms", 504, {
        timeoutMs: 7000,
        path: "/api/v1/carousel",
      })
    );

    await expect(
      regenerateCarousel(ctxA, item.id, {}, { db: db as any, adapter })
    ).rejects.toMatchObject({ code: "TIMEOUT", status: 504 });

    const revisions = await getCarouselRevisions(ctxA, item.id, { db: db as any });
    expect(revisions).toHaveLength(1); // no new revision on failure
    expect(revisions[0].revisionNumber).toBe(1);
  });
});

describe("saveCarouselSlideDocument", () => {
  it("persists the document at the selected slide only and appends a revision", async () => {
    const db = makeFakeDb();
    const adapter = fakeAdapter();
    const { item } = await createCarousel(ctxA, input, { db: db as any, adapter });

    const result = await saveCarouselSlideDocument(ctxA, item.id, 2, validSlideDoc, {
      db: db as any,
    });

    expect(result.slide).toMatchObject({ title: "Pricing", content: "Free vs paid" });
    expect(result.slide.doc).toEqual(validSlideDoc);
    expect(result.slide.savedAt).toBeTruthy();
    // Only the selected slide's doc changed — slide 1 untouched.
    expect(result.item.bodyJson.slides[1].doc).toEqual(validSlideDoc);
    expect(result.item.bodyJson.slides[0].doc).toBeUndefined();
    expect(result.item.currentRevisionNumber).toBe(2);

    const revisions = await getCarouselRevisions(ctxA, item.id, { db: db as any });
    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toMatchObject({
      revisionNumber: 2,
      changeNote: "Slide 2 document saved",
    });
    expect(revisions[0].bodyJson.slides[1].doc).toEqual(validSlideDoc);
    expect(revisions[0].bodyJson.slides[0].doc).toBeUndefined();
    // Original revision untouched.
    expect(revisions[1].bodyJson.slides).toEqual(input.slides);

    // Read-back through the tenant-scoped getter returns the persisted doc.
    const fetched = await getCarousel(ctxA, item.id, { db: db as any });
    expect(fetched.bodyJson.slides[1].doc).toEqual(validSlideDoc);
  });

  it("rejects an invalid document with 400 VALIDATION and persists nothing", async () => {
    const db = makeFakeDb();
    const adapter = fakeAdapter();
    const { item } = await createCarousel(ctxA, input, { db: db as any, adapter });

    const garbage = { foo: "bar" }; // missing width/height/elements
    try {
      await saveCarouselSlideDocument(ctxA, item.id, 1, garbage, { db: db as any });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const envelope = toErrorEnvelope(err);
      expect(envelope).toMatchObject({ error: "Validation failed", code: "VALIDATION" });
      expect(envelope.details).toBeDefined();
    }

    // No fake success: no new revision, item bodyJson untouched.
    const revisions = await getCarouselRevisions(ctxA, item.id, { db: db as any });
    expect(revisions).toHaveLength(1);
    expect(revisions[0].revisionNumber).toBe(1);
    const fetched = await getCarousel(ctxA, item.id, { db: db as any });
    expect(fetched.bodyJson.slides[0].doc).toBeUndefined();
    expect(fetched.currentRevisionNumber).toBe(1);
  });

  it("rejects documents with non-hiai-kit element types or missing element ids", async () => {
    const db = makeFakeDb();
    const adapter = fakeAdapter();
    const { item } = await createCarousel(ctxA, input, { db: db as any, adapter });

    await expect(
      saveCarouselSlideDocument(
        ctxA,
        item.id,
        1,
        { ...validSlideDoc, elements: [{ ...validSlideDoc.elements[0], type: "unknown" }] },
        { db: db as any }
      )
    ).rejects.toThrow(ValidationError);
    await expect(
      saveCarouselSlideDocument(
        ctxA,
        item.id,
        1,
        { width: 1080, height: 1350, elements: [{ type: "text", x: 1, y: 2 }] }, // no id
        { db: db as any }
      )
    ).rejects.toThrow(ValidationError);

    const revisions = await getCarouselRevisions(ctxA, item.id, { db: db as any });
    expect(revisions).toHaveLength(1);
  });

  it("rejects out-of-range slide indexes without persisting", async () => {
    const db = makeFakeDb();
    const adapter = fakeAdapter();
    const { item } = await createCarousel(ctxA, input, { db: db as any, adapter });

    await expect(
      saveCarouselSlideDocument(ctxA, item.id, 0, validSlideDoc, { db: db as any })
    ).rejects.toThrow(ValidationError);
    await expect(
      saveCarouselSlideDocument(ctxA, item.id, 3, validSlideDoc, { db: db as any })
    ).rejects.toThrow(ValidationError);

    const revisions = await getCarouselRevisions(ctxA, item.id, { db: db as any });
    expect(revisions).toHaveLength(1);
  });

  it("returns 404 NOT_FOUND for another tenant's carousel", async () => {
    const db = makeFakeDb();
    const adapter = fakeAdapter();
    const { item } = await createCarousel(ctxA, input, { db: db as any, adapter });

    await expect(
      saveCarouselSlideDocument(ctxB, item.id, 1, validSlideDoc, { db: db as any })
    ).rejects.toThrow(NotFoundError);

    const revisions = await getCarouselRevisions(ctxA, item.id, { db: db as any });
    expect(revisions).toHaveLength(1);
    const fetched = await getCarousel(ctxA, item.id, { db: db as any });
    expect(fetched.bodyJson.slides[0].doc).toBeUndefined();
  });
});
