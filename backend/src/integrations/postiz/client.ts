/**
 * Postiz integration boundary — minimal typed HTTP client.
 *
 * BOUNDARY ONLY. This module is not wired into publishing, does not create a
 * queue, and does NOT claim live Postiz works without configured credentials.
 * It exists so future publication work has a single typed, sanitized, tested
 * path to a Postiz-style backend:
 *
 *   - `submitPublication(intent)` — POST the publication intent
 *     (`POST /api/v1/publications`), expecting a 2xx `{ ok: true }`.
 *   - `syncStatus(record)` — report current intent status
 *     (`POST /api/v1/publications/status`), expecting a 2xx `{ ok: true }`.
 *
 * Contract notes (documented honestly):
 *   - Endpoint paths above are this boundary's expectation; verify them
 *     against your actual Postiz deployment before enabling live use.
 *   - Auth: `Authorization: Bearer <POSTIZ_API_KEY>`.
 *   - Every request carries a generated `correlationId` as `x-trace-id`.
 *   - Failures normalize to `PostizError` (NOT_CONFIGURED / TIMEOUT /
 *     VALIDATION_ERROR / POSTIZ_ERROR) — never a fabricated success.
 *   - Errors never include raw request/response bodies or secrets.
 */
import { randomUUID } from "node:crypto";
import { observeCall } from "../../lib/observe.js";
import { type PostizConfig, postizConfig } from "./config.js";
import { PostizError } from "./errors.js";
import {
  type PostizPublishIntent,
  type PostizStatusRecord,
  postizPublishIntentSchema,
  postizStatusRecordSchema,
} from "./schemas.js";

export interface PostizSubmitResult {
  accepted: boolean;
  correlationId: string;
}

export interface PostizClient {
  submitPublication(intent: PostizPublishIntent): Promise<PostizSubmitResult>;
  syncStatus(record: PostizStatusRecord): Promise<{ correlationId: string }>;
}

const PUBLICATIONS_PATH = "/api/v1/publications";
const STATUS_PATH = "/api/v1/publications/status";

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function postizPost<TBody extends PostizPublishIntent | PostizStatusRecord>(
  config: PostizConfig,
  path: string,
  body: TBody
): Promise<PostizSubmitResult> {
  if (!config.enabled) {
    // Honest failure: no credentials → no live Postiz, ever.
    throw new PostizError(
      "NOT_CONFIGURED",
      "Postiz is not configured (POSTIZ_API_URL / POSTIZ_API_KEY) — live publication is unavailable",
      503
    );
  }

  const correlationId = randomUUID();
  let response: Response;
  try {
    response = await fetch(`${config.url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "x-trace-id": correlationId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new PostizError(
        "TIMEOUT",
        `Postiz request timed out after ${config.timeoutMs}ms`,
        504,
        { correlationId, path, timeoutMs: config.timeoutMs }
      );
    }
    throw new PostizError("POSTIZ_ERROR", `Postiz request failed: ${errorMessage(error)}`, 502, {
      correlationId,
      path,
    });
  }

  if (!response.ok) {
    throw new PostizError(
      "POSTIZ_ERROR",
      `Postiz returned HTTP ${response.status}`,
      response.status,
      { correlationId, path, status: response.status }
    );
  }

  return { accepted: true, correlationId };
}

/** Short error label for telemetry metadata (codes only, never messages). */
function normalizePostizError(err: unknown): string {
  const code = (err as { code?: unknown })?.code;
  return typeof code === "string" && code.length > 0 ? code : "INTERNAL";
}

/**
 * Create the Postiz client. Uses the env-derived config by default; pass an
 * explicit config in tests. When unconfigured, BOTH methods throw
 * `NOT_CONFIGURED` (503) — there is no silent no-op that fakes a submission.
 *
 * Both methods are wrapped with observeCall: they emit `postiz.submit` /
 * `postiz.status_sync` start/success/failure events to hiai-observe (no-op
 * when unconfigured; never alters behavior).
 */
export function createPostizClient(config: PostizConfig = postizConfig()): PostizClient {
  return {
    async submitPublication(intent: PostizPublishIntent): Promise<PostizSubmitResult> {
      return observeCall(
        {
          kind: "postiz",
          operation: "postiz.submit",
          metadata: {
            externalProvider: intent?.externalProvider ?? "",
            externalItemId: intent?.externalItemId ?? "",
          },
          enrich: {
            success: (result) => {
              const r = result as PostizSubmitResult;
              return { accepted: r.accepted, correlationId: r.correlationId };
            },
            failure: (err) => ({
              error: normalizePostizError(err),
              externalProvider: intent?.externalProvider ?? "",
              externalItemId: intent?.externalItemId ?? "",
            }),
          },
        },
        async () => {
          const parsed = postizPublishIntentSchema.safeParse(intent);
          if (!parsed.success) {
            throw new PostizError("VALIDATION_ERROR", "Publication intent failed validation", 400, {
              correlationId: randomUUID(),
            });
          }
          return postizPost(config, PUBLICATIONS_PATH, parsed.data);
        }
      );
    },
    async syncStatus(record: PostizStatusRecord): Promise<{ correlationId: string }> {
      return observeCall(
        {
          kind: "postiz",
          operation: "postiz.status_sync",
          metadata: {
            externalProvider: record?.externalProvider ?? "",
            externalItemId: record?.externalItemId ?? "",
          },
          enrich: {
            success: (result) => ({
              correlationId: (result as { correlationId: string }).correlationId,
            }),
            failure: (err) => ({
              error: normalizePostizError(err),
              externalProvider: record?.externalProvider ?? "",
              externalItemId: record?.externalItemId ?? "",
            }),
          },
        },
        async () => {
          const parsed = postizStatusRecordSchema.safeParse(record);
          if (!parsed.success) {
            throw new PostizError("VALIDATION_ERROR", "Status record failed validation", 400, {
              correlationId: randomUUID(),
            });
          }
          return postizPost(config, STATUS_PATH, parsed.data);
        }
      );
    },
  };
}
