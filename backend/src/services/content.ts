/**
 * Content item service — tenant-scoped create/list/get for the shared
 * product foundation.
 *
 * Creating an item always snapshots revision #1 so history exists from the
 * start, and records the acting surface as `source` (web/api/chatgpt/…)
 * plus the `currentRevisionNumber` pointer (1). All queries filter on
 * ctx.tenantId; projectId/brandId from input are validated to exist within
 * the tenant (cross-tenant references are a 400 VALIDATION error). Revision
 * and approval operations live in services/revisions.ts and
 * services/approval.ts.
 */
import { and, count, desc, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { createContentItemSchema } from "../api/validation/schemas.js";
import { type ContentSource, contentItemRevisions, contentItems } from "../db/schema.js";
import { db as defaultDb } from "../lib/db.js";
import { observeCall } from "../lib/observe.js";
import { NotFoundError, ValidationError } from "./errors.js";
import { assertBrandInTenant, assertProjectInTenant } from "./projects.js";
import type { Paginated, PaginationInput, ServiceContext } from "./types.js";

type Db = Pick<PgDatabase<any, any, any>, "select" | "insert" | "update" | "delete">;

export type { ContentSource };

export interface ContentItemInput {
  projectId?: string;
  brandId?: string;
  title: string;
  bodyText?: string | null;
  bodyJson?: unknown;
  /** Creation source; defaults to "web". Never trusted from client input. */
  source?: ContentSource;
}

function parseContentItem(input: unknown): ContentItemInput {
  const parsed = createContentItemSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Validation failed", parsed.error.flatten());
  return parsed.data;
}

function withDb(db?: Db) {
  return (db as any) ?? defaultDb;
}

/** Short error label for telemetry metadata (codes only, never messages). */
function normalizeObservedError(err: unknown): string {
  if (err instanceof ValidationError || err instanceof NotFoundError) return err.code;
  const code = (err as { code?: unknown })?.code;
  return typeof code === "string" && code.length > 0 ? code : "INTERNAL";
}

/**
 * Derive the truthful creation source for a request principal:
 *   - session principals (interactive web UI) → "web"
 *   - machine principals (admin JWT bridge / hpk_ API key) → "api"
 * MCP tool calls pass "chatgpt" explicitly (see api/mcp/tools.ts).
 */
export function contentSourceForContext(ctx: { auth?: { source?: string } }): ContentSource {
  return ctx.auth?.source === "session" ? "web" : "api";
}

export interface ListContentInput extends PaginationInput {
  status?: "draft" | "in_review" | "approved" | "changes_requested";
  projectId?: string;
  brandId?: string;
}

export async function listContentItems(
  ctx: ServiceContext,
  input: ListContentInput,
  db?: Db
): Promise<Paginated<any>> {
  const d = withDb(db);
  const { page, limit } = input;
  const conditions = [eq(contentItems.tenantId, ctx.tenantId)];
  if (input.status) conditions.push(eq(contentItems.status, input.status));
  if (input.projectId) conditions.push(eq(contentItems.projectId, input.projectId));
  if (input.brandId) conditions.push(eq(contentItems.brandId, input.brandId));
  const where = and(...conditions);

  const [{ total }] = await d.select({ total: count() }).from(contentItems).where(where);

  const data = await d
    .select()
    .from(contentItems)
    .where(where)
    .orderBy(desc(contentItems.updatedAt))
    .limit(limit)
    .offset((page - 1) * limit);

  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

/**
 * Create a content item plus its initial revision (revision #1) atomically.
 * projectId/brandId are optional but, when provided, must exist in the
 * tenant — never in a foreign tenant. `source` defaults to "web"; the
 * routes/MCP tools override it with the truthful acting surface.
 *
 * Wrapped with observeCall: emits `content.create` start/success/failure
 * events to hiai-observe (no-op when unconfigured; never alters behavior).
 */
export function createContentItem(ctx: ServiceContext, input: unknown, db?: Db): Promise<any> {
  return observeCall(
    {
      kind: "content",
      operation: "content.create",
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      enrich: {
        success: (result) => {
          const item = result as { id?: string; status?: string; source?: string };
          return {
            contentItemId: item.id ?? "",
            status: item.status ?? "",
            source: item.source ?? "",
          };
        },
        failure: (err) => ({ error: normalizeObservedError(err) }),
      },
    },
    () => createContentItemInner(ctx, input, db)
  );
}

async function createContentItemInner(ctx: ServiceContext, input: unknown, db?: Db): Promise<any> {
  const d = withDb(db);
  const data = parseContentItem(input);

  if (data.projectId) await assertProjectInTenant(ctx, data.projectId, d);
  if (data.brandId) await assertBrandInTenant(ctx, data.brandId, d);

  const item = await d.transaction(async (tx: any) => {
    const [created] = await tx
      .insert(contentItems)
      .values({
        tenantId: ctx.tenantId,
        projectId: data.projectId ?? null,
        brandId: data.brandId ?? null,
        title: data.title,
        bodyText: data.bodyText ?? null,
        bodyJson: data.bodyJson ?? null,
        source: data.source ?? "web",
        currentRevisionNumber: 1,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();

    await tx.insert(contentItemRevisions).values({
      contentItemId: created.id,
      tenantId: ctx.tenantId,
      revisionNumber: 1,
      title: created.title,
      bodyText: created.bodyText,
      bodyJson: created.bodyJson,
      changeNote: "Initial version",
      createdBy: ctx.userId,
    });

    return created;
  });

  return item;
}

export async function getContentItem(ctx: ServiceContext, id: string, db?: Db): Promise<any> {
  const d = withDb(db);
  const [item] = await d
    .select()
    .from(contentItems)
    .where(and(eq(contentItems.id, id), eq(contentItems.tenantId, ctx.tenantId)))
    .limit(1);
  if (!item) throw new NotFoundError("Content item not found");
  return item;
}
