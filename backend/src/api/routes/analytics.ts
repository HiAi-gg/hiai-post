/**
 * Analytics routes — engagement metrics and performance dashboard.
 */

import { Elysia, t } from 'elysia';
import {
  getOverviewMetrics,
  getPlatformBreakdown,
  getTopPosts,
} from '../../core/analytics/aggregator.js';
import { getCrossPlatformMetrics } from '../../modules/analytics/cross-platform.js';
import { getBestPostingTimes, type Platform } from '../../core/analytics/best-time.js';
import { logger } from '../../lib/logger.js';

export function analyticsRoutes() {
  return new Elysia({ prefix: '/api/v1/analytics' })
    .get(
      '/overview',
      async ({ query, set }) => {
        try {
          const tenantId = query.tenantId;
          if (!tenantId) {
            set.status = 400;
            return { error: 'tenantId is required' };
          }

          const dateFrom = query.from ? new Date(query.from) : undefined;
          const dateTo = query.to ? new Date(query.to) : undefined;

          const metrics = await getOverviewMetrics(tenantId, dateFrom, dateTo);
          return { success: true, metrics };
        } catch (err) {
          set.status = 500;
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ error: message }, 'Analytics overview error');
          return { error: message };
        }
      },
      {
        query: t.Object({
          tenantId: t.String(),
          from: t.Optional(t.String()),
          to: t.Optional(t.String()),
        }),
      }
    )

    .get(
      '/platforms',
      async ({ query, set }) => {
        try {
          const tenantId = query.tenantId;
          if (!tenantId) {
            set.status = 400;
            return { error: 'tenantId is required' };
          }

          const dateFrom = query.from ? new Date(query.from) : undefined;
          const dateTo = query.to ? new Date(query.to) : undefined;

          const breakdown = await getPlatformBreakdown(
            tenantId,
            dateFrom,
            dateTo
          );
          return { success: true, platforms: breakdown };
        } catch (err) {
          set.status = 500;
          const message = err instanceof Error ? err.message : String(err);
          return { error: message };
        }
      },
      {
        query: t.Object({
          tenantId: t.String(),
          from: t.Optional(t.String()),
          to: t.Optional(t.String()),
        }),
      }
    )

    .get(
      '/posts/:postId',
      async ({ params, set }) => {
        try {
          // Get analytics for a single post
          const { postId } = params;

          // Direct query for single post analytics
          const { db } = await import('../../db/index.js');
          const { postAnalytics } = await import('../../db/schema.js');
          const { eq } = await import('drizzle-orm');

          const analytics = await db
            .select()
            .from(postAnalytics)
            .where(eq(postAnalytics.postId, postId));

          if (!analytics.length) {
            return {
              success: true,
              analytics: [],
              message: 'No analytics data yet',
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
      '/top-posts',
      async ({ query, set }) => {
        try {
          const tenantId = query.tenantId;
          if (!tenantId) {
            set.status = 400;
            return { error: 'tenantId is required' };
          }

          const limit = query.limit ? parseInt(query.limit) : 10;
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
          tenantId: t.String(),
          limit: t.Optional(t.String()),
          from: t.Optional(t.String()),
          to: t.Optional(t.String()),
        }),
      }
    )

    .get(
      '/best-times',
      async ({ query, set }) => {
        try {
          const tenantId = query.tenantId;
          if (!tenantId) {
            set.status = 400;
            return { error: 'tenantId is required' };
          }

          const platform = query.platform as Platform | undefined;
          const slots = await getBestPostingTimes(tenantId, platform);
          return { success: true, slots };
        } catch (err) {
          set.status = 500;
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ error: message }, 'Best posting times error');
          return { error: message };
        }
      },
      {
        query: t.Object({
          tenantId: t.String(),
          platform: t.Optional(t.String()),
        }),
      }
    )

    .get(
      '/cross-platform',
      async ({ query, set }) => {
        try {
          const tenantId = query.tenantId;
          if (!tenantId) {
            set.status = 400;
            return { error: 'tenantId is required' };
          }

          const dateFrom = query.from ? new Date(query.from) : undefined;
          const dateTo = query.to ? new Date(query.to) : undefined;

          const metrics = await getCrossPlatformMetrics(tenantId, dateFrom, dateTo);
          return { success: true, metrics };
        } catch (err) {
          set.status = 500;
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ error: message }, 'Cross-platform analytics error');
          return { error: message };
        }
      },
      {
        query: t.Object({
          tenantId: t.String(),
          from: t.Optional(t.String()),
          to: t.Optional(t.String()),
        }),
      }
    );
}
