import { Elysia } from 'elysia';
import { db } from '../../lib/db.js';
import { contentPlans } from '../../db/schema.js';
import { eq, and, desc, gte, lte, sql } from 'drizzle-orm';
import { tenantMiddleware } from '../middleware/tenant.js';
import { authMiddleware } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { createContentPlanSchema, paginationSchema } from '../validation/schemas.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ module: 'content-plans-route' });

export const contentPlansRoutes = new Elysia({ prefix: '/api/v1/content-plans' })
  .use(createRateLimiter('authenticated') as any)
  .use(authMiddleware)
  .use(tenantMiddleware)
  // List content plans with optional date range
  .get('/', async ({ tenantId, query }: any) => {
    const { page, limit } = paginationSchema.parse(query);
    const from = query.from as string | undefined;
    const to = query.to as string | undefined;

    const conditions = [eq(contentPlans.tenantId, tenantId)];
    if (from) conditions.push(gte(contentPlans.date, new Date(from)));
    if (to) conditions.push(lte(contentPlans.date, new Date(to)));

    const where = and(...conditions);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contentPlans)
      .where(where);

    const data = await db
      .select()
      .from(contentPlans)
      .where(where)
      .orderBy(desc(contentPlans.date))
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      plans: data,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  })
  // Get single plan
  .get('/:id', async ({ params, tenantId, set }: any) => {
    const [plan] = await db
      .select()
      .from(contentPlans)
      .where(and(eq(contentPlans.id, params.id), eq(contentPlans.tenantId, tenantId)))
      .limit(1);

    if (!plan) {
      set.status = 404;
      return { error: 'Content plan not found' };
    }
    return { plan };
  })
  // Create content plan
  .post('/', async ({ body, tenantId, set }: any) => {
    const input = createContentPlanSchema.parse(body);
    const [plan] = await db
      .insert(contentPlans)
      .values({
        tenantId,
        title: input.title,
        description: input.description || null,
        date: new Date(input.date),
        slotTime: input.slotTime || null,
        postId: input.postId || null,
        campaignId: input.campaignId || null,
      })
      .returning();

    set.status = 201;
    return { plan };
  })
  // Update content plan
  .put('/:id', async ({ params, body, tenantId, set }: any) => {
    const input = createContentPlanSchema.partial().parse(body);
    const [updated] = await db
      .update(contentPlans)
      .set({ ...input, date: input.date ? new Date(input.date) : undefined, updatedAt: new Date() } as any)
      .where(and(eq(contentPlans.id, params.id), eq(contentPlans.tenantId, tenantId)))
      .returning();

    if (!updated) {
      set.status = 404;
      return { error: 'Content plan not found' };
    }
    return { plan: updated };
  })
  // Delete content plan
  .delete('/:id', async ({ params, tenantId, set }: any) => {
    const [deleted] = await db
      .delete(contentPlans)
      .where(and(eq(contentPlans.id, params.id), eq(contentPlans.tenantId, tenantId)))
      .returning({ id: contentPlans.id });

    if (!deleted) {
      set.status = 404;
      return { error: 'Content plan not found' };
    }
    return { success: true };
  });
