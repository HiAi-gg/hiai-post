import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { posts } from "../../db/schema.js";
import { db } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import { enqueuePost, removeQueuedPost } from "../../lib/redis.js";
import { authMiddleware } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimiter.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import {
  createPostSchema,
  paginationSchema,
  schedulePostSchema,
  updatePostSchema,
} from "../validation/schemas.js";

const _log = logger.child({ module: "posts-route" });

export const postsRoutes = new Elysia({ prefix: "/api/v1/posts" })
  .use(createRateLimiter("authenticated") as any)
  .use(authMiddleware)
  .use(tenantMiddleware)
  // List posts with pagination and filters
  .get("/", async ({ tenantId, query }: any) => {
    const { page, limit, sortBy, sortOrder } = paginationSchema.parse(query);
    const status = query.status as string | undefined;
    const platform = query.platform as string | undefined;
    const _search = query.search as string | undefined;

    const conditions = [eq(posts.tenantId, tenantId)];
    if (status) conditions.push(eq(posts.status, status));
    if (platform) conditions.push(eq(posts.platform, platform));

    const where = and(...conditions);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .where(where);

    const data = await db
      .select()
      .from(posts)
      .where(where)
      .orderBy(desc(posts.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      posts: data,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    };
  })
  // Get single post
  .get("/:id", async ({ params, tenantId, set }: any) => {
    const [post] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.id, params.id), eq(posts.tenantId, tenantId)))
      .limit(1);

    if (!post) {
      set.status = 404;
      return { error: "Post not found" };
    }
    return { post };
  })
  // Create post
  .post("/", async ({ body, tenantId, set }: any) => {
    const input = createPostSchema.parse(body);
    const contentHash = createHash("sha256").update(input.contentText).digest("hex").slice(0, 16);

    const [post] = await db
      .insert(posts)
      .values({
        tenantId,
        socialAccountId: input.socialAccountId || null,
        contentText: input.contentText,
        contentJson: input.contentJson || null,
        mediaUrls: input.mediaUrls,
        platform: input.platform || null,
        status: input.scheduledAt ? "scheduled" : "draft",
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        contentHash,
      })
      .returning();

    // If scheduled, enqueue in Redis
    if (input.scheduledAt) {
      await enqueuePost(tenantId, post.id, new Date(input.scheduledAt));
    }

    set.status = 201;
    return { post };
  })
  // Update post
  .put("/:id", async ({ params, body, tenantId, set }: any) => {
    const input = updatePostSchema.parse(body);
    const [existing] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.id, params.id), eq(posts.tenantId, tenantId)))
      .limit(1);

    if (!existing) {
      set.status = 404;
      return { error: "Post not found" };
    }

    if (existing.status === "published") {
      set.status = 400;
      return { error: "Cannot edit published posts" };
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (input.contentText !== undefined) {
      updateData.contentText = input.contentText;
      updateData.contentHash = createHash("sha256")
        .update(input.contentText)
        .digest("hex")
        .slice(0, 16);
    }
    if (input.contentJson !== undefined) updateData.contentJson = input.contentJson;
    if (input.mediaUrls !== undefined) updateData.mediaUrls = input.mediaUrls;
    if (input.platform !== undefined) updateData.platform = input.platform;
    if (input.socialAccountId !== undefined) updateData.socialAccountId = input.socialAccountId;

    if (input.scheduledAt !== undefined) {
      updateData.scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
      updateData.status = input.scheduledAt ? "scheduled" : "draft";

      // Update Redis queue
      await removeQueuedPost(tenantId, params.id);
      if (input.scheduledAt) {
        await enqueuePost(tenantId, params.id, new Date(input.scheduledAt));
      }
    }

    const [updated] = await db
      .update(posts)
      .set(updateData)
      .where(and(eq(posts.id, params.id), eq(posts.tenantId, tenantId)))
      .returning();

    return { post: updated };
  })
  // Delete post
  .delete("/:id", async ({ params, tenantId, set }: any) => {
    const [deleted] = await db
      .delete(posts)
      .where(and(eq(posts.id, params.id), eq(posts.tenantId, tenantId)))
      .returning({ id: posts.id });

    if (!deleted) {
      set.status = 404;
      return { error: "Post not found" };
    }

    await removeQueuedPost(tenantId, params.id);
    return { success: true };
  })
  // Schedule post
  .post("/:id/schedule", async ({ params, body, tenantId, set }: any) => {
    const { scheduledAt } = schedulePostSchema.parse(body);
    const [post] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.id, params.id), eq(posts.tenantId, tenantId)))
      .limit(1);

    if (!post) {
      set.status = 404;
      return { error: "Post not found" };
    }

    const [updated] = await db
      .update(posts)
      .set({ scheduledAt: new Date(scheduledAt), status: "scheduled", updatedAt: new Date() })
      .where(eq(posts.id, params.id))
      .returning();

    await enqueuePost(tenantId, params.id, new Date(scheduledAt));
    return { post: updated };
  })
  // Publish now
  .post("/:id/publish", async ({ params, tenantId, set }: any) => {
    const [post] = await db
      .select()
      .from(posts)
      .where(and(eq(posts.id, params.id), eq(posts.tenantId, tenantId)))
      .limit(1);

    if (!post) {
      set.status = 404;
      return { error: "Post not found" };
    }

    if (post.status === "published") {
      set.status = 400;
      return { error: "Post already published" };
    }

    // Mark as publishing — actual publishing handled by scheduler
    const [updated] = await db
      .update(posts)
      .set({ status: "publishing", updatedAt: new Date() })
      .where(eq(posts.id, params.id))
      .returning();

    return { post: updated, message: "Post queued for immediate publishing" };
  });
