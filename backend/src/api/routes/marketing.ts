/**
 * Marketing operator proxy — /api/v1/marketing
 *
 * Thin pass-through to hiai-kit `/api/v1/marketing`. No second Mastra.
 */
import { Elysia } from "elysia";
import { createHiaiKitClient, isHiaiKitError, toHiaiKitErrorEnvelope } from "../../integrations/hiai-kit/index.js";
import { marketingPipelineInputSchema } from "../../integrations/hiai-kit/schemas.js";
import { authGuard } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimiter.js";
import { requireEditor, requireViewer } from "../middleware/rbac.js";
import { tenantGuard } from "../middleware/tenant.js";

function handleAdapterError(set: { status?: number }, err: unknown): unknown {
  if (isHiaiKitError(err)) {
    const envelope = toHiaiKitErrorEnvelope(err);
    if (envelope) {
      set.status = envelope.status;
      return {
        error: envelope.error,
        message: envelope.message,
        code: envelope.error,
        correlationId: envelope.correlationId,
        requestId: envelope.requestId,
      };
    }
  }
  throw err;
}

export const marketingRoutes = new Elysia({ prefix: "/api/v1/marketing" })
  .use(createRateLimiter("authenticated") as never)
  .onBeforeHandle(authGuard)
  .onBeforeHandle(tenantGuard)
  .onBeforeHandle(requireViewer())
  .get("/agents", async ({ set }: { set: { status?: number } }) => {
    try {
      const client = createHiaiKitClient();
      return { agents: await client.marketing.listAgents() };
    } catch (err) {
      return handleAdapterError(set, err);
    }
  })
  .get("/trends", async ({ query, set }: { query: Record<string, string>; set: { status?: number } }) => {
    try {
      const limit = query.limit ? Number(query.limit) : 20;
      const client = createHiaiKitClient();
      return { trends: await client.marketing.listTrends(Number.isFinite(limit) ? limit : 20) };
    } catch (err) {
      return handleAdapterError(set, err);
    }
  })
  .get("/engagement", async ({ query, set }: { query: Record<string, string>; set: { status?: number } }) => {
    try {
      const topN = query.topN ? Number(query.topN) : 5;
      const lookbackDays = query.lookbackDays ? Number(query.lookbackDays) : 7;
      const client = createHiaiKitClient();
      return await client.marketing.getEngagement(topN, lookbackDays);
    } catch (err) {
      return handleAdapterError(set, err);
    }
  })
  .post(
    "/pipeline",
    async ({ body, set }: { body: unknown; set: { status?: number } }) => {
      const parsed = marketingPipelineInputSchema.safeParse(body ?? {});
      if (!parsed.success) {
        set.status = 400;
        return { error: "VALIDATION", message: "Invalid pipeline input", details: parsed.error.flatten().fieldErrors };
      }
      try {
        const client = createHiaiKitClient();
        return await client.marketing.runPipeline(parsed.data);
      } catch (err) {
        return handleAdapterError(set, err);
      }
    },
    { beforeHandle: requireEditor() },
  );
