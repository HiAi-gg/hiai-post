/**
 * Best posting time analysis — query historical engagement data
 * to find optimal posting times per platform.
 */

import { db } from '../../db/index.js';
import { posts, postAnalytics } from '../../db/schema.js';
import { eq, and, gte, lte, sql } from 'drizzle-orm';

export interface BestTimeSlot {
  platform: string;
  hour: number;
  dayOfWeek: number;
  avgEngagementRate: number;
  postCount: number;
}

export type Platform = 'instagram' | 'x' | 'linkedin' | 'tiktok' | 'facebook' | 'telegram' | 'threads' | 'pinterest' | 'youtube';

/**
 * Get best posting times based on historical engagement data for a tenant.
 * Returns top 3 best times per platform.
 */
export async function getBestPostingTimes(
  tenantId: string,
  platform?: Platform,
): Promise<BestTimeSlot[]> {
  const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const to = new Date();

  const conditions = and(
    eq(posts.tenantId, tenantId),
    eq(posts.status, 'published'),
    gte(posts.publishedAt, from),
    lte(posts.publishedAt, to),
    platform ? eq(posts.platform, platform) : undefined,
  );

  const results = await db
    .select({
      platform: posts.platform,
      hour: sql<number>`extract(hour from ${posts.publishedAt})::int`,
      dayOfWeek: sql<number>`extract(dow from ${posts.publishedAt})::int`,
      avgEngagementRate: sql<number>`coalesce(avg(${postAnalytics.engagementRate}), 0)::float`,
      postCount: sql<number>`count(*)::int`,
    })
    .from(posts)
    .innerJoin(postAnalytics, eq(posts.id, postAnalytics.postId))
    .where(conditions)
    .groupBy(
      posts.platform,
      sql`extract(hour from ${posts.publishedAt})`,
      sql`extract(dow from ${posts.publishedAt})`,
    );

  // Group by platform and rank by avgEngagementRate, take top 3 per platform
  const platformGroups = new Map<string, BestTimeSlot[]>();

  for (const row of results) {
    if (!row.platform) continue;
    const slot: BestTimeSlot = {
      platform: row.platform,
      hour: row.hour,
      dayOfWeek: row.dayOfWeek,
      avgEngagementRate: Math.round(row.avgEngagementRate * 100) / 100,
      postCount: row.postCount,
    };

    const group = platformGroups.get(row.platform) ?? [];
    group.push(slot);
    platformGroups.set(row.platform, group);
  }

  const best: BestTimeSlot[] = [];
  for (const [, slots] of platformGroups) {
    slots.sort((a, b) => b.avgEngagementRate - a.avgEngagementRate);
    best.push(...slots.slice(0, 3));
  }

  return best.sort((a, b) => a.platform.localeCompare(b.platform) || b.avgEngagementRate - a.avgEngagementRate);
}
