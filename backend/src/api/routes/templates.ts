import { and, desc, eq, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { postTemplates } from "../../db/schema.js";
import { db } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import { authMiddleware } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimiter.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { createTemplateSchema, paginationSchema } from "../validation/schemas.js";

const _log = logger.child({ module: "templates-route" });

export const templatesRoutes = new Elysia({ prefix: "/api/v1/templates" })
  .use(createRateLimiter("authenticated") as any)
  .use(authMiddleware)
  .use(tenantMiddleware)
  // List templates
  .get("/", async ({ tenantId, query }: any) => {
    const { page, limit } = paginationSchema.parse(query);
    const platform = query.platform as string | undefined;

    const conditions = [eq(postTemplates.tenantId, tenantId)];
    if (platform) conditions.push(eq(postTemplates.platform, platform));

    const where = and(...conditions);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(postTemplates)
      .where(where);

    const data = await db
      .select()
      .from(postTemplates)
      .where(where)
      .orderBy(desc(postTemplates.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      templates: data,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  })
  // Get single template
  .get("/:id", async ({ params, tenantId, set }: any) => {
    const [template] = await db
      .select()
      .from(postTemplates)
      .where(and(eq(postTemplates.id, params.id), eq(postTemplates.tenantId, tenantId)))
      .limit(1);

    if (!template) {
      set.status = 404;
      return { error: "Template not found" };
    }
    return { template };
  })
  // Create template
  .post("/", async ({ body, tenantId, set }: any) => {
    const input = createTemplateSchema.parse(body);
    const [template] = await db
      .insert(postTemplates)
      .values({
        tenantId,
        name: input.name,
        platform: input.platform || null,
        contentText: input.contentText || null,
        aiPrompt: input.aiPrompt || null,
        variables: input.variables,
      })
      .returning();

    set.status = 201;
    return { template };
  })
  // Update template
  .put("/:id", async ({ params, body, tenantId, set }: any) => {
    const input = createTemplateSchema.partial().parse(body);
    const [updated] = await db
      .update(postTemplates)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(postTemplates.id, params.id), eq(postTemplates.tenantId, tenantId)))
      .returning();

    if (!updated) {
      set.status = 404;
      return { error: "Template not found" };
    }
    return { template: updated };
  })
  // Delete template
  .delete("/:id", async ({ params, tenantId, set }: any) => {
    const [deleted] = await db
      .delete(postTemplates)
      .where(and(eq(postTemplates.id, params.id), eq(postTemplates.tenantId, tenantId)))
      .returning({ id: postTemplates.id });

    if (!deleted) {
      set.status = 404;
      return { error: "Template not found" };
    }
    return { success: true };
  });
