/**
 * Analytics aggregator — cross-platform metrics aggregation.
 */

import { db } from '../../db/index.js';
import { posts, postAnalytics } from '../../db/schema.js';
import { eq, and, sql, gte, lte } from 'drizzle-orm';

export interface OverviewMetrics {
  totalPosts: number;
  publishedPosts: number;
  scheduledPosts: number;
  draftPosts: number;
  totalImpressions: number;
  totalReach: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalClicks: number;
  totalSaves: number;
  averageEngagementRate: number;
  topPlatform: string;
  bestPostingTime: string;
}

export interface PlatformBreakdown {
  platform: string;
  posts: number;
  impressions: number;
  reach: number;
  engagement: number;
  likes: number;
  comments: number;
  shares: number;
}

export interface PostPerformance {
  postId: string;
  platform: string;
  contentPreview: string;
  publishedAt: string;
  impressions: number;
  reach: number;
  engagementRate: number;
  likes: number;
  comments: number;
  shares: number;
}

/**
 * Get aggregated overview metrics for a tenant.
 */
export async function getOverviewMetrics(
  tenantId: string,
  dateFrom?: Date,
  dateTo?: Date
): Promise<OverviewMetrics> {
  const now = new Date();
  const from = dateFrom || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = dateTo || now;

  // Post counts by status
  const postCounts = await db
    .select({
      status: posts.status,
      count: sql<number>`count(*)::int`,
    })
    .from(posts)
    .where(
      and(
        eq(posts.tenantId, tenantId),
        gte(posts.createdAt, from),
        lte(posts.createdAt, to)
      )
    )
    .groupBy(posts.status);

  const totalPosts = postCounts.reduce((sum, r) => sum + r.count, 0);
  const publishedPosts =
    postCounts.find((r) => r.status === 'published')?.count || 0;
  const scheduledPosts =
    postCounts.find((r) => r.status === 'scheduled')?.count || 0;
  const draftPosts =
    postCounts.find((r) => r.status === 'draft')?.count || 0;

  // Aggregated metrics from analytics
  const metricsAgg = await db
    .select({
      totalImpressions: sql<number>`coalesce(sum(${postAnalytics.impressions}), 0)::int`,
      totalReach: sql<number>`coalesce(sum(${postAnalytics.reach}), 0)::int`,
      totalLikes: sql<number>`coalesce(sum(${postAnalytics.likes}), 0)::int`,
      totalComments: sql<number>`coalesce(sum(${postAnalytics.comments}), 0)::int`,
      totalShares: sql<number>`coalesce(sum(${postAnalytics.shares}), 0)::int`,
      totalClicks: sql<number>`coalesce(sum(${postAnalytics.clicks}), 0)::int`,
      totalSaves: sql<number>`coalesce(sum(${postAnalytics.saves}), 0)::int`,
      avgEngagement:
        sql<number>`coalesce(avg(${postAnalytics.engagementRate}), 0)::float`,
    })
    .from(postAnalytics)
    .innerJoin(posts, eq(postAnalytics.postId, posts.id))
    .where(
      and(
        eq(posts.tenantId, tenantId),
        gte(postAnalytics.fetchedAt, from),
        lte(postAnalytics.fetchedAt, to)
      )
    );

  const metrics = metricsAgg[0];

  // Top platform by engagement
  const platformMetrics = await db
    .select({
      platform: postAnalytics.platform,
      totalEngagement:
        sql<number>`(sum(${postAnalytics.likes}) + sum(${postAnalytics.comments}) + sum(${postAnalytics.shares}))::int`,
    })
    .from(postAnalytics)
    .innerJoin(posts, eq(postAnalytics.postId, posts.id))
    .where(
      and(
        eq(posts.tenantId, tenantId),
        gte(postAnalytics.fetchedAt, from)
      )
    )
    .groupBy(postAnalytics.platform)
    .orderBy(
      sql`(sum(${postAnalytics.likes}) + sum(${postAnalytics.comments}) + sum(${postAnalytics.shares})) desc`
    )
    .limit(1);

  const topPlatform = platformMetrics[0]?.platform || 'none';

  // Best posting time (hour with highest avg engagement)
  const bestTime = await db
    .select({
      hour: sql<number>`extract(hour from ${posts.publishedAt})::int`,
      avgEngagement: sql<number>`avg(${postAnalytics.engagementRate})::float`,
    })
    .from(posts)
    .innerJoin(postAnalytics, eq(posts.id, postAnalytics.postId))
    .where(
      and(
        eq(posts.tenantId, tenantId),
        eq(posts.status, 'published'),
        gte(posts.publishedAt, from)
      )
    )
    .groupBy(sql`extract(hour from ${posts.publishedAt})`)
    .orderBy(sql`avg(${postAnalytics.engagementRate}) desc`)
    .limit(1);

  const bestPostingTime =
    bestTime[0] !== undefined ? `${bestTime[0].hour}:00 UTC` : 'N/A';

  return {
    totalPosts,
    publishedPosts,
    scheduledPosts,
    draftPosts,
    totalImpressions: metrics?.totalImpressions || 0,
    totalReach: metrics?.totalReach || 0,
    totalLikes: metrics?.totalLikes || 0,
    totalComments: metrics?.totalComments || 0,
    totalShares: metrics?.totalShares || 0,
    totalClicks: metrics?.totalClicks || 0,
    totalSaves: metrics?.totalSaves || 0,
    averageEngagementRate: Math.round((metrics?.avgEngagement || 0) * 100) / 100,
    topPlatform,
    bestPostingTime,
  };
}

/**
 * Get platform breakdown for a tenant.
 */
export async function getPlatformBreakdown(
  tenantId: string,
  dateFrom?: Date,
  dateTo?: Date
): Promise<PlatformBreakdown[]> {
  const now = new Date();
  const from = dateFrom || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = dateTo || now;

  const results = await db
    .select({
      platform: postAnalytics.platform,
      posts: sql<number>`count(distinct ${posts.id})::int`,
      impressions: sql<number>`coalesce(sum(${postAnalytics.impressions}), 0)::int`,
      reach: sql<number>`coalesce(sum(${postAnalytics.reach}), 0)::int`,
      likes: sql<number>`coalesce(sum(${postAnalytics.likes}), 0)::int`,
      comments: sql<number>`coalesce(sum(${postAnalytics.comments}), 0)::int`,
      shares: sql<number>`coalesce(sum(${postAnalytics.shares}), 0)::int`,
    })
    .from(postAnalytics)
    .innerJoin(posts, eq(postAnalytics.postId, posts.id))
    .where(
      and(
        eq(posts.tenantId, tenantId),
        gte(postAnalytics.fetchedAt, from),
        lte(postAnalytics.fetchedAt, to)
      )
    )
    .groupBy(postAnalytics.platform)
    .orderBy(sql`sum(${postAnalytics.impressions}) desc`);

  return results.map((r) => ({
    platform: (r.platform ?? '') || 'unknown',
    posts: r.posts,
    impressions: r.impressions,
    reach: r.reach,
    engagement: r.likes + r.comments + r.shares,
    likes: r.likes,
    comments: r.comments,
    shares: r.shares,
  }));
}

/**
 * Get top performing posts.
 */
export async function getTopPosts(
  tenantId: string,
  limit = 10,
  dateFrom?: Date,
  dateTo?: Date
): Promise<any[]> {
  const now = new Date();
  const from = dateFrom || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = dateTo || now;

  const results = await db
    .select({
      postId: posts.id,
      platform: posts.platform,
      contentText: posts.contentText,
      publishedAt: posts.publishedAt,
      impressions: postAnalytics.impressions,
      reach: postAnalytics.reach,
      engagementRate: postAnalytics.engagementRate,
      likes: postAnalytics.likes,
      comments: postAnalytics.comments,
      shares: postAnalytics.shares,
    })
    .from(posts)
    .innerJoin(postAnalytics, eq(posts.id, postAnalytics.postId))
    .where(
      and(
        eq(posts.tenantId, tenantId),
        eq(posts.status, 'published'),
        gte(posts.publishedAt, from),
        lte(posts.publishedAt, to)
      )
    )
    .orderBy(sql`${postAnalytics.engagementRate} desc`)
    .limit(limit);

  return results.map((r) => ({
    postId: r.postId,
    platform: (r.platform ?? '') || 'unknown',
    contentPreview: (r.contentText || '').slice(0, 100) + '...',
    publishedAt: r.publishedAt instanceof Date ? r.publishedAt.toISOString() : '',
    impressions: r.impressions || 0,
    reach: r.reach || 0,
    engagementRate: r.engagementRate || 0,
    likes: r.likes || 0,
    comments: r.comments || 0,
    shares: r.shares || 0,
  }));
}

/**
 * Get best posting times based on historical engagement data.
 */
export async function getBestTimes(
  tenantId: string,
  dateFrom?: Date,
  dateTo?: Date
): Promise<Array<{ hour: number; dayOfWeek: number; avgEngagement: number; postCount: number }>> {
  const now = new Date();
  const from = dateFrom || new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const to = dateTo || now;

  const results = await db
    .select({
      hour: sql<number>`extract(hour from ${posts.publishedAt})::int`,
      dayOfWeek: sql<number>`extract(dow from ${posts.publishedAt})::int`,
      avgEngagement: sql<number>`coalesce(avg(${postAnalytics.engagementRate}), 0)::float`,
      postCount: sql<number>`count(*)::int`,
    })
    .from(posts)
    .innerJoin(postAnalytics, eq(posts.id, postAnalytics.postId))
    .where(
      and(
        eq(posts.tenantId, tenantId),
        eq(posts.status, 'published'),
        gte(posts.publishedAt, from),
        lte(posts.publishedAt, to)
      )
    )
    .groupBy(
      sql`extract(hour from ${posts.publishedAt})`,
      sql`extract(dow from ${posts.publishedAt})`
    )
    .orderBy(sql`avg(${postAnalytics.engagementRate}) desc`)
    .limit(20);

  return results.map((r) => ({
    hour: r.hour,
    dayOfWeek: r.dayOfWeek,
    avgEngagement: Math.round(r.avgEngagement * 100) / 100,
    postCount: r.postCount,
  }));
}
