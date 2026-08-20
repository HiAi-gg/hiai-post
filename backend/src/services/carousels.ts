/**
 * Carousel application service — the HiAi-Post product layer over the
 * hiai-kit carousel jobs pipeline.
 *
 * Responsibilities:
 *   - runtime-validate carousel definitions (zod in-service, DomainError
 *     400 VALIDATION envelopes);
 *   - call hiai-kit ONLY through the centralized integration adapter
 *     (`createHiaiKitClient()` from `integrations/hiai-kit`); the adapter
 *     is injectable (`opts.adapter`) so unit tests mock exactly the
 *     adapter boundary and nothing else;
 *   - persist a ContentItem + immutable revision history (via the shared
 *     content/revision services) with `bodyJson` shaped
 *     `{ kind: "carousel", ...actual slide data }` — the normalized
 *     job id/slug, the deck definition and per-slide source copy plus the
 *     actually-regenerated slide document when available;
 *   - preserve revisions: full-carousel regeneration and per-slide
 *     regeneration append NEW revisions, never rewrite history;
 *   - tenant scope comes exclusively from `ctx.tenantId`; cross-tenant
 *     rows are indistinguishable from "not found" (404).
 *
 * HiaiKitError propagates untouched so the route layer can map it to a
 * normalized capability error with the hiai-kit status code — this service
 * never fabricates a successful job when hiai-kit is unavailable or
 * auth-blocked.
 */

import type { PgDatabase } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { ContentSource } from "../db/schema.js";
import {
  CAROUSEL_PRESETS,
  type CarouselDesignPreset,
  type CarouselJob,
  type AddBlankSlideResult,
  type CreateCarouselInput,
  type CreateCarouselResult,
  type EditCoverResult,
  createHiaiKitClient,
  MAX_CAROUSEL_SLIDES,
  type RegenerateSlideResult,
  slideDocumentSchema,
} from "../integrations/hiai-kit/index.js";
import { db as defaultDb } from "../lib/db.js";
import { observeCall } from "../lib/observe.js";
import { createContentItem, getContentItem, listContentItems } from "./content.js";
import { NotFoundError, ValidationError } from "./errors.js";
import { createRevision, listRevisions } from "./revisions.js";
import type { Paginated, PaginationInput, ServiceContext } from "./types.js";

type Db = Pick<PgDatabase<any, any, any>, "select" | "insert" | "update" | "delete">;

/**
 * The slice of the hiai-kit carousel client this service depends on.
 * Tests substitute a fake; production uses `createHiaiKitClient().carousel`
 * (the centralized integration boundary).
 */
export interface CarouselAdapter {
  createJob(input: CreateCarouselInput): Promise<CreateCarouselResult>;
  regenerateSlide(
    jobId: string,
    slideNumber: number,
    description?: string
  ): Promise<RegenerateSlideResult>;
  getJob(jobId: string): Promise<CarouselJob>;
  getSlideJson(jobId: string, slideNumber: number): Promise<unknown>;
  saveSlideJson?(jobId: string, slideNumber: number, doc: unknown): Promise<{ ok: true; json: unknown }>;
  uploadSlidePng?(jobId: string, slideNumber: number, bytes: Uint8Array): Promise<{ ok: true; fileName: string }>;
  getCover?(jobId: string): Promise<{ contentType: string; data: ArrayBuffer }>;
  getSlidePng?(jobId: string, slideNumber: number): Promise<{ contentType: string; data: ArrayBuffer }>;
  addBlankSlide?(jobId: string): Promise<AddBlankSlideResult>;
  editCover?(jobId: string, description: string): Promise<EditCoverResult>;
}

export interface CarouselServiceOptions {
  db?: Db;
  adapter?: CarouselAdapter;
  /**
   * Truthful creation source for the persisted content item. Routes derive
   * it from the principal; MCP tools pass "chatgpt". Defaults to "web".
   */
  source?: ContentSource;
}

export interface CarouselSlideData {
  title: string;
  content: string;
  /** The actual generated slide document (persisted after slide regeneration). */
  doc?: unknown;
  regeneratedAt?: string;
  /** When the slide document was last saved via the document-save endpoint. */
  savedAt?: string;
}

export interface CarouselBodyJson {
  kind: "carousel";
  jobId: string;
  slug: string;
  carouselTitle: string;
  designPreset: CarouselDesignPreset;
  slideWidth?: number;
  slideHeight?: number;
  styleDescription?: string | null;
  handle?: string | null;
  ctaText?: string | null;
  /** Snapshot of the job lifecycle state persisted at the last write. */
  jobStatus: "running" | "done" | "failed";
  slides: CarouselSlideData[];
}

// ---------------------------------------------------------------------------
// Runtime validation (in-service; no request tenant id is ever accepted)
// ---------------------------------------------------------------------------

const carouselSlideInputSchema = z.object({
  title: z.string().max(500),
  content: z.string().max(5000),
});

const createCarouselSchema = z.object({
  carouselTitle: z.string().min(1).max(500),
  slides: z.array(carouselSlideInputSchema).min(1).max(MAX_CAROUSEL_SLIDES),
  designPreset: z.enum(CAROUSEL_PRESETS),
  slideWidth: z.number().int().positive().optional(),
  slideHeight: z.number().int().positive().optional(),
  styleDescription: z.string().max(2000).optional(),
  handle: z.string().max(200).optional(),
  ctaText: z.string().max(200).optional(),
});

/** Partial re-definition accepted by full-carousel regeneration. */
const regeneratePatchSchema = createCarouselSchema.partial();

const regenerateSlideBodySchema = z.object({
  description: z.string().max(2000).optional(),
});

const editCoverBodySchema = z.object({
  description: z.string().trim().min(1).max(2000),
});

const carouselBodyJsonSchema = z.object({
  kind: z.literal("carousel"),
  jobId: z.string().min(1),
  slug: z.string().min(1),
  carouselTitle: z.string(),
  designPreset: z.enum(CAROUSEL_PRESETS),
  slideWidth: z.number().optional(),
  slideHeight: z.number().optional(),
  styleDescription: z.string().nullable().optional(),
  handle: z.string().nullable().optional(),
  ctaText: z.string().nullable().optional(),
  jobStatus: z.enum(["running", "done", "failed"]),
  slides: z.array(
    z.object({
      title: z.string(),
      content: z.string(),
      doc: z.unknown().optional(),
      regeneratedAt: z.string().optional(),
      savedAt: z.string().optional(),
    })
  ),
});

function withDb(db?: Db): Db {
  return (db as any) ?? defaultDb;
}

function defaultAdapter(): CarouselAdapter {
  const client = createHiaiKitClient();
  return {
    createJob: (input) => client.carousel.createJob(input),
    regenerateSlide: (jobId, slideNumber, description) =>
      client.carousel.regenerateSlide(jobId, slideNumber, description),
    getJob: (jobId) => client.carousel.getJob(jobId),
    getSlideJson: (jobId, slideNumber) => client.carousel.getSlideJson(jobId, slideNumber),
    saveSlideJson: (jobId, slideNumber, doc) => client.carousel.saveSlideJson(jobId, slideNumber, doc),
    uploadSlidePng: (jobId, slideNumber, bytes) =>
      client.carousel.uploadSlidePng(jobId, slideNumber, bytes),
    getCover: (jobId) => client.carousel.getCover(jobId),
    getSlidePng: (jobId, slideNumber) => client.carousel.getSlidePng(jobId, slideNumber),
    addBlankSlide: (jobId) => client.carousel.addBlankSlide(jobId),
    editCover: (jobId, description) => client.carousel.editCover(jobId, description),
  };
}

function buildBodyJson(data: CreateCarouselInput, jobId: string, slug: string): CarouselBodyJson {
  return {
    kind: "carousel",
    jobId,
    slug,
    carouselTitle: data.carouselTitle,
    designPreset: data.designPreset,
    slideWidth: data.slideWidth,
    slideHeight: data.slideHeight,
    styleDescription: data.styleDescription ?? null,
    handle: data.handle ?? null,
    ctaText: data.ctaText ?? null,
    jobStatus: "running",
    slides: data.slides.map((s) => ({ title: s.title, content: s.content })),
  };
}

function toCreateCarouselInput(body: CarouselBodyJson): CreateCarouselInput {
  return {
    carouselTitle: body.carouselTitle,
    slides: body.slides.map((s) => ({ title: s.title, content: s.content })),
    designPreset: body.designPreset,
    slideWidth: body.slideWidth,
    slideHeight: body.slideHeight,
    styleDescription: body.styleDescription ?? undefined,
    handle: body.handle ?? undefined,
    ctaText: body.ctaText ?? undefined,
  };
}

/** Fetch a tenant-scoped item and require it to be a persisted carousel. */
async function loadCarousel(
  ctx: ServiceContext,
  id: string,
  db: Db
): Promise<{ item: any; body: CarouselBodyJson }> {
  const item = await getContentItem(ctx, id, db);
  const parsed = carouselBodyJsonSchema.safeParse(item.bodyJson);
  if (!parsed.success) throw new NotFoundError("Carousel not found");
  return { item, body: parsed.data };
}

function assertSlideIndex(index: unknown, slideCount: number): number {
  if (
    !Number.isInteger(index) ||
    (index as number) < 1 ||
    (index as number) > slideCount ||
    slideCount < 1
  ) {
    throw new ValidationError(`Slide index must be an integer between 1 and ${slideCount}`);
  }
  return index as number;
}

/** Short error label for telemetry metadata (codes only, never messages). */
function normalizeObservedError(err: unknown): string {
  if (err instanceof ValidationError || err instanceof NotFoundError) return err.code;
  const code = (err as { code?: unknown })?.code;
  return typeof code === "string" && code.length > 0 ? code : "INTERNAL";
}

// ---------------------------------------------------------------------------
// Service surface
// ---------------------------------------------------------------------------

/**
 * Create a carousel: dispatch a hiai-kit job, persist the ContentItem with
 * revision #1 snapshotting `{ kind: "carousel", ... }` bodyJson. Never
 * persists anything if the adapter rejects (no fake success).
 *
 * Wrapped with observeCall: emits `carousel.create` start/success/failure
 * events to hiai-observe (no-op when unconfigured; never alters behavior).
 */
export function createCarousel(
  ctx: ServiceContext,
  input: unknown,
  opts: CarouselServiceOptions = {}
): Promise<{ item: any; job: CreateCarouselResult }> {
  return observeCall(
    {
      kind: "carousel",
      operation: "carousel.create",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      enrich: {
        success: (result) => {
          const r = result as { job: CreateCarouselResult };
          return { jobId: r.job.jobId, slug: r.job.slug };
        },
        failure: (err) => ({ error: normalizeObservedError(err) }),
      },
    },
    () => createCarouselInner(ctx, input, opts)
  );
}

async function createCarouselInner(
  ctx: ServiceContext,
  input: unknown,
  opts: CarouselServiceOptions = {}
): Promise<{ item: any; job: CreateCarouselResult }> {
  const db = withDb(opts.db);
  const adapter = opts.adapter ?? defaultAdapter();

  const parsed = createCarouselSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Validation failed", parsed.error.flatten());
  const data = parsed.data;

  const job = await adapter.createJob(data);
  const bodyJson = buildBodyJson(data, job.jobId, job.slug);
  const item = await createContentItem(
    ctx,
    { title: data.carouselTitle, bodyJson, source: opts.source },
    db
  );
  return { item, job };
}

export async function getCarousel(
  ctx: ServiceContext,
  id: string,
  opts: CarouselServiceOptions = {}
): Promise<any> {
  const db = withDb(opts.db);
  const { item } = await loadCarousel(ctx, id, db);
  return item;
}

/**
 * Page size used to fetch ALL tenant content items before the in-memory
 * carousel filter (see `listCarousels`). A single SQL
 * `body_json ->> 'kind' = 'carousel'` predicate would be the ideal query,
 * but the in-memory fake db used by tests cannot decode JSONB operators, so
 * the filter runs here. 100k is far beyond any tenant's content volume and
 * keeps the unfiltered fetch bounded.
 */
const CAROUSEL_LIST_FETCH_LIMIT = 100_000;

export async function listCarousels(
  ctx: ServiceContext,
  input: PaginationInput,
  opts: CarouselServiceOptions = {}
): Promise<Paginated<any>> {
  const db = withDb(opts.db);
  // Fetch every tenant content item (listContentItems is tenant-scoped),
  // keep only persisted carousels, THEN paginate. `total`/`totalPages` are
  // computed from the filtered set — the truthful carousel count — instead
  // of the previous buggy behavior that filtered AFTER the DB page and
  // reported the filtered page length as the total.
  const { data } = await listContentItems(
    ctx,
    { ...input, page: 1, limit: CAROUSEL_LIST_FETCH_LIMIT },
    db
  );
  const carousels = data.filter((i: any) => i.bodyJson?.kind === "carousel");
  const { page, limit } = input;
  const items = carousels.slice((page - 1) * limit, page * limit);
  return {
    data: items,
    pagination: {
      page,
      limit,
      total: carousels.length,
      totalPages: Math.ceil(carousels.length / limit),
    },
  };
}

export async function getCarouselRevisions(
  ctx: ServiceContext,
  id: string,
  opts: CarouselServiceOptions = {}
): Promise<any[]> {
  const db = withDb(opts.db);
  await loadCarousel(ctx, id, db);
  return listRevisions(ctx, id, db);
}

/**
 * Live job status for a persisted carousel, proxied through the adapter.
 * Fails with the normalized hiai-kit error when the peer is unavailable /
 * auth-blocked — never a fabricated "done".
 *
 * Wrapped with observeCall: emits `carousel.job.status` events.
 */
export function getCarouselJob(
  ctx: ServiceContext,
  id: string,
  opts: CarouselServiceOptions = {}
): Promise<CarouselJob> {
  return observeCall(
    {
      kind: "carousel",
      operation: "carousel.job.status",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      metadata: { contentItemId: id },
      enrich: {
        success: (result) => {
          const job = result as CarouselJob;
          return { jobId: job.jobId, jobStatus: job.status };
        },
        failure: (err) => ({ error: normalizeObservedError(err) }),
      },
    },
    () => getCarouselJobInner(ctx, id, opts)
  );
}

async function getCarouselJobInner(
  ctx: ServiceContext,
  id: string,
  opts: CarouselServiceOptions = {}
): Promise<CarouselJob> {
  const db = withDb(opts.db);
  const adapter = opts.adapter ?? defaultAdapter();
  const { body } = await loadCarousel(ctx, id, db);
  return adapter.getJob(body.jobId);
}

/** Actual generated slide document for a persisted carousel (adapter-proxied). */
export async function getCarouselSlideJson(
  ctx: ServiceContext,
  id: string,
  index: unknown,
  opts: CarouselServiceOptions = {}
): Promise<unknown> {
  const db = withDb(opts.db);
  const adapter = opts.adapter ?? defaultAdapter();
  const { body } = await loadCarousel(ctx, id, db);
  const slideNumber = assertSlideIndex(index, body.slides.length);
  return adapter.getSlideJson(body.jobId, slideNumber);
}

/**
 * Full-carousel regeneration: apply an optional partial re-definition
 * (edited copy / preset), dispatch a NEW hiai-kit job, and append a new
 * revision carrying the new bodyJson. History is preserved.
 *
 * Wrapped with observeCall: emits `carousel.regenerate` events.
 */
export function regenerateCarousel(
  ctx: ServiceContext,
  id: string,
  patch: unknown = {},
  opts: CarouselServiceOptions = {}
): Promise<{ item: any; revision: any; job: CreateCarouselResult }> {
  return observeCall(
    {
      kind: "carousel",
      operation: "carousel.regenerate",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      metadata: { contentItemId: id },
      enrich: {
        success: (result) => {
          const r = result as { job: CreateCarouselResult };
          return { jobId: r.job.jobId, slug: r.job.slug };
        },
        failure: (err) => ({ error: normalizeObservedError(err) }),
      },
    },
    () => regenerateCarouselInner(ctx, id, patch, opts)
  );
}

async function regenerateCarouselInner(
  ctx: ServiceContext,
  id: string,
  patch: unknown = {},
  opts: CarouselServiceOptions = {}
): Promise<{ item: any; revision: any; job: CreateCarouselResult }> {
  const db = withDb(opts.db);
  const adapter = opts.adapter ?? defaultAdapter();
  const { body } = await loadCarousel(ctx, id, db);

  const parsedPatch = regeneratePatchSchema.safeParse(patch ?? {});
  if (!parsedPatch.success)
    throw new ValidationError("Validation failed", parsedPatch.error.flatten());
  const p = parsedPatch.data;

  // Start from the persisted deck (via toCreateCarouselInput) and overlay
  // the optional patch fields — undefined patch fields fall back to the
  // persisted values, null patch fields (defensive; zod rejects null)
  // normalize to undefined.
  const base = toCreateCarouselInput(body);
  const merged: CreateCarouselInput = {
    carouselTitle: p.carouselTitle ?? base.carouselTitle,
    slides: p.slides ?? base.slides,
    designPreset: p.designPreset ?? base.designPreset,
    slideWidth: p.slideWidth ?? base.slideWidth,
    slideHeight: p.slideHeight ?? base.slideHeight,
    styleDescription:
      p.styleDescription !== undefined ? (p.styleDescription ?? undefined) : base.styleDescription,
    handle: p.handle !== undefined ? (p.handle ?? undefined) : base.handle,
    ctaText: p.ctaText !== undefined ? (p.ctaText ?? undefined) : base.ctaText,
  };

  const job = await adapter.createJob(merged);
  const nextBodyJson = buildBodyJson(merged, job.jobId, job.slug);

  const revisionInput: { bodyJson: CarouselBodyJson; changeNote: string; title?: string } = {
    bodyJson: nextBodyJson,
    changeNote: "Full carousel regenerated",
  };
  if (merged.carouselTitle !== body.carouselTitle) revisionInput.title = merged.carouselTitle;

  const revision = await createRevision(ctx, id, revisionInput, db);
  const item = await getContentItem(ctx, id, db);
  return { item, revision, job };
}

/**
 * Regenerate a single slide: call hiai-kit with the job id + 1-based slide
 * index, persist the ACTUAL regenerated slide document into the slide's
 * bodyJson entry, and append a new revision (history preserved).
 *
 * Wrapped with observeCall: emits `carousel.regenerateSlide` events.
 */
export function regenerateSlide(
  ctx: ServiceContext,
  id: string,
  index: unknown,
  description: unknown = undefined,
  opts: CarouselServiceOptions = {}
): Promise<{ item: any; revision: any; slide: CarouselSlideData }> {
  return observeCall(
    {
      kind: "carousel",
      operation: "carousel.regenerateSlide",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      metadata: { contentItemId: id, slideNumber: Number(index) || 0 },
      enrich: {
        success: (result) => {
          const r = result as { slide: CarouselSlideData; revision: any };
          return {
            jobId: (r.revision?.bodyJson as { jobId?: string } | null | undefined)?.jobId ?? "",
            regeneratedAt: r.slide.regeneratedAt ?? "",
          };
        },
        failure: (err) => ({ error: normalizeObservedError(err) }),
      },
    },
    () => regenerateSlideInner(ctx, id, index, description, opts)
  );
}

async function regenerateSlideInner(
  ctx: ServiceContext,
  id: string,
  index: unknown,
  description: unknown = undefined,
  opts: CarouselServiceOptions = {}
): Promise<{ item: any; revision: any; slide: CarouselSlideData }> {
  const db = withDb(opts.db);
  const adapter = opts.adapter ?? defaultAdapter();
  const { body } = await loadCarousel(ctx, id, db);

  const parsedBody = regenerateSlideBodySchema.safeParse(
    description !== undefined ? { description } : {}
  );
  if (!parsedBody.success)
    throw new ValidationError("Validation failed", parsedBody.error.flatten());

  const slideNumber = assertSlideIndex(index, body.slides.length);
  const result = await adapter.regenerateSlide(
    body.jobId,
    slideNumber,
    parsedBody.data.description
  );

  const slides = body.slides.map((s) => ({ ...s }));
  slides[slideNumber - 1] = {
    ...slides[slideNumber - 1],
    doc: result.json,
    regeneratedAt: new Date().toISOString(),
  };
  const nextBodyJson: CarouselBodyJson = { ...body, slides };

  const revision = await createRevision(
    ctx,
    id,
    { bodyJson: nextBodyJson, changeNote: `Slide ${slideNumber} regenerated` },
    db
  );
  const item = await getContentItem(ctx, id, db);
  return { item, revision, slide: slides[slideNumber - 1] };
}

/**
 * Persist a slide's actual document (`PUT /carousels/:id/slides/:index/json`).
 *
 * The request body IS the hiai-kit slide document; it is runtime-validated
 * against the verified hiai-kit document contract (`slideDocumentSchema` —
 * canvas width/height, element ids, known element types, x/y positions) with
 * passthrough so every field hiai-kit emits round-trips unchanged. Only the
 * selected slide's `doc` is replaced — no other slide, no deck metadata, no
 * job state is touched — and a NEW immutable revision is appended (history is
 * preserved, never rewritten). The returned `item` is the tenant-scoped
 * current content ("normalized current content") after the save.
 *
 * Wrapped with observeCall: emits `carousel.slideDoc.save` events.
 */
export function saveCarouselSlideDocument(
  ctx: ServiceContext,
  id: string,
  index: unknown,
  doc: unknown,
  opts: CarouselServiceOptions = {}
): Promise<{ item: any; revision: any; slide: CarouselSlideData }> {
  return observeCall(
    {
      kind: "carousel",
      operation: "carousel.slideDoc.save",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      metadata: { contentItemId: id, slideNumber: Number(index) || 0 },
      enrich: {
        success: (result) => {
          const r = result as { revision: any; slide: CarouselSlideData };
          return {
            revisionNumber: r.revision?.revisionNumber ?? 0,
            savedAt: r.slide.savedAt ?? "",
          };
        },
        failure: (err) => ({ error: normalizeObservedError(err) }),
      },
    },
    () => saveCarouselSlideDocumentInner(ctx, id, index, doc, opts)
  );
}

async function saveCarouselSlideDocumentInner(
  ctx: ServiceContext,
  id: string,
  index: unknown,
  doc: unknown,
  opts: CarouselServiceOptions = {}
): Promise<{ item: any; revision: any; slide: CarouselSlideData }> {
  const db = withDb(opts.db);
  const { body } = await loadCarousel(ctx, id, db);

  const slideNumber = assertSlideIndex(index, body.slides.length);

  const parsed = slideDocumentSchema.safeParse(doc ?? {});
  if (!parsed.success) throw new ValidationError("Validation failed", parsed.error.flatten());

  const adapter = opts.adapter ?? defaultAdapter();
  if (adapter.saveSlideJson) {
    await adapter.saveSlideJson(body.jobId, slideNumber, parsed.data);
  }

  const slides = body.slides.map((s) => ({ ...s }));
  slides[slideNumber - 1] = {
    ...slides[slideNumber - 1],
    doc: parsed.data,
    savedAt: new Date().toISOString(),
  };
  const nextBodyJson: CarouselBodyJson = { ...body, slides };

  const revision = await createRevision(
    ctx,
    id,
    { bodyJson: nextBodyJson, changeNote: `Slide ${slideNumber} document saved` },
    db
  );
  const item = await getContentItem(ctx, id, db);
  return { item, revision, slide: slides[slideNumber - 1] };
}

/** Proxy the Sharp-written cover PNG from the existing kit job session. */
export async function getCarouselCover(
  ctx: ServiceContext,
  id: string,
  opts: CarouselServiceOptions = {}
): Promise<{ contentType: string; data: ArrayBuffer }> {
  const db = withDb(opts.db);
  const adapter = opts.adapter ?? defaultAdapter();
  const { body } = await loadCarousel(ctx, id, db);
  if (!adapter.getCover) throw new NotFoundError("Cover not available");
  return adapter.getCover(body.jobId);
}

/**
 * Persist a client Konva PNG export through kit's existing session dir.
 * Slide PNGs do not exist until this upload succeeds.
 */
export function uploadCarouselSlidePng(
  ctx: ServiceContext,
  id: string,
  index: unknown,
  bytes: Uint8Array,
  opts: CarouselServiceOptions = {}
): Promise<{ fileName: string }> {
  return observeCall(
    {
      kind: "carousel",
      operation: "carousel.slidePng.upload",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      metadata: { contentItemId: id, slideNumber: Number(index) || 0 },
      enrich: {
        success: (result) => ({ fileName: (result as { fileName: string }).fileName }),
        failure: (err) => ({ error: normalizeObservedError(err) }),
      },
    },
    () => uploadCarouselSlidePngInner(ctx, id, index, bytes, opts)
  );
}

async function uploadCarouselSlidePngInner(
  ctx: ServiceContext,
  id: string,
  index: unknown,
  bytes: Uint8Array,
  opts: CarouselServiceOptions = {}
): Promise<{ fileName: string }> {
  const db = withDb(opts.db);
  const adapter = opts.adapter ?? defaultAdapter();
  const { body } = await loadCarousel(ctx, id, db);
  const slideNumber = assertSlideIndex(index, body.slides.length);
  if (!adapter.uploadSlidePng) throw new ValidationError("Slide PNG upload is not available");
  return adapter.uploadSlidePng(body.jobId, slideNumber, bytes);
}

export async function getCarouselSlidePng(
  ctx: ServiceContext,
  id: string,
  index: unknown,
  opts: CarouselServiceOptions = {}
): Promise<{ contentType: string; data: ArrayBuffer }> {
  const db = withDb(opts.db);
  const adapter = opts.adapter ?? defaultAdapter();
  const { body } = await loadCarousel(ctx, id, db);
  const slideNumber = assertSlideIndex(index, body.slides.length);
  if (!adapter.getSlidePng) throw new NotFoundError("Slide PNG not found");
  return adapter.getSlidePng(body.jobId, slideNumber);
}

/**
 * Append a blank slide: kit writes slide_N.json, then we persist the extra
 * slide on the content item and append a revision.
 */
export function addCarouselBlankSlide(
  ctx: ServiceContext,
  id: string,
  opts: CarouselServiceOptions = {}
): Promise<{ item: any; revision: any; slideNumber: number; slide: CarouselSlideData }> {
  return observeCall(
    {
      kind: "carousel",
      operation: "carousel.slide.add",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      metadata: { contentItemId: id },
      enrich: {
        success: (result) => ({ slideNumber: (result as { slideNumber: number }).slideNumber }),
        failure: (err) => ({ error: normalizeObservedError(err) }),
      },
    },
    () => addCarouselBlankSlideInner(ctx, id, opts)
  );
}

async function addCarouselBlankSlideInner(
  ctx: ServiceContext,
  id: string,
  opts: CarouselServiceOptions = {}
): Promise<{ item: any; revision: any; slideNumber: number; slide: CarouselSlideData }> {
  const db = withDb(opts.db);
  const adapter = opts.adapter ?? defaultAdapter();
  const { body } = await loadCarousel(ctx, id, db);

  if (body.slides.length >= MAX_CAROUSEL_SLIDES) {
    throw new ValidationError(`Maximum ${MAX_CAROUSEL_SLIDES} slides reached`);
  }
  if (!adapter.addBlankSlide) throw new ValidationError("Add blank slide is not available");

  const result = await adapter.addBlankSlide(body.jobId);
  const slide: CarouselSlideData = {
    title: "New Slide",
    content: "Add your content here",
    doc: result.json,
    savedAt: new Date().toISOString(),
  };
  const nextBodyJson: CarouselBodyJson = { ...body, slides: [...body.slides, slide] };

  const revision = await createRevision(
    ctx,
    id,
    { bodyJson: nextBodyJson, changeNote: `Blank slide ${result.slideNumber} added` },
    db
  );
  const item = await getContentItem(ctx, id, db);
  return { item, revision, slideNumber: result.slideNumber, slide };
}

/** AI-edit the existing kit cover.png. Does not invent a cover if none exists. */
export function editCarouselCover(
  ctx: ServiceContext,
  id: string,
  description: unknown,
  opts: CarouselServiceOptions = {}
): Promise<{ item: any; coverImagePath: string; updatedAt: string }> {
  return observeCall(
    {
      kind: "carousel",
      operation: "carousel.cover.edit",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      metadata: { contentItemId: id },
      enrich: {
        success: (result) => ({ coverImagePath: (result as { coverImagePath: string }).coverImagePath }),
        failure: (err) => ({ error: normalizeObservedError(err) }),
      },
    },
    () => editCarouselCoverInner(ctx, id, description, opts)
  );
}

async function editCarouselCoverInner(
  ctx: ServiceContext,
  id: string,
  description: unknown,
  opts: CarouselServiceOptions = {}
): Promise<{ item: any; coverImagePath: string; updatedAt: string }> {
  const db = withDb(opts.db);
  const adapter = opts.adapter ?? defaultAdapter();
  const { item, body } = await loadCarousel(ctx, id, db);

  const parsed = editCoverBodySchema.safeParse({ description });
  if (!parsed.success) throw new ValidationError("Validation failed", parsed.error.flatten());
  if (!adapter.editCover) throw new ValidationError("Cover edit is not available");

  const result = await adapter.editCover(body.jobId, parsed.data.description);
  return { item, coverImagePath: result.coverImagePath, updatedAt: result.updatedAt };
}
