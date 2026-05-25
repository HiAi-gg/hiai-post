import { Elysia } from 'elysia';
import { db } from '../../lib/db.js';
import { campaigns, contentPlans } from '../../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { tenantMiddleware } from '../middleware/tenant.js';
import { authMiddleware } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { createCampaignSchema, paginationSchema } from '../validation/schemas.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ module: 'campaigns-route' });

export const campaignsRoutes = new Elysia({ prefix: '/api/v1/campaigns' })
  .use(createRateLimiter('authenticated') as any)
  .use(authMiddleware)
  .use(tenantMiddleware)
  // List campaigns
  .get('/', async ({ tenantId, query }: any) => {
    const { page, limit } = paginationSchema.parse(query);

    const where = eq(campaigns.tenantId, tenantId);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(campaigns)
      .where(where);

    const data = await db
      .select()
      .from(campaigns)
      .where(where)
      .orderBy(desc(campaigns.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      campaigns: data,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  })
  // Get single campaign with content plans
  .get('/:id', async ({ params, tenantId, set }: any) => {
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, params.id), eq(campaigns.tenantId, tenantId)))
      .limit(1);

    if (!campaign) {
      set.status = 404;
      return { error: 'Campaign not found' };
    }

    const plans = await db
      .select()
      .from(contentPlans)
      .where(eq(contentPlans.campaignId, campaign.id));

    return { campaign, contentPlans: plans };
  })
  // Create campaign
  .post('/', async ({ body, tenantId, set }: any) => {
    const input = createCampaignSchema.parse(body);
    const [campaign] = await db
      .insert(campaigns)
      .values({
        tenantId,
        name: input.name,
        description: input.description || null,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
      })
      .returning();

    set.status = 201;
    return { campaign };
  })
  // Update campaign
  .put('/:id', async ({ params, body, tenantId, set }: any) => {
    const input = createCampaignSchema.partial().parse(body);
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.startDate) updateData.startDate = new Date(input.startDate);
    if (input.endDate) updateData.endDate = new Date(input.endDate);

    const [updated] = await db
      .update(campaigns)
      .set(updateData)
      .where(and(eq(campaigns.id, params.id), eq(campaigns.tenantId, tenantId)))
      .returning();

    if (!updated) {
      set.status = 404;
      return { error: 'Campaign not found' };
    }
    return { campaign: updated };
  })
  // Delete campaign
  .delete('/:id', async ({ params, tenantId, set }: any) => {
    const [deleted] = await db
      .delete(campaigns)
      .where(and(eq(campaigns.id, params.id), eq(campaigns.tenantId, tenantId)))
      .returning({ id: campaigns.id });

    if (!deleted) {
      set.status = 404;
      return { error: 'Campaign not found' };
    }
    return { success: true };
  });
