/**
 * Carousel routes — /api/v1/carousels
 *
 * Product workspace for the hiai-kit carousel pipeline. Tenant scope comes
 * exclusively from `ctx.tenantId` (tenantGuard); no request input is
 * trusted for scoping. Read routes = viewer+ (instance hook); write routes
 * carry LOCAL `beforeHandle` guards (editor+; approve = admin+). Local route
 * hooks are used because Elysia 1.4 applies instance-level hooks to every
 * route regardless of registration position.
 *
 * hiai-kit is reached ONLY through the centralized integration adapter
 * (services/carousels.ts → createHiaiKitClient). Adapter failures surface
 * as normalized capability errors with the hiai-kit status code — never a
 * fabricated success.
 *
 * NOTE: registration in backend/src/api/index.ts is serialized separately —
 * this module is self-contained and mounts like any other protected route.
 */
import { Elysia } from "elysia";
import { z } from "zod";
import { isHiaiKitError, toHiaiKitErrorEnvelope } from "../../integrations/hiai-kit/index.js";
import { approveContent, requestChanges, submitForReview } from "../../services/approval.js";
import {
  createCarousel,
  getCarousel,
  getCarouselJob,
  getCarouselRevisions,
  getCarouselSlideJson,
  listCarousels,
  regenerateCarousel,
  regenerateSlide,
  saveCarouselSlideDocument,
} from "../../services/carousels.js";
import { contentSourceForContext } from "../../services/content.js";
import { handleServiceError, ValidationError } from "../../services/errors.js";
import { authGuard } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimiter.js";
import { requireAdmin, requireEditor, requireViewer } from "../middleware/rbac.js";
import { tenantGuard } from "../middleware/tenant.js";
import { paginationSchema } from "../validation/schemas.js";

const slideIndexSchema = z.object({
  index: z.coerce.number().int().min(1).max(10),
});

/**
 * Map domain errors (404/409/400) AND normalized hiai-kit adapter errors to
 * HTTP responses. Unknown errors are rethrown → global handleError (500).
 */
function handleServiceOrAdapterError(set: { status?: number }, err: unknown): unknown {
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
  return handleServiceError(set, err);
}

export const carouselsRoutes = new Elysia({ prefix: "/api/v1/carousels" })
  .use(createRateLimiter("authenticated") as any)
  .onBeforeHandle(authGuard)
  .onBeforeHandle(tenantGuard)
  // Viewer by default — membership is enforced by tenantGuard.
  .onBeforeHandle(requireViewer())
  // List carousels (only content items persisted as { kind: "carousel" })
  .get("/", async ({ tenantId, userId, query }: any) => {
    const pagination = paginationSchema.parse(query);
    const result = await listCarousels({ tenantId, userId }, pagination);
    return { items: result.data, pagination: result.pagination };
  })
  // Get carousel (includes the persisted bodyJson with the actual slide data)
  .get("/:id", async ({ params, tenantId, userId, set }: any) => {
    try {
      const item = await getCarousel({ tenantId, userId }, params.id);
      return { item };
    } catch (err) {
      return handleServiceOrAdapterError(set, err);
    }
  })
  // Revision history (immutable append-only)
  .get("/:id/revisions", async ({ params, tenantId, userId, set }: any) => {
    try {
      const revisions = await getCarouselRevisions({ tenantId, userId }, params.id);
      return { revisions };
    } catch (err) {
      return handleServiceOrAdapterError(set, err);
    }
  })
  // Live job status from hiai-kit (normalized; errors surface honestly)
  .get("/:id/job", async ({ params, tenantId, userId, set }: any) => {
    try {
      const job = await getCarouselJob({ tenantId, userId }, params.id);
      return { job };
    } catch (err) {
      return handleServiceOrAdapterError(set, err);
    }
  })
  // Actual generated slide document (rendered client-side)
  .get("/:id/slides/:index/json", async ({ params, tenantId, userId, set }: any) => {
    try {
      const parsed = slideIndexSchema.safeParse(params);
      if (!parsed.success) {
        throw new ValidationError("Validation failed", parsed.error.flatten());
      }
      const json = await getCarouselSlideJson({ tenantId, userId }, params.id, parsed.data.index);
      return { json };
    } catch (err) {
      return handleServiceOrAdapterError(set, err);
    }
  })
  // ── Write routes — editor+ (local hooks) ─────────────────
  // Create a carousel (dispatches the hiai-kit job + snapshots revision #1).
  // `source` is derived from the principal, never from client input.
  .post(
    "/",
    async ({ body, tenantId, userId, set, auth }: any) => {
      try {
        const result = await createCarousel({ tenantId, userId }, body, {
          source: contentSourceForContext({ auth }),
        });
        set.status = 201;
        return { item: result.item, job: result.job };
      } catch (err) {
        return handleServiceOrAdapterError(set, err);
      }
    },
    { beforeHandle: requireEditor() }
  )
  // Full-carousel regeneration (optional partial re-definition; appends a revision)
  .post(
    "/:id/regenerate",
    async ({ params, body, tenantId, userId, set }: any) => {
      try {
        const result = await regenerateCarousel({ tenantId, userId }, params.id, body);
        return { item: result.item, revision: result.revision, job: result.job };
      } catch (err) {
        return handleServiceOrAdapterError(set, err);
      }
    },
    { beforeHandle: requireEditor() }
  )
  // Per-slide regeneration (persists the actual regenerated slide document)
  .post(
    "/:id/slides/:index/regenerate",
    async ({ params, body, tenantId, userId, set }: any) => {
      try {
        const parsed = slideIndexSchema.safeParse(params);
        if (!parsed.success) {
          throw new ValidationError("Validation failed", parsed.error.flatten());
        }
        const result = await regenerateSlide(
          { tenantId, userId },
          params.id,
          parsed.data.index,
          (body as any)?.description
        );
        return { item: result.item, revision: result.revision, slide: result.slide };
      } catch (err) {
        return handleServiceOrAdapterError(set, err);
      }
    },
    { beforeHandle: requireEditor() }
  )
  // Save a slide's actual document (editor+): PUT replaces the selected
  // slide's `doc` with the validated hiai-kit slide document and appends an
  // immutable revision. The request body IS the document — the resource this
  // route owns is the slide's json. Returns the normalized current content.
  .put(
    "/:id/slides/:index/json",
    async ({ params, body, tenantId, userId, set }: any) => {
      try {
        const parsed = slideIndexSchema.safeParse(params);
        if (!parsed.success) {
          throw new ValidationError("Validation failed", parsed.error.flatten());
        }
        const result = await saveCarouselSlideDocument(
          { tenantId, userId },
          params.id,
          parsed.data.index,
          body
        );
        return { item: result.item, revision: result.revision, slide: result.slide };
      } catch (err) {
        return handleServiceOrAdapterError(set, err);
      }
    },
    { beforeHandle: requireEditor() }
  )
  // Submit for review: draft | changes_requested → in_review
  .post(
    "/:id/submit-review",
    async ({ params, tenantId, userId, set }: any) => {
      try {
        await getCarousel({ tenantId, userId }, params.id);
        const item = await submitForReview({ tenantId, userId }, params.id);
        return { item };
      } catch (err) {
        return handleServiceOrAdapterError(set, err);
      }
    },
    { beforeHandle: requireEditor() }
  )
  // Request changes: in_review → changes_requested (with reviewer note)
  .post(
    "/:id/request-changes",
    async ({ params, body, tenantId, userId, set }: any) => {
      try {
        await getCarousel({ tenantId, userId }, params.id);
        const item = await requestChanges({ tenantId, userId }, params.id, (body as any)?.note);
        return { item };
      } catch (err) {
        return handleServiceOrAdapterError(set, err);
      }
    },
    { beforeHandle: requireEditor() }
  )
  // ── Governance — admin+ (local hook) ─────────────────────
  // Approve: in_review → approved (terminal)
  .post(
    "/:id/approve",
    async ({ params, tenantId, userId, set }: any) => {
      try {
        await getCarousel({ tenantId, userId }, params.id);
        const item = await approveContent({ tenantId, userId }, params.id);
        return { item };
      } catch (err) {
        return handleServiceOrAdapterError(set, err);
      }
    },
    { beforeHandle: requireAdmin() }
  );
