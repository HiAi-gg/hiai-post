/**
 * Postiz integration boundary — runtime-validated contracts.
 *
 * These are the GENERIC publication-intent / status-sync metadata fields this
 * boundary owns. They are intentionally provider-agnostic so any Postiz-style
 * backend can be targeted without leaking platform specifics into the product
 * services:
 *
 *   - `externalProvider` — the social platform label (e.g. "instagram", "x");
 *   - `externalItemId`   — the LOCAL content/post identifier the intent refers
 *                          to (not a Postiz-internal id);
 *   - `scheduledAt`      — ISO-8601 publish time;
 *   - `status`           — the intent outcome being recorded;
 *   - `url`              — public permalink when known;
 *   - `error`            — sanitized failure detail (never secrets).
 *
 * NOTE: this is a typed boundary only. Live Postiz operation requires
 * configured credentials AND a real deployment; without them the client
 * reports NOT_CONFIGURED (see client.ts).
 */
import { z } from "zod";

export const postizStatusSchema = z.enum(["scheduled", "published", "failed", "cancelled"]);
export type PostizStatus = z.infer<typeof postizStatusSchema>;

/** Publication intent: a request to schedule content for publishing. */
export const postizPublishIntentSchema = z.object({
  externalProvider: z.string().min(1).max(100),
  externalItemId: z.string().min(1).max(300),
  scheduledAt: z.string().datetime().optional(),
  status: postizStatusSchema,
  url: z.string().url().optional(),
  error: z.string().max(2000).optional(),
});
export type PostizPublishIntent = z.infer<typeof postizPublishIntentSchema>;

/** Status sync record: report the current state of a previously submitted intent. */
export const postizStatusRecordSchema = z.object({
  externalProvider: z.string().min(1).max(100),
  externalItemId: z.string().min(1).max(300),
  scheduledAt: z.string().datetime().optional(),
  status: postizStatusSchema,
  url: z.string().url().optional(),
  error: z.string().max(2000).optional(),
});
export type PostizStatusRecord = z.infer<typeof postizStatusRecordSchema>;
