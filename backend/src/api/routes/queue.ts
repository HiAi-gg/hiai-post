import { Elysia } from "elysia";
import { DeadLetterQueue } from "../../core/scheduler/dead-letter.js";
import { PublishQueue } from "../../core/scheduler/queue.js";
import { redis } from "../../lib/redis.js";

const queue = new PublishQueue(redis);
const deadLetter = new DeadLetterQueue(redis);

export const queueRoutes = new Elysia({ prefix: "/api/v1/queue" })
  .get("/status", async ({ query }) => {
    const tenantId = (query as any).tenantId as string;
    if (!tenantId) {
      return { error: "tenantId required" };
    }

    const [pending, deadLetterCount] = await Promise.all([
      queue.getCount(tenantId),
      deadLetter.listDeadLetters(tenantId).then((items: any[]) => items.length),
    ]);

    return { pending, deadLetter: deadLetterCount };
  })

  .get("/scheduled", async ({ query }) => {
    const tenantId = (query as any).tenantId as string;
    if (!tenantId) {
      return { error: "tenantId required" };
    }

    const items = await queue.getScheduled(tenantId);
    return { items };
  })

  .post("/retry/:postId", async ({ params, query }) => {
    const tenantId = (query as any).tenantId as string;
    if (!tenantId) {
      return { error: "tenantId required" };
    }

    const success = await deadLetter.retryDeadLetter(params.postId, tenantId);
    if (!success) {
      return { error: "Post not found in dead letter queue" };
    }

    return { success: true, message: "Post re-enqueued" };
  })

  .get("/dead-letter", async ({ query }) => {
    const tenantId = (query as any).tenantId as string;
    if (!tenantId) {
      return { error: "tenantId required" };
    }

    const items = await deadLetter.listDeadLetters(tenantId);
    return { items };
  });
