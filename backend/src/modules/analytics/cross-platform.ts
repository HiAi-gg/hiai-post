import { db } from '../../lib/db.js';
import { posts, postAnalytics } from '../../db/schema.js';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';

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

export async function getCrossPlatformMetrics(
  tenantId: string,
  startDate?: Date,
  endDate?: Date,
): Promise<PlatformMetrics[]> {
  const now = new Date();
  const from = startDate ?? new Date(now.getTime() - 30 * 86400000); // default 30 days
  const to = endDate ?? now;

  // Aggregate post counts per platform
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

  // Aggregate analytics per platform
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

  // Get top post per platform
  const topPosts = await db
    .select({
      platform: posts.platform,
      id: posts.id,
      content: posts.contentText,
      likes: sql<number>`coalesce(${postAnalytics.likes}, 0)::int`,
    })
    .from(posts)
    .leftJoin(postAnalytics, eq(posts.id, postAnalytics.postId))
    .where(
      and(
        eq(posts.tenantId, tenantId),
        gte(posts.createdAt, from),
        lte(posts.createdAt, to),
      ),
    )
    .orderBy(desc(sql`coalesce(${postAnalytics.likes}, 0)`));

  const topPostByPlatform = new Map<string, { id: string; content: string | null; likes: number }>();
  for (const tp of topPosts) {
    if (tp.platform && !topPostByPlatform.has(tp.platform)) {
      topPostByPlatform.set(tp.platform, { id: tp.id, content: tp.content, likes: tp.likes });
    }
  }

  // Merge data
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

  return [...platformMap.values()].sort((a, b) => b.totalImpressions - a.totalImpressions);
}
