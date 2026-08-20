/**
 * Project / Brand routes — /api/v1/projects
 *
 * Tenant scope comes exclusively from `ctx.tenantId` (tenantGuard); no
 * request input is trusted for scoping. Read = viewer+ (instance hook);
 * write routes carry LOCAL `beforeHandle` guards (editor+). Local route
 * hooks are used because Elysia 1.4 applies instance-level hooks to every
 * route regardless of registration position.
 */
import { Elysia } from "elysia";
import { handleServiceError } from "../../services/errors.js";
import {
  createBrand,
  createProject,
  deleteBrand,
  deleteProject,
  getBrand,
  getProject,
  getProjectContext,
  listBrands,
  listProjects,
  updateBrand,
  updateProject,
} from "../../services/projects.js";
import { authGuard } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimiter.js";
import { requireEditor, requireViewer } from "../middleware/rbac.js";
import { tenantGuard } from "../middleware/tenant.js";
import { paginationSchema } from "../validation/schemas.js";

export const projectsRoutes = new Elysia({ prefix: "/api/v1/projects" })
  .use(createRateLimiter("authenticated") as any)
  .onBeforeHandle(authGuard)
  .onBeforeHandle(tenantGuard)
  // Viewer by default — membership is enforced by tenantGuard.
  .onBeforeHandle(requireViewer())
  // List projects
  .get("/", async ({ tenantId, userId, query }: any) => {
    const pagination = paginationSchema.parse(query);
    const result = await listProjects({ tenantId, userId }, pagination);
    return { projects: result.data, pagination: result.pagination };
  })
  // Get project
  .get("/:id", async ({ params, tenantId, userId, set }: any) => {
    try {
      const project = await getProject({ tenantId, userId }, params.id);
      return { project };
    } catch (err) {
      return handleServiceError(set, err);
    }
  })
  // Project context: project + brands + content summary
  .get("/:id/context", async ({ params, tenantId, userId, set }: any) => {
    try {
      const context = await getProjectContext({ tenantId, userId }, params.id);
      return context;
    } catch (err) {
      return handleServiceError(set, err);
    }
  })
  // List brands (optionally scoped to the project)
  .get("/:id/brands", async ({ params, tenantId, userId, query }: any) => {
    const pagination = paginationSchema.parse(query);
    const result = await listBrands(
      { tenantId, userId },
      { projectId: params.id, page: pagination.page, limit: pagination.limit }
    );
    return { brands: result.data, pagination: result.pagination };
  })
  // Get brand (scoped to the project)
  .get("/:id/brands/:brandId", async ({ params, tenantId, userId, set }: any) => {
    try {
      const brand = await getBrand({ tenantId, userId }, params.brandId, { projectId: params.id });
      return { brand };
    } catch (err) {
      return handleServiceError(set, err);
    }
  })
  // ── Write routes — editor+ (local hooks) ─────────────────
  // Create project (body validated by the service)
  .post(
    "/",
    async ({ body, tenantId, userId, set }: any) => {
      try {
        const project = await createProject({ tenantId, userId }, body);
        set.status = 201;
        return { project };
      } catch (err) {
        return handleServiceError(set, err);
      }
    },
    { beforeHandle: requireEditor() }
  )
  // Update project
  .put(
    "/:id",
    async ({ params, body, tenantId, userId, set }: any) => {
      try {
        const project = await updateProject({ tenantId, userId }, params.id, body);
        return { project };
      } catch (err) {
        return handleServiceError(set, err);
      }
    },
    { beforeHandle: requireEditor() }
  )
  // Delete project
  .delete(
    "/:id",
    async ({ params, tenantId, userId, set }: any) => {
      try {
        await deleteProject({ tenantId, userId }, params.id);
        return { success: true };
      } catch (err) {
        return handleServiceError(set, err);
      }
    },
    { beforeHandle: requireEditor() }
  )
  // Create brand (projectId is the path param — never from the body)
  .post(
    "/:id/brands",
    async ({ params, body, tenantId, userId, set }: any) => {
      try {
        const brand = await createBrand({ tenantId, userId }, body, { projectId: params.id });
        set.status = 201;
        return { brand };
      } catch (err) {
        return handleServiceError(set, err);
      }
    },
    { beforeHandle: requireEditor() }
  )
  // Update brand
  .put(
    "/:id/brands/:brandId",
    async ({ params, body, tenantId, userId, set }: any) => {
      try {
        const brand = await updateBrand({ tenantId, userId }, params.brandId, body, {
          projectId: params.id,
        });
        return { brand };
      } catch (err) {
        return handleServiceError(set, err);
      }
    },
    { beforeHandle: requireEditor() }
  )
  // Delete brand
  .delete(
    "/:id/brands/:brandId",
    async ({ params, tenantId, userId, set }: any) => {
      try {
        await deleteBrand({ tenantId, userId }, params.brandId, { projectId: params.id });
        return { success: true };
      } catch (err) {
        return handleServiceError(set, err);
      }
    },
    { beforeHandle: requireEditor() }
  );
