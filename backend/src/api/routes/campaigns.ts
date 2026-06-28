import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { campaigns, contentPlans, posts } from "../../db/schema.js";
import { db } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import { enqueuePost, removeQueuedPost } from "../../lib/redis.js";
import { authMiddleware } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimiter.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import {
  bulkScheduleCampaignSchema,
  createCampaignSchema,
  paginationSchema,
} from "../validation/schemas.js";

const log = logger.child({ module: "campaigns-route" });

export const campaignsRoutes = new Elysia({ prefix: "/api/v1/campaigns" })
  .use(createRateLimiter("authenticated") as any)
  .use(authMiddleware)
  .use(tenantMiddleware)
  // List campaigns
  .get("/", async ({ tenantId, query }: any) => {
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
  .get("/:id", async ({ params, tenantId, set }: any) => {
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, params.id), eq(campaigns.tenantId, tenantId)))
      .limit(1);

    if (!campaign) {
      set.status = 404;
      return { error: "Campaign not found" };
    }

    const plans = await db
      .select()
      .from(contentPlans)
      .where(eq(contentPlans.campaignId, campaign.id));

    return { campaign, contentPlans: plans };
  })
  // Get campaign progress
  .get("/:id/progress", async ({ params, tenantId, set }: any) => {
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, params.id), eq(campaigns.tenantId, tenantId)))
      .limit(1);

    if (!campaign) {
      set.status = 404;
      return { error: "Campaign not found" };
    }

    const planStatuses = await db
      .select({ status: posts.status })
      .from(contentPlans)
      .leftJoin(posts, eq(contentPlans.postId, posts.id))
      .where(and(eq(contentPlans.campaignId, params.id), eq(contentPlans.tenantId, tenantId)));

    const published = planStatuses.filter((p) => p.status === "published").length;
    const scheduled = planStatuses.filter((p) => p.status === "scheduled").length;
    const failed = planStatuses.filter((p) => p.status === "failed").length;
    const total = planStatuses.length;
    const remaining = total - published - failed;

    return { published, scheduled, failed, remaining, total };
  })
  // Pause campaign — sets status to paused, removes scheduled posts from queue
  .post("/:id/pause", async ({ params, tenantId, set }: any) => {
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, params.id), eq(campaigns.tenantId, tenantId)))
      .limit(1);

    if (!campaign) {
      set.status = 404;
      return { error: "Campaign not found" };
    }

    if (campaign.status !== "active") {
      set.status = 400;
      return { error: "Only active campaigns can be paused" };
    }

    // Find all scheduled posts linked to this campaign
    const planPostIds = await db
      .select({ postId: contentPlans.postId })
      .from(contentPlans)
      .where(and(eq(contentPlans.campaignId, params.id), eq(contentPlans.tenantId, tenantId)));

    const postIds = planPostIds.map((p) => p.postId).filter(Boolean) as string[];

    if (postIds.length > 0) {
      const scheduledPosts = await db
        .select({ id: posts.id })
        .from(posts)
        .where(and(inArray(posts.id, postIds), eq(posts.status, "scheduled")));

      for (const post of scheduledPosts) {
        await removeQueuedPost(tenantId, post.id);
      }
    }

    const [updated] = await db
      .update(campaigns)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(campaigns.id, params.id))
      .returning();

    log.info({ campaignId: params.id }, "Campaign paused");
    return { campaign: updated };
  })
  // Resume campaign — sets status to active, re-enqueues pending posts
  .post("/:id/resume", async ({ params, tenantId, set }: any) => {
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, params.id), eq(campaigns.tenantId, tenantId)))
      .limit(1);

    if (!campaign) {
      set.status = 404;
      return { error: "Campaign not found" };
    }

    if (campaign.status !== "paused") {
      set.status = 400;
      return { error: "Only paused campaigns can be resumed" };
    }

    // Find scheduled posts with a future scheduledAt
    const now = new Date();
    const postsToEnqueue = await db
      .select({ postId: posts.id, scheduledAt: posts.scheduledAt })
      .from(contentPlans)
      .innerJoin(posts, eq(contentPlans.postId, posts.id))
      .where(
        and(
          eq(contentPlans.campaignId, params.id),
          eq(contentPlans.tenantId, tenantId),
          eq(posts.status, "scheduled"),
          gt(posts.scheduledAt, now)
        )
      );

    for (const p of postsToEnqueue) {
      if (p.postId && p.scheduledAt) {
        await enqueuePost(tenantId, p.postId, p.scheduledAt);
      }
    }

    const [updated] = await db
      .update(campaigns)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(campaigns.id, params.id))
      .returning();

    log.info({ campaignId: params.id, reEnqueued: postsToEnqueue.length }, "Campaign resumed");
    return { campaign: updated };
  })
  // Bulk schedule posts in a campaign at regular intervals
  .post("/:id/bulk-schedule", async ({ params, body, tenantId, set }: any) => {
    const input = bulkScheduleCampaignSchema.parse(body);

    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, params.id), eq(campaigns.tenantId, tenantId)))
      .limit(1);

    if (!campaign) {
      set.status = 404;
      return { error: "Campaign not found" };
    }

    const startDate = new Date(input.startDate);
    const createdPlans = [];

    for (let i = 0; i < input.postIds.length; i++) {
      const scheduleDate = new Date(startDate.getTime() + i * input.intervalMinutes * 60 * 1000);
      const hours = String(scheduleDate.getHours()).padStart(2, "0");
      const minutes = String(scheduleDate.getMinutes()).padStart(2, "0");

      const [plan] = await db
        .insert(contentPlans)
        .values({
          tenantId,
          title: `Scheduled post ${i + 1}`,
          date: scheduleDate,
          slotTime: `${hours}:${minutes}`,
          postId: input.postIds[i],
          campaignId: params.id,
          status: "planned",
        })
        .returning();

      createdPlans.push(plan);

      const [updatedPost] = await db
        .update(posts)
        .set({
          scheduledAt: scheduleDate,
          status: "scheduled",
          updatedAt: new Date(),
        })
        .where(and(eq(posts.id, input.postIds[i]), eq(posts.tenantId, tenantId)))
        .returning();

      if (updatedPost) {
        await enqueuePost(tenantId, updatedPost.id, scheduleDate);
      }
    }

    set.status = 201;
    return { plans: createdPlans };
  })
  // Create campaign
  .post("/", async ({ body, tenantId, set }: any) => {
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
  .put("/:id", async ({ params, body, tenantId, set }: any) => {
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
      return { error: "Campaign not found" };
    }
    return { campaign: updated };
  })
  // Delete campaign
  .delete("/:id", async ({ params, tenantId, set }: any) => {
    const [deleted] = await db
      .delete(campaigns)
      .where(and(eq(campaigns.id, params.id), eq(campaigns.tenantId, tenantId)))
      .returning({ id: campaigns.id });

    if (!deleted) {
      set.status = 404;
      return { error: "Campaign not found" };
    }
    return { success: true };
  });
