/**
 * Analytics routes — engagement metrics and performance dashboard.
 *
 * Tenant scope comes exclusively from the authenticated principal
 * (`ctx.tenantId` set by tenantGuard). The `tenantId` query parameter
 * is intentionally no longer accepted, so one tenant cannot read another
 * tenant's analytics.
 */

import { and, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import {
  getOverviewMetrics,
  getPlatformBreakdown,
  getTopPosts,
} from "../../core/analytics/aggregator.js";
import { getBestPostingTimes, type Platform } from "../../core/analytics/best-time.js";
import { db } from "../../db/index.js";
import { postAnalytics, posts } from "../../db/schema.js";
import { logger } from "../../lib/logger.js";
import { getCrossPlatformMetrics } from "../../modules/analytics/cross-platform.js";
import { authGuard } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimiter.js";
import { requireViewer } from "../middleware/rbac.js";
import { tenantGuard } from "../middleware/tenant.js";

export function analyticsRoutes() {
  return new Elysia({ prefix: "/api/v1/analytics" })
    .use(createRateLimiter("authenticated") as any)
    .onBeforeHandle(authGuard)
    .onBeforeHandle(tenantGuard)
    .onBeforeHandle(requireViewer())

    .get(
      "/overview",
      async ({ tenantId, query, set }: any) => {
        try {
          const dateFrom = query.from ? new Date(query.from) : undefined;
          const dateTo = query.to ? new Date(query.to) : undefined;

          const metrics = await getOverviewMetrics(tenantId, dateFrom, dateTo);
          return { success: true, metrics };
        } catch (err) {
          set.status = 500;
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ error: message }, "Analytics overview error");
          return { error: message };
        }
      },
      {
        query: t.Object({
          from: t.Optional(t.String()),
          to: t.Optional(t.String()),
        }),
      }
    )

    .get(
      "/platforms",
      async ({ tenantId, query, set }: any) => {
        try {
          const dateFrom = query.from ? new Date(query.from) : undefined;
          const dateTo = query.to ? new Date(query.to) : undefined;

          const breakdown = await getPlatformBreakdown(tenantId, dateFrom, dateTo);
          return { success: true, platforms: breakdown };
        } catch (err) {
          set.status = 500;
          const message = err instanceof Error ? err.message : String(err);
          return { error: message };
        }
      },
      {
        query: t.Object({
          from: t.Optional(t.String()),
          to: t.Optional(t.String()),
        }),
      }
    )

    .get(
      "/posts/:postId",
      async ({ params, tenantId, set }: any) => {
        try {
          // Analytics for a single post, scoped to the caller's tenant: the
          // post must belong to the derived tenant, otherwise 404.
          const [post] = await db
            .select({ id: posts.id })
            .from(posts)
            .where(and(eq(posts.id, params.postId), eq(posts.tenantId, tenantId)))
            .limit(1);

          if (!post) {
            set.status = 404;
            return { error: "Post not found" };
          }

          const analytics = await db
            .select()
            .from(postAnalytics)
            .where(eq(postAnalytics.postId, params.postId));

          if (!analytics.length) {
            return {
              success: true,
              analytics: [],
              message: "No analytics data yet",
            };
          }

          return { success: true, analytics };
        } catch (err) {
          set.status = 500;
          const message = err instanceof Error ? err.message : String(err);
          return { error: message };
        }
      },
      {
        params: t.Object({
          postId: t.String(),
        }),
      }
    )

    .get(
      "/top-posts",
      async ({ tenantId, query, set }: any) => {
        try {
          const limit = query.limit ? parseInt(query.limit, 10) : 10;
          const dateFrom = query.from ? new Date(query.from) : undefined;
          const dateTo = query.to ? new Date(query.to) : undefined;

          const topPosts = await getTopPosts(tenantId, limit, dateFrom, dateTo);
          return { success: true, posts: topPosts };
        } catch (err) {
          set.status = 500;
          const message = err instanceof Error ? err.message : String(err);
          return { error: message };
        }
      },
      {
        query: t.Object({
          limit: t.Optional(t.String()),
          from: t.Optional(t.String()),
          to: t.Optional(t.String()),
        }),
      }
    )

    .get(
      "/best-times",
      async ({ tenantId, query, set }: any) => {
        try {
          const platform = query.platform as Platform | undefined;
          const slots = await getBestPostingTimes(tenantId, platform);
          return { success: true, slots };
        } catch (err) {
          set.status = 500;
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ error: message }, "Best posting times error");
          return { error: message };
        }
      },
      {
        query: t.Object({
          platform: t.Optional(t.String()),
        }),
      }
    )

    .get(
      "/cross-platform",
      async ({ tenantId, query, set }: any) => {
        try {
          const dateFrom = query.from ? new Date(query.from) : undefined;
          const dateTo = query.to ? new Date(query.to) : undefined;

          const metrics = await getCrossPlatformMetrics(tenantId, dateFrom, dateTo);
          return { success: true, metrics };
        } catch (err) {
          set.status = 500;
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ error: message }, "Cross-platform analytics error");
          return { error: message };
        }
      },
      {
        query: t.Object({
          from: t.Optional(t.String()),
          to: t.Optional(t.String()),
        }),
      }
    );
}
