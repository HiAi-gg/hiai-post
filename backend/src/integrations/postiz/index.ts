/**
 * Postiz integration boundary (server-side) — typed publication-intent
 * submission / status-sync ONLY.
 *
 * Scope of this boundary:
 *   - typed contracts (schemas.ts) for the generic metadata the product cares
 *     about: externalProvider / externalItemId / scheduledAt / status / url /
 *     error;
 *   - a minimal HTTP client (client.ts) with Bearer auth, bounded timeout,
 *     correlation ids and normalized errors;
 *   - config + env docs (config.ts, .env.example).
 *
 * Explicitly OUT of scope (documented so nobody assumes otherwise):
 *   - NOT wired into any publishing flow and NOT backed by a queue;
 *   - does NOT repair or replace the pre-existing native platform adapters —
 *     those remain the current publishing owners (marked deprecated/replaced
 *     in docs/ARCHITECTURE.md);
 *   - does NOT claim live Postiz works without configured credentials — when
 *     unconfigured the client throws NOT_CONFIGURED (503).
 *
 * This module mirrors the hiai-kit boundary conventions (centralized client,
 * injectable config, normalized errors, secrets never logged).
 */
export { createPostizClient, type PostizClient, type PostizSubmitResult } from "./client.js";
export { type PostizConfig, postizConfig, postizConfigSummary } from "./config.js";
export { PostizError, type PostizErrorCode, toPostizErrorEnvelope } from "./errors.js";
export {
  type PostizPublishIntent,
  type PostizStatus,
  type PostizStatusRecord,
  postizPublishIntentSchema,
  postizStatusRecordSchema,
  postizStatusSchema,
} from "./schemas.js";
