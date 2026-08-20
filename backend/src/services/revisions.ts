/**
 * Revision service — tenant-scoped list/create/restore for content items.
 *
 * Revisions are immutable append-only history:
 *   - `createRevision` snapshots the item's current state under the next
 *     revision number (optionally replacing the working copy first).
 *   - `restoreRevision` copies a historical snapshot onto the content item
 *     AND appends a NEW revision (history is preserved, never rewritten).
 * All queries are tenant-scoped via ctx.tenantId; revision access is only
 * reachable through a content item that exists in the tenant.
 */
import { and, desc, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { createRevisionSchema } from "../api/validation/schemas.js";
import { contentItemRevisions, contentItems } from "../db/schema.js";
import { db as defaultDb } from "../lib/db.js";
import { getContentItem } from "./content.js";
import { NotFoundError, ValidationError } from "./errors.js";
import type { ServiceContext } from "./types.js";

type Db = Pick<PgDatabase<any, any, any>, "select" | "insert" | "update" | "delete">;

export interface RevisionInput {
  title?: string;
  bodyText?: string | null;
  bodyJson?: unknown;
  changeNote?: string;
}

function parseRevision(input: unknown): RevisionInput {
  const parsed = createRevisionSchema.safeParse(input ?? {});
  if (!parsed.success) throw new ValidationError("Validation failed", parsed.error.flatten());
  return parsed.data;
}

function withDb(db?: Db) {
  return (db as any) ?? defaultDb;
}

export async function listRevisions(
  ctx: ServiceContext,
  contentItemId: string,
  db?: Db
): Promise<any[]> {
  const d = withDb(db);
  // Existence + tenant scope gate: the item must belong to the tenant.
  await getContentItem(ctx, contentItemId, d);
  return d
    .select()
    .from(contentItemRevisions)
    .where(
      and(
        eq(contentItemRevisions.contentItemId, contentItemId),
        eq(contentItemRevisions.tenantId, ctx.tenantId)
      )
    )
    .orderBy(desc(contentItemRevisions.revisionNumber));
}

async function nextRevisionNumber(
  d: any,
  contentItemId: string,
  tenantId: string
): Promise<number> {
  const rows = await d
    .select({ n: contentItemRevisions.revisionNumber })
    .from(contentItemRevisions)
    .where(
      and(
        eq(contentItemRevisions.contentItemId, contentItemId),
        eq(contentItemRevisions.tenantId, tenantId)
      )
    );
  return rows.reduce((max: number, r: any) => Math.max(max, r.n), 0) + 1;
}

/**
 * Snapshot the item's CURRENT state under the next revision number. When the
 * input carries title/bodyText/bodyJson, the item's working copy is updated
 * first so the snapshot reflects the new state.
 */
export async function createRevision(
  ctx: ServiceContext,
  contentItemId: string,
  input: unknown = {},
  db?: Db
): Promise<any> {
  const d = withDb(db);
  const data = parseRevision(input);
  const item = await getContentItem(ctx, contentItemId, d);

  const workingTitle = data.title ?? item.title;
  const workingBodyText = data.bodyText !== undefined ? data.bodyText : item.bodyText;
  const workingBodyJson = data.bodyJson !== undefined ? data.bodyJson : item.bodyJson;

  const rev = await d.transaction(async (tx: any) => {
    if (data.title !== undefined || data.bodyText !== undefined || data.bodyJson !== undefined) {
      const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: ctx.userId };
      if (data.title !== undefined) set.title = workingTitle;
      if (data.bodyText !== undefined) set.bodyText = workingBodyText;
      if (data.bodyJson !== undefined) set.bodyJson = workingBodyJson;
      await tx
        .update(contentItems)
        .set(set)
        .where(and(eq(contentItems.id, contentItemId), eq(contentItems.tenantId, ctx.tenantId)));
    }

    const number = await nextRevisionNumber(tx, contentItemId, ctx.tenantId);
    const [created] = await tx
      .insert(contentItemRevisions)
      .values({
        contentItemId,
        tenantId: ctx.tenantId,
        revisionNumber: number,
        title: workingTitle,
        bodyText: workingBodyText,
        bodyJson: workingBodyJson,
        changeNote: data.changeNote ?? null,
        createdBy: ctx.userId,
      })
      .returning();

    // Advance the current-revision pointer to the appended snapshot.
    await tx
      .update(contentItems)
      .set({ currentRevisionNumber: number, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(contentItems.id, contentItemId), eq(contentItems.tenantId, ctx.tenantId)));

    return created;
  });

  return rev;
}

/**
 * Restore a historical revision onto the content item. The restored snapshot
 * becomes the working copy AND a new revision is appended, so the full
 * history (including the old revision) is preserved.
 */
export async function restoreRevision(
  ctx: ServiceContext,
  contentItemId: string,
  revisionId: string,
  db?: Db
): Promise<{ item: any; revision: any }> {
  const d = withDb(db);
  // Existence + tenant scope gate.
  await getContentItem(ctx, contentItemId, d);

  const [revision] = await d
    .select()
    .from(contentItemRevisions)
    .where(
      and(
        eq(contentItemRevisions.id, revisionId),
        eq(contentItemRevisions.contentItemId, contentItemId),
        eq(contentItemRevisions.tenantId, ctx.tenantId)
      )
    )
    .limit(1);
  if (!revision) throw new NotFoundError("Revision not found");

  const result = await d.transaction(async (tx: any) => {
    const number = await nextRevisionNumber(tx, contentItemId, ctx.tenantId);
    const [rev] = await tx
      .insert(contentItemRevisions)
      .values({
        contentItemId,
        tenantId: ctx.tenantId,
        revisionNumber: number,
        title: revision.title,
        bodyText: revision.bodyText,
        bodyJson: revision.bodyJson,
        changeNote: `Restored from revision #${revision.revisionNumber}`,
        createdBy: ctx.userId,
      })
      .returning();

    // The restored snapshot becomes the working copy AND the current
    // revision pointer — one update so the returned row is fresh.
    const [item] = await tx
      .update(contentItems)
      .set({
        title: revision.title,
        bodyText: revision.bodyText,
        bodyJson: revision.bodyJson,
        currentRevisionNumber: number,
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      })
      .where(and(eq(contentItems.id, contentItemId), eq(contentItems.tenantId, ctx.tenantId)))
      .returning();

    return { item, revision: rev };
  });

  return result;
}
