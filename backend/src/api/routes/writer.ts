/**
 * Writer routes — /api/v1/writer
 *
 * Generates and rewrites AI content for the shared product foundation:
 *
 *   POST /api/v1/writer/generate  → create a new content item (+ revision #1)
 *   POST /api/v1/writer/rewrite   → rewrite an item (append-only revision)
 *
 * Read operations (GET content items / revisions) and the approval state
 * machine already exist on `/api/v1/content` (viewer+ read, editor+ writes,
 * admin+ approve) — the frontend reuses those routes, so they are NOT
 * duplicated here.
 *
 * Guards: auth → tenant → editor+ (generation is a write that creates
 * content/revisions, mirroring the editor+ floor on the content write
 * routes). Rate limiting uses the `generate` tier (hourly, AI-generator
 * bound). Service validation is runtime (zod in-service); DomainErrors map
 * to the shared envelope and hiai-kit errors carry their correlation id.
 *
 * NOTE: registration is serialized separately (see backend/src/api/index.ts)
 * — this module only exports the route plugin instance.
 */
import { Elysia } from "elysia";
import { contentSourceForContext } from "../../services/content.js";
import {
  generateWriterContent,
  rewriteWriterContent,
  toWriterErrorEnvelope,
} from "../../services/writer.js";
import { authGuard } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimiter.js";
import { requireEditor } from "../middleware/rbac.js";
import { tenantGuard } from "../middleware/tenant.js";

export const writerRoutes = new Elysia({ prefix: "/api/v1/writer" })
  .use(createRateLimiter("generate") as any)
  .onBeforeHandle(authGuard)
  .onBeforeHandle(tenantGuard)
  // Generation writes content — editor floor (membership enforced by tenantGuard).
  .onBeforeHandle(requireEditor())
  // Generate: create a content item + initial revision from a topic/instruction.
  // Body is validated by the service (writerGenerateSchema); tenant comes from
  // ctx.tenantId, never from the body. `source` is derived from the principal
  // (session → "web", machine → "api") so provenance is never client-set.
  .post("/generate", async ({ body, tenantId, userId, set, auth }: any) => {
    try {
      const result = await generateWriterContent({ tenantId, userId }, body, {
        source: contentSourceForContext({ auth }),
      });
      set.status = 201;
      return result;
    } catch (err) {
      const mapped = toWriterErrorEnvelope(err);
      if (mapped) {
        set.status = mapped.status;
        return mapped.envelope;
      }
      throw err;
    }
  })
  // Rewrite: regenerate an existing item, appending a revision (history preserved).
  .post("/rewrite", async ({ body, tenantId, userId, set }: any) => {
    try {
      const result = await rewriteWriterContent({ tenantId, userId }, body);
      return result;
    } catch (err) {
      const mapped = toWriterErrorEnvelope(err);
      if (mapped) {
        set.status = mapped.status;
        return mapped.envelope;
      }
      throw err;
    }
  });
