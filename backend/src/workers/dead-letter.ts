import { and, eq, like } from "drizzle-orm";
import { posts } from "../db/schema.js";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";

const log = logger.child({ module: "dead-letter" });

const PROCESS_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 60_000; // 1 minute
const LEGACY_RETRY_PATTERN = /^retry:\d+:/;
let migrationRan = false;

export function startDeadLetterProcessor(): void {
  log.info("Starting dead-letter queue processor");

  migrateLegacyRetryInfo().catch((err) =>
    log.error({ error: String(err) }, "Legacy retry-info migration failed")
  );

  setInterval(async () => {
    try {
      const failedPosts = await db.select().from(posts).where(eq(posts.status, "failed")).limit(50);

      let requeued = 0;
      let deadCount = 0;

      for (const post of failedPosts) {
        const retryInfo = parseRetryInfo(post.errorMessage);
        const retryCount = retryInfo.count;

        if (retryCount >= MAX_RETRIES) {
          await db
            .update(posts)
            .set({
              status: "dead",
              errorMessage: JSON.stringify({ status: "dead", lastError: retryInfo.lastError }),
              updatedAt: new Date(),
            })
            .where(eq(posts.id, post.id));
          deadCount++;
          continue;
        }

        const backoffMs = BASE_BACKOFF_MS * 2 ** retryCount;
        const retryAt = new Date(post.updatedAt.getTime() + backoffMs);

        if (retryAt > new Date()) continue;

        await db
          .update(posts)
          .set({
            status: "scheduled",
            scheduledAt: new Date(),
            errorMessage: JSON.stringify({
              retryCount: retryCount + 1,
              lastError: retryInfo.lastError,
            }),
            updatedAt: new Date(),
          })
          .where(eq(posts.id, post.id));

        requeued++;
      }

      if (requeued > 0 || deadCount > 0) {
        log.info({ requeued, dead: deadCount }, "Dead-letter processor cycle complete");
      }
    } catch (err) {
      log.error({ error: String(err) }, "Dead-letter processor error");
    }
  }, PROCESS_INTERVAL_MS);
}

function parseRetryInfo(errorMessage: string | null): { count: number; lastError: string } {
  if (!errorMessage) return { count: 0, lastError: "unknown" };

  // Try JSON format first (new format)
  try {
    const meta = JSON.parse(errorMessage);
    if (typeof meta === "object" && meta !== null) {
      return {
        count: typeof meta.retryCount === "number" ? meta.retryCount : 0,
        lastError: typeof meta.lastError === "string" ? meta.lastError : errorMessage,
      };
    }
  } catch {
    // Not JSON — try legacy format
  }

  // Legacy format: "retry:N:lastError"
  const match = errorMessage.match(/^retry:(\d+):(.+)$/);
  if (match) {
    return { count: parseInt(match[1], 10), lastError: match[2] };
  }

  // Plain error message (first failure)
  return { count: 0, lastError: errorMessage };
}

export async function migrateLegacyRetryInfo(): Promise<{ migrated: number }> {
  if (migrationRan) return { migrated: 0 };
  migrationRan = true;

  const candidates = await db
    .select({ id: posts.id, errorMessage: posts.errorMessage })
    .from(posts)
    .where(and(eq(posts.status, "failed"), like(posts.errorMessage, "retry:%")))
    .limit(500);

  let migrated = 0;
  for (const row of candidates) {
    if (!row.errorMessage || !LEGACY_RETRY_PATTERN.test(row.errorMessage)) continue;
    const info = parseRetryInfo(row.errorMessage);
    const next = JSON.stringify({ retryCount: info.count, lastError: info.lastError });
    if (next === row.errorMessage) continue;
    await db
      .update(posts)
      .set({ errorMessage: next, updatedAt: new Date() })
      .where(eq(posts.id, row.id));
    migrated++;
  }

  if (migrated > 0) {
    log.info({ migrated }, "Migrated legacy retry:N:... error messages to JSON format");
  }
  return { migrated };
}
