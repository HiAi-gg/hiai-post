/**
 * Writer application service — AI content generation for the shared product
 * foundation.
 *
 * Composes the existing capability boundary with the existing persistence
 * services:
 *
 *   - `article`     → hiai-kit `content.article` capability (the peer
 *                     capability API via `integrations/hiai-kit`). This is
 *                     the primary path; when hiai-kit is unavailable or not
 *                     configured the normalized `HiaiKitError` is surfaced
 *                     (502 with a correlation id) — never silently degraded.
 *   - `social_post` → a TEMPORARY local adapter over the existing mastra
 *                     `content-generate` workflow (the pre-existing "local
 *                     writer capability"). hiai-kit has no `content.post`
 *                     capability yet, so this fallback is explicit and
 *                     documented — it will be replaced once the peer ships
 *                     `content.post`. No new agent framework is introduced.
 *
 * Persistence reuses the Phase 3 services:
 *   - generate → `createContentItem` (always snapshots revision #1);
 *   - rewrite  → `createRevision` (append-only — prior revisions are
 *     preserved, never rewritten).
 *
 * Tenant scope comes exclusively from `ctx.tenantId`; project/brand ids from
 * request input are validated to exist WITHIN the tenant via the existing
 * project service guards (cross-tenant references are 400 VALIDATION, other
 * tenants' items are 404 NOT_FOUND).
 *
 * The external capability boundary (`hiaiKit` / `socialWriter`) is
 * injectable so unit tests exercise the service with fakes and route tests
 * mock at the module boundary.
 */
import { randomUUID } from "node:crypto";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { ContentSource } from "../db/schema.js";
import {
  HiaiKitError,
  type HiaiKitErrorEnvelope,
  toHiaiKitErrorEnvelope,
} from "../integrations/hiai-kit/errors.js";
import {
  type ArticleOutput,
  type CapabilityClient,
  createHiaiKitClient,
} from "../integrations/hiai-kit/index.js";
import { db as defaultDb } from "../lib/db.js";
import { observeCall } from "../lib/observe.js";
import { createContentItem, getContentItem } from "./content.js";
import { DomainError, type ErrorEnvelope, toErrorEnvelope, ValidationError } from "./errors.js";
import { assertBrandInTenant, assertProjectInTenant, getBrand, getProject } from "./projects.js";
import { createRevision, listRevisions } from "./revisions.js";
import type { ServiceContext } from "./types.js";

type Db = Pick<PgDatabase<any, any, any>, "select" | "insert" | "update" | "delete">;

// ---------------------------------------------------------------------------
// Runtime-validated contracts (zod in-service, mirroring the other services)
// ---------------------------------------------------------------------------

export const writerContentTypeSchema = z.enum(["social_post", "article"]);
export type WriterContentType = z.infer<typeof writerContentTypeSchema>;

export const writerGenerateSchema = z.object({
  projectId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  contentType: writerContentTypeSchema,
  topic: z.string().min(1).max(500),
  language: z.string().min(2).max(10).default("en"),
  tone: z.string().max(100).optional(),
  instruction: z.string().max(2000).optional(),
  context: z.string().max(5000).optional(),
});
export type WriterGenerateInput = z.infer<typeof writerGenerateSchema>;

export const writerRewriteSchema = z.object({
  contentItemId: z.string().uuid(),
  /** Optional topic override; defaults to the item's current title. */
  topic: z.string().min(1).max(500).optional(),
  instruction: z.string().min(1).max(2000),
  language: z.string().min(2).max(10).default("en"),
  tone: z.string().max(100).optional(),
  context: z.string().max(5000).optional(),
});
export type WriterRewriteInput = z.infer<typeof writerRewriteSchema>;

// ---------------------------------------------------------------------------
// External capability boundary (injectable for tests)
// ---------------------------------------------------------------------------

export interface WriterGeneration {
  title: string;
  bodyText: string | null;
  /** JSON-safe metadata persisted into `content_items.body_json`. */
  bodyJson?: unknown;
  /** Machine-readable backend label, e.g. "hiai-kit:content.article". */
  backend: string;
  /** Run trace id from hiai-kit, or a generated id for the local fallback. */
  correlationId?: string;
}

export interface SocialPostGenerationInput {
  topic: string;
  tone?: string;
  language?: string;
  instruction?: string;
  context?: string;
}

/** Port for the local social-post writer (see services/writer-local.ts). */
export type SocialWriterPort = (input: SocialPostGenerationInput) => Promise<WriterGeneration>;

export interface WriterDeps {
  db?: Db;
  hiaiKit?: Pick<CapabilityClient, "contentArticle">;
  socialWriter?: SocialWriterPort;
  /**
   * Truthful creation source for the persisted item (web/api/chatgpt/…).
   * Routes derive it from the principal; MCP tools pass "chatgpt". Defaults
   * to "web" in the content service when omitted.
   */
  source?: ContentSource;
}

interface ResolvedDeps {
  db: Db;
  hiaiKit: Pick<CapabilityClient, "contentArticle">;
  socialWriter: SocialWriterPort;
}

const ARTICLE_PATH = "/api/v1/capabilities/content.article/run";

const ARTICLE_TONES = ["neutral", "executive", "technical", "creative"] as const;
type ArticleTone = (typeof ARTICLE_TONES)[number];

/** Free-form writer tone → hiai-kit `content.article` tone enum (default neutral). */
function mapArticleTone(tone: string | undefined): ArticleTone {
  if (tone && (ARTICLE_TONES as readonly string[]).includes(tone)) {
    return tone as ArticleTone;
  }
  return "neutral";
}

/**
 * Default backend assembly. The local mastra adapter is lazy-imported so
 * service unit tests never evaluate `@mastra/core` unless they exercise the
 * social_post path (which they don't — they inject a fake port).
 */
async function resolveDeps(deps: WriterDeps = {}): Promise<ResolvedDeps> {
  const db = deps.db ?? (defaultDb as Db);
  const hiaiKit = deps.hiaiKit ?? createHiaiKitClient().capabilities;
  const socialWriter =
    deps.socialWriter ?? (await import("./writer-local.js")).localMastraSocialWriter;
  return { db, hiaiKit, socialWriter };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Short error label for telemetry metadata (codes only, never messages). */
function normalizeObservedError(err: unknown): string {
  if (err instanceof DomainError) return err.code;
  if (err instanceof HiaiKitError) return err.code;
  return "INTERNAL";
}

/**
 * hiai-kit `content.article` path. The typed client already validates the
 * output contract; a failed run (200 with `status: "failed"`) is normalized
 * to a HiaiKitError carrying the run's trace id as its correlation id.
 */
async function generateArticle(
  input: { topic: string; tone?: string },
  client: Pick<CapabilityClient, "contentArticle">
): Promise<WriterGeneration> {
  let result;
  try {
    result = await client.contentArticle({
      topic: input.topic,
      outcome: "draft",
      tone: mapArticleTone(input.tone),
    });
  } catch (err) {
    if (err instanceof HiaiKitError) throw err;
    throw new HiaiKitError(
      "HIAI_KIT_ERROR",
      `content.article request failed: ${messageOf(err)}`,
      502,
      {
        path: ARTICLE_PATH,
      }
    );
  }
  if (result.status === "failed") {
    const detail =
      result.errors.map((e: { message: string }) => e.message).join("; ") || "no details";
    throw new HiaiKitError("HIAI_KIT_ERROR", `content.article run failed: ${detail}`, 502, {
      correlationId: result.runId,
      path: ARTICLE_PATH,
    });
  }
  const output = result.output as ArticleOutput | null;
  return {
    title: input.topic,
    bodyText: output?.formatted ?? null,
    bodyJson: {
      intent: output?.intent ?? "article",
      artifact: output?.artifact ?? null,
      generatedAt: output?.generatedAt ?? null,
    },
    backend: "hiai-kit:content.article",
    correlationId: result.runId,
  };
}

/**
 * Resolve project/brand context through the existing services and fold it
 * into the prompt. Covers the full brand context: description,
 * defaultLanguage, targetAudience, tone/voice, contentGuidelines,
 * business/product context and optional references.
 */
async function resolveContext(
  ctx: ServiceContext,
  input: { projectId?: string; brandId?: string; context?: string },
  db: Db
): Promise<string | undefined> {
  const parts: string[] = [];
  if (input.context) parts.push(input.context);
  if (input.projectId) {
    const project = await getProject(ctx, input.projectId, db);
    if (project.name) parts.push(`Project: ${project.name}`);
    if (project.description) parts.push(`Project description: ${project.description}`);
    if (project.defaultLanguage) parts.push(`Project default language: ${project.defaultLanguage}`);
    if (project.targetAudience) parts.push(`Project target audience: ${project.targetAudience}`);
    if (project.tone) parts.push(`Project tone: ${project.tone}`);
    if (project.contentGuidelines)
      parts.push(`Project content guidelines: ${project.contentGuidelines}`);
    if (project.businessContext) parts.push(`Project business context: ${project.businessContext}`);
    const references = formatReferences(project.references);
    if (references) parts.push(`Project references: ${references}`);
  }
  if (input.brandId) {
    const brand = await getBrand(ctx, input.brandId, {}, db);
    if (brand.name) parts.push(`Brand: ${brand.name}`);
    if (brand.voice) parts.push(`Brand voice: ${brand.voice}`);
    if (brand.description) parts.push(`Brand description: ${brand.description}`);
    if (brand.defaultLanguage) parts.push(`Brand default language: ${brand.defaultLanguage}`);
    if (brand.targetAudience) parts.push(`Brand target audience: ${brand.targetAudience}`);
    if (brand.contentGuidelines) parts.push(`Brand content guidelines: ${brand.contentGuidelines}`);
    if (brand.businessContext) parts.push(`Brand business context: ${brand.businessContext}`);
    const references = formatReferences(brand.references);
    if (references) parts.push(`Brand references: ${references}`);
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

/** Render the `references` jsonb array (title (type): url) into prompt text. */
function formatReferences(references: unknown): string | undefined {
  if (!Array.isArray(references) || references.length === 0) return undefined;
  return references
    .map((ref) => {
      const r = ref as { type?: string; url?: string; title?: string };
      const label = r.title ?? r.url ?? "reference";
      return r.url ? `${label} (${r.type ?? "link"}): ${r.url}` : label;
    })
    .join("; ");
}

function contentBodyJson(
  generation: WriterGeneration,
  contentType: WriterContentType,
  tone: string | undefined
): Record<string, unknown> {
  return {
    ...(generation.bodyJson && typeof generation.bodyJson === "object"
      ? (generation.bodyJson as Record<string, unknown>)
      : {}),
    contentType,
    tone: tone ?? null,
    backend: generation.backend,
    correlationId: generation.correlationId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------

export interface WriterResult {
  item: any;
  revision: any;
  /** Machine-readable backend label ("hiai-kit:content.article" | "local:content-generate"). */
  backend: string;
  /** Run trace id (hiai-kit) or generated id (local fallback). */
  correlationId?: string;
}

/**
 * Generate a new content item. Creates the item AND its initial revision
 * atomically (via the existing content service). `contentType` selects the
 * backend: article → hiai-kit, social_post → local fallback adapter.
 *
 * Wrapped with observeCall: emits `writer.generate` start/success/failure
 * events to hiai-observe (no-op when unconfigured; never alters behavior).
 */
export function generateWriterContent(
  ctx: ServiceContext,
  input: unknown,
  deps: WriterDeps = {}
): Promise<WriterResult> {
  return observeCall(
    {
      kind: "writer",
      operation: "writer.generate",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      enrich: {
        success: (result) => {
          const r = result as WriterResult;
          return {
            backend: r.backend,
            runId: r.correlationId ?? "",
            contentType:
              (r.item?.bodyJson as { contentType?: string } | null | undefined)?.contentType ?? "",
          };
        },
        failure: (err) => ({ error: normalizeObservedError(err) }),
      },
    },
    () => generateWriterContentInner(ctx, input, deps)
  );
}

async function generateWriterContentInner(
  ctx: ServiceContext,
  input: unknown,
  deps: WriterDeps = {}
): Promise<WriterResult> {
  const parsed = writerGenerateSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Validation failed", parsed.error.flatten());
  const { db, hiaiKit, socialWriter } = await resolveDeps(deps);

  if (parsed.data.projectId) await assertProjectInTenant(ctx, parsed.data.projectId, db);
  if (parsed.data.brandId) await assertBrandInTenant(ctx, parsed.data.brandId, db);
  const context = await resolveContext(ctx, parsed.data, db);

  const generation =
    parsed.data.contentType === "article"
      ? await generateArticle({ topic: parsed.data.topic, tone: parsed.data.tone }, hiaiKit)
      : await runSocialWriter(
          socialWriter,
          {
            topic: parsed.data.topic,
            tone: parsed.data.tone,
            language: parsed.data.language,
            instruction: parsed.data.instruction,
            context,
          },
          parsed.data.contentType
        );

  const item = await createContentItem(
    ctx,
    {
      projectId: parsed.data.projectId,
      brandId: parsed.data.brandId,
      title: generation.title,
      bodyText: generation.bodyText,
      bodyJson: contentBodyJson(generation, parsed.data.contentType, parsed.data.tone),
      source: deps.source,
    },
    db
  );

  const [revision] = await listRevisions(ctx, item.id, db);
  return {
    item,
    revision,
    backend: generation.backend,
    correlationId: generation.correlationId,
  };
}

/**
 * Rewrite/regenerate an existing content item. The new working copy is
 * persisted via `createRevision` (append-only) — ALL prior revisions are
 * preserved. The content type is derived from the item's stored
 * `bodyJson.contentType` (defaults to article for legacy items).
 *
 * Wrapped with observeCall: emits `writer.rewrite` start/success/failure
 * events to hiai-observe (no-op when unconfigured; never alters behavior).
 */
export function rewriteWriterContent(
  ctx: ServiceContext,
  input: unknown,
  deps: WriterDeps = {}
): Promise<WriterResult> {
  return observeCall(
    {
      kind: "writer",
      operation: "writer.rewrite",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      enrich: {
        success: (result) => {
          const r = result as WriterResult;
          return { backend: r.backend, runId: r.correlationId ?? "" };
        },
        failure: (err) => ({ error: normalizeObservedError(err) }),
      },
    },
    () => rewriteWriterContentInner(ctx, input, deps)
  );
}

async function rewriteWriterContentInner(
  ctx: ServiceContext,
  input: unknown,
  deps: WriterDeps = {}
): Promise<WriterResult> {
  const parsed = writerRewriteSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Validation failed", parsed.error.flatten());
  const { db, hiaiKit, socialWriter } = await resolveDeps(deps);

  // Existence + tenant scope gate (404 for other tenants' items).
  const item = await getContentItem(ctx, parsed.data.contentItemId, db);

  const stored = item.bodyJson as { contentType?: unknown; tone?: unknown } | null;
  const contentType: WriterContentType =
    stored?.contentType === "social_post" || stored?.contentType === "article"
      ? stored.contentType
      : "article";
  const tone = parsed.data.tone ?? (typeof stored?.tone === "string" ? stored.tone : undefined);
  const topic = parsed.data.topic ?? item.title;
  const context = await resolveContext(ctx, { context: parsed.data.context }, db);

  const generation =
    contentType === "article"
      ? await generateArticle({ topic, tone }, hiaiKit)
      : await runSocialWriter(
          socialWriter,
          {
            topic,
            tone,
            language: parsed.data.language,
            instruction: parsed.data.instruction,
            context,
          },
          contentType
        );

  const revision = await createRevision(
    ctx,
    parsed.data.contentItemId,
    {
      title: generation.title,
      bodyText: generation.bodyText,
      bodyJson: contentBodyJson(generation, contentType, tone),
      changeNote: `Rewritten: ${parsed.data.instruction.slice(0, 200)}`,
    },
    db
  );

  const updated = await getContentItem(ctx, parsed.data.contentItemId, db);
  return {
    item: updated,
    revision,
    backend: generation.backend,
    correlationId: generation.correlationId,
  };
}

/** Local social-post path with error normalization (INTERNAL → 502 envelope). */
async function runSocialWriter(
  socialWriter: SocialWriterPort,
  input: SocialPostGenerationInput,
  contentType: WriterContentType
): Promise<WriterGeneration> {
  try {
    return await socialWriter(input);
  } catch (err) {
    throw new DomainError(
      "INTERNAL",
      `Local ${contentType} generation failed: ${messageOf(err)}`,
      502,
      { correlationId: randomUUID() }
    );
  }
}

// ---------------------------------------------------------------------------
// Error normalization for route handlers
// ---------------------------------------------------------------------------

export type WriterErrorEnvelope = ErrorEnvelope | HiaiKitErrorEnvelope;

/**
 * Map a thrown value to a response envelope + status, or `undefined` for
 * unknown errors (route rethrows → global handler → 500). DomainErrors map
 * to the shared envelope; HiaiKitErrors carry their correlation id.
 */
export function toWriterErrorEnvelope(
  err: unknown
): { envelope: WriterErrorEnvelope; status: number } | undefined {
  if (err instanceof DomainError) {
    return { envelope: toErrorEnvelope(err), status: err.status };
  }
  const hiaiKit = toHiaiKitErrorEnvelope(err);
  if (hiaiKit) return { envelope: hiaiKit, status: hiaiKit.status };
  return undefined;
}
