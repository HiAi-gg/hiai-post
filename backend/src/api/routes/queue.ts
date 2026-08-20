import { Elysia } from "elysia";
import { DeadLetterQueue } from "../../core/scheduler/dead-letter.js";
import { PublishQueue } from "../../core/scheduler/queue.js";
import { redis } from "../../lib/redis.js";
import { authGuard } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimiter.js";
import { requireViewer } from "../middleware/rbac.js";
import { tenantGuard } from "../middleware/tenant.js";

const queue = new PublishQueue(redis);
const deadLetter = new DeadLetterQueue(redis);

/**
 * Queue inspection routes.
 *
 * Tenant scope comes exclusively from the authenticated principal
 * (`ctx.tenantId` set by tenantGuard) — the query-string `tenantId`
 * parameter is intentionally ignored so one tenant cannot inspect or retry
 * another tenant's publish queue.
 */
export const queueRoutes = new Elysia({ prefix: "/api/v1/queue" })
  .use(createRateLimiter("authenticated") as any)
  .onBeforeHandle(authGuard)
  .onBeforeHandle(tenantGuard)
  .onBeforeHandle(requireViewer())

  .get("/status", async ({ tenantId }: any) => {
    const [pending, deadLetterCount] = await Promise.all([
      queue.getCount(tenantId as string),
      deadLetter.listDeadLetters(tenantId as string).then((items: any[]) => items.length),
    ]);

    return { pending, deadLetter: deadLetterCount };
  })

  .get("/scheduled", async ({ tenantId }: any) => {
    const items = await queue.getScheduled(tenantId as string);
    return { items };
  })

  .post("/retry/:postId", async ({ params, tenantId }: any) => {
    const success = await deadLetter.retryDeadLetter(params.postId, tenantId as string);
    if (!success) {
      return { error: "Post not found in dead letter queue" };
    }

    return { success: true, message: "Post re-enqueued" };
  })

  .get("/dead-letter", async ({ tenantId }: any) => {
    const items = await deadLetter.listDeadLetters(tenantId as string);
    return { items };
  });
