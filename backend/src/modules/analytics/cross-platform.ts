import { db } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { posts, postAnalytics } from '../../db/schema.js';
import { eq, and, gte, lte, sql } from 'drizzle-orm';

export interface PlatformMetrics {
  platform: string;
  totalPosts: number;
  publishedPosts: number;
  totalLikes: number;
  totalShares: number;
  totalComments: number;
  totalImpressions: number;
  totalReach: number;
  engagementRate: number;
  topPost: { id: string; content: string | null; likes: number } | null;
}

const CACHE_TTL_SECONDS = 5 * 60;

export async function getCrossPlatformMetrics(
  tenantId: string,
  startDate?: Date,
  endDate?: Date,
): Promise<PlatformMetrics[]> {
  const now = new Date();
  const from = startDate ?? new Date(now.getTime() - 30 * 86400000);
  const to = endDate ?? now;

  const cacheKey = `analytics:cross-platform:${tenantId}:${from.toISOString()}:${to.toISOString()}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as PlatformMetrics[];
    } catch {
      return getCrossPlatformMetricsUncached(tenantId, from, to, cacheKey);
    }
  }

  return getCrossPlatformMetricsUncached(tenantId, from, to, cacheKey);
}

async function getCrossPlatformMetricsUncached(
  tenantId: string,
  from: Date,
  to: Date,
  cacheKey: string,
): Promise<PlatformMetrics[]> {
  const postCounts = await db
    .select({
      platform: posts.platform,
      total: sql<number>`count(*)::int`,
      published: sql<number>`count(*) filter (where ${posts.status} = 'published')::int`,
    })
    .from(posts)
    .where(
      and(
        eq(posts.tenantId, tenantId),
        gte(posts.createdAt, from),
        lte(posts.createdAt, to),
      ),
    )
    .groupBy(posts.platform);

  const analyticsData = await db
    .select({
      platform: postAnalytics.platform,
      totalLikes: sql<number>`coalesce(sum(${postAnalytics.likes}), 0)::int`,
      totalShares: sql<number>`coalesce(sum(${postAnalytics.shares}), 0)::int`,
      totalComments: sql<number>`coalesce(sum(${postAnalytics.comments}), 0)::int`,
      totalImpressions: sql<number>`coalesce(sum(${postAnalytics.impressions}), 0)::int`,
      totalReach: sql<number>`coalesce(sum(${postAnalytics.reach}), 0)::int`,
    })
    .from(postAnalytics)
    .innerJoin(posts, eq(postAnalytics.postId, posts.id))
    .where(
      and(
        eq(posts.tenantId, tenantId),
        gte(posts.createdAt, from),
        lte(posts.createdAt, to),
      ),
    )
    .groupBy(postAnalytics.platform);

  const topPostRows = await db.execute<{
    platform: string;
    id: string;
    content: string | null;
    likes: number;
  }>(sql`
    SELECT DISTINCT ON (pa.platform)
      pa.platform,
      p.id,
      p.content_text AS content,
      pa.likes
    FROM post_analytics pa
    INNER JOIN posts p ON pa.post_id = p.id
    WHERE p.tenant_id = ${tenantId}
      AND p.created_at >= ${from.toISOString()}
      AND p.created_at <= ${to.toISOString()}
    ORDER BY pa.platform, pa.engagement_rate DESC
  `);

  const topPostByPlatform = new Map<string, { id: string; content: string | null; likes: number }>();
  for (const tp of topPostRows) {
    if (tp.platform && !topPostByPlatform.has(tp.platform)) {
      topPostByPlatform.set(tp.platform, { id: tp.id, content: tp.content, likes: tp.likes });
    }
  }

  const platformMap = new Map<string, PlatformMetrics>();

  for (const pc of postCounts) {
    if (!pc.platform) continue;
    platformMap.set(pc.platform, {
      platform: pc.platform,
      totalPosts: pc.total,
      publishedPosts: pc.published,
      totalLikes: 0,
      totalShares: 0,
      totalComments: 0,
      totalImpressions: 0,
      totalReach: 0,
      engagementRate: 0,
      topPost: topPostByPlatform.get(pc.platform) ?? null,
    });
  }

  for (const ad of analyticsData) {
    const existing = platformMap.get(ad.platform);
    if (existing) {
      existing.totalLikes = ad.totalLikes;
      existing.totalShares = ad.totalShares;
      existing.totalComments = ad.totalComments;
      existing.totalImpressions = ad.totalImpressions;
      existing.totalReach = ad.totalReach;
      existing.engagementRate =
        ad.totalImpressions > 0
          ? ((ad.totalLikes + ad.totalShares + ad.totalComments) / ad.totalImpressions) * 100
          : 0;
    }
  }

  const result = [...platformMap.values()].sort((a, b) => b.totalImpressions - a.totalImpressions);

  await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);

  return result;
}
