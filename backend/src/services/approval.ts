/**
 * Approval service — explicit approval state machine for content items.
 *
 * States:      draft → in_review → approved (terminal)
 *                     ↕
 *                 changes_requested
 *
 * Transitions (enforced by `TRANSITIONS`; anything else → 409
 * INVALID_TRANSITION):
 *   draft             --submit_review-->  in_review
 *   changes_requested --submit_review-->  in_review
 *   in_review         --approve-------->  approved
 *   in_review         --request_changes-> changes_requested
 *
 * RBAC is enforced at the route layer (approve = admin+; submit_review /
 * request_changes = editor+). This service only enforces state validity and
 * tenant scope.
 */
import { and, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { z } from "zod";
import { type ContentItemStatus, contentItems } from "../db/schema.js";
import { db as defaultDb } from "../lib/db.js";
import { observeCall } from "../lib/observe.js";
import { getContentItem } from "./content.js";
import { ConflictError, ValidationError } from "./errors.js";
import type { ServiceContext } from "./types.js";

type Db = Pick<PgDatabase<any, any, any>, "select" | "insert" | "update" | "delete">;

type Action = "submit_review" | "approve" | "request_changes";

const reviewNoteSchema = z.string().min(1).max(2000);

function parseNote(note: unknown): string {
  const parsed = reviewNoteSchema.safeParse(note);
  if (!parsed.success) throw new ValidationError("Validation failed", parsed.error.flatten());
  return parsed.data;
}

const TRANSITIONS: Record<ContentItemStatus, Partial<Record<Action, ContentItemStatus>>> = {
  draft: { submit_review: "in_review" },
  in_review: { approve: "approved", request_changes: "changes_requested" },
  changes_requested: { submit_review: "in_review" },
  approved: {}, // terminal — an approved item cannot move again.
};

function withDb(db?: Db) {
  return (db as any) ?? defaultDb;
}

async function transition(
  ctx: ServiceContext,
  contentItemId: string,
  action: Action,
  extra: Record<string, unknown> = {},
  db?: Db
): Promise<any> {
  // Wrapped with observeCall: emits `content.<action>` (e.g. content.approve)
  // start/success/failure events to hiai-observe (no-op when unconfigured;
  // never alters behavior, including invalid-transition 409s).
  return observeCall(
    {
      kind: "content",
      operation: `content.${action}`,
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      metadata: { contentItemId, action },
      enrich: {
        success: (result) => {
          const row = result as { id?: string; status?: string };
          return { contentItemId: row.id ?? contentItemId, toStatus: row.status ?? "" };
        },
        failure: (err) => {
          const code = (err as { code?: unknown })?.code;
          return {
            contentItemId,
            error: typeof code === "string" && code.length > 0 ? code : "INTERNAL",
          };
        },
      },
    },
    () => transitionInner(ctx, contentItemId, action, extra, db)
  );
}

async function transitionInner(
  ctx: ServiceContext,
  contentItemId: string,
  action: Action,
  extra: Record<string, unknown> = {},
  db?: Db
): Promise<any> {
  const d = withDb(db);
  const item = await getContentItem(ctx, contentItemId, d);
  const status = item.status as ContentItemStatus;

  const next = TRANSITIONS[status]?.[action];
  if (!next) {
    throw new ConflictError(`Cannot '${action}' from status '${status}'`, "INVALID_TRANSITION");
  }

  const [updated] = await d
    .update(contentItems)
    .set({
      status: next,
      updatedBy: ctx.userId,
      updatedAt: new Date(),
      ...extra,
    })
    .where(and(eq(contentItems.id, contentItemId), eq(contentItems.tenantId, ctx.tenantId)))
    .returning();
  return updated;
}

/** draft | changes_requested → in_review */
export function submitForReview(ctx: ServiceContext, contentItemId: string, db?: Db) {
  return transition(ctx, contentItemId, "submit_review", {}, db);
}

/** in_review → approved (clears any outstanding review note). */
export function approveContent(ctx: ServiceContext, contentItemId: string, db?: Db) {
  return transition(ctx, contentItemId, "approve", { reviewNote: null }, db);
}

/** in_review → changes_requested (records reviewer feedback). */
export function requestChanges(ctx: ServiceContext, contentItemId: string, note: unknown, db?: Db) {
  return transition(ctx, contentItemId, "request_changes", { reviewNote: parseNote(note) }, db);
}
