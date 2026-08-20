/**
 * Content routes — /api/v1/content
 *
 * Tenant scope comes exclusively from `ctx.tenantId` (tenantGuard); no
 * request input is trusted for scoping. Read (list/get/revisions) = viewer+
 * (instance hook). Write routes carry LOCAL `beforeHandle` guards:
 * create / revisions / restore / submit-review / request-changes = editor+;
 * approve = admin+ (explicit approval is a governance action). Local route
 * hooks are used because Elysia 1.4 applies instance-level hooks to every
 * route regardless of registration position.
 */
import { Elysia } from "elysia";
import {
  approveContent,
  requestChanges as requestChangesAction,
  submitForReview,
} from "../../services/approval.js";
import {
  contentSourceForContext,
  createContentItem,
  getContentItem,
  listContentItems,
} from "../../services/content.js";
import { handleServiceError } from "../../services/errors.js";
import { createRevision, listRevisions, restoreRevision } from "../../services/revisions.js";
import { authGuard } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimiter.js";
import { requireAdmin, requireEditor, requireViewer } from "../middleware/rbac.js";
import { tenantGuard } from "../middleware/tenant.js";
import { listContentItemsQuerySchema, revisionIdParamSchema } from "../validation/schemas.js";

export const contentRoutes = new Elysia({ prefix: "/api/v1/content" })
  .use(createRateLimiter("authenticated") as any)
  .onBeforeHandle(authGuard)
  .onBeforeHandle(tenantGuard)
  // Viewer by default — membership is enforced by tenantGuard.
  .onBeforeHandle(requireViewer())
  // List content items (filters: status, projectId, brandId)
  .get("/", async ({ tenantId, userId, query }: any) => {
    const input = listContentItemsQuerySchema.parse(query);
    const result = await listContentItems({ tenantId, userId }, input);
    return { items: result.data, pagination: result.pagination };
  })
  // Get content item
  .get("/:id", async ({ params, tenantId, userId, set }: any) => {
    try {
      const item = await getContentItem({ tenantId, userId }, params.id);
      return { item };
    } catch (err) {
      return handleServiceError(set, err);
    }
  })
  // List revisions (viewer can read history)
  .get("/:id/revisions", async ({ params, tenantId, userId, set }: any) => {
    try {
      const revisions = await listRevisions({ tenantId, userId }, params.id);
      return { revisions };
    } catch (err) {
      return handleServiceError(set, err);
    }
  })
  // ── Write routes — editor+ (local hooks) ─────────────────
  // Create content item (always snapshots revision #1; body validated by the
  // service). `source` is derived from the acting principal and overrides any
  // client-provided value — clients cannot mislabel provenance.
  .post(
    "/",
    async ({ body, tenantId, userId, set, auth }: any) => {
      try {
        const item = await createContentItem(
          { tenantId, userId },
          { ...body, source: contentSourceForContext({ auth }) }
        );
        set.status = 201;
        return { item };
      } catch (err) {
        return handleServiceError(set, err);
      }
    },
    { beforeHandle: requireEditor() }
  )
  // Create revision (snapshot of the item's current state)
  .post(
    "/:id/revisions",
    async ({ params, body, tenantId, userId, set }: any) => {
      try {
        const revision = await createRevision({ tenantId, userId }, params.id, body);
        set.status = 201;
        return { revision };
      } catch (err) {
        return handleServiceError(set, err);
      }
    },
    { beforeHandle: requireEditor() }
  )
  // Restore revision (history preserved — appends a new revision)
  .post(
    "/:id/revisions/:revisionId/restore",
    async ({ params, tenantId, userId, set }: any) => {
      try {
        revisionIdParamSchema.parse(params);
        const result = await restoreRevision({ tenantId, userId }, params.id, params.revisionId);
        return { item: result.item, revision: result.revision };
      } catch (err) {
        return handleServiceError(set, err);
      }
    },
    { beforeHandle: requireEditor() }
  )
  // Submit for review: draft | changes_requested → in_review
  .post(
    "/:id/submit-review",
    async ({ params, tenantId, userId, set }: any) => {
      try {
        const item = await submitForReview({ tenantId, userId }, params.id);
        return { item };
      } catch (err) {
        return handleServiceError(set, err);
      }
    },
    { beforeHandle: requireEditor() }
  )
  // Request changes: in_review → changes_requested (with reviewer note)
  .post(
    "/:id/request-changes",
    async ({ params, body, tenantId, userId, set }: any) => {
      try {
        const item = await requestChangesAction(
          { tenantId, userId },
          params.id,
          (body as any)?.note
        );
        return { item };
      } catch (err) {
        return handleServiceError(set, err);
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
        const item = await approveContent({ tenantId, userId }, params.id);
        return { item };
      } catch (err) {
        return handleServiceError(set, err);
      }
    },
    { beforeHandle: requireAdmin() }
  );
