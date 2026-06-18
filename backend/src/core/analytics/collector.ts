/**
 * Analytics collector — fetch engagement metrics from platform APIs.
 * Runs as a scheduled job (every hour).
 */

import { db } from '../../db/index.js';
import { posts, postAnalytics, socialAccounts } from '../../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { logger } from '../../lib/logger.js';
import { config } from '../../lib/config.js';
import { decryptToken } from '../../lib/encryption.js';

interface PlatformMetrics {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
}

/**
 * Fetch Instagram post insights.
 */
async function fetchInstagramMetrics(
  postId: string,
  accessToken: string
): Promise<PlatformMetrics | null> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v19.0/${postId}/insights?metric=impressions,reach,engagement,saved&access_token=${accessToken}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      data?: Array<{ name: string; values: Array<{ value: number }> }>;
    };

    const metrics = data.data || [];
    const getMetric = (name: string) =>
      metrics.find((m) => m.name === name)?.values[0]?.value || 0;

    return {
      impressions: getMetric('impressions'),
      reach: getMetric('reach'),
      likes: 0, // Need separate endpoint
      comments: 0,
      shares: 0,
      saves: getMetric('saved'),
      clicks: 0,
    };
  } catch (error) {
    logger.error({ error, postId }, 'Instagram metrics fetch failed');
    return null;
  }
}

/**
 * Fetch X (Twitter) post metrics.
 */
async function fetchXMetrics(
  tweetId: string,
  accessToken: string
): Promise<PlatformMetrics | null> {
  try {
    const response = await fetch(
      `https://api.x.com/2/tweets/${tweetId}?tweet.fields=public_metrics`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      data?: {
        public_metrics?: {
          impression_count: number;
          like_count: number;
          reply_count: number;
          retweet_count: number;
          bookmark_count: number;
        };
      };
    };

    const metrics = data.data?.public_metrics;
    if (!metrics) return null;

    return {
      impressions: metrics.impression_count || 0,
      reach: metrics.impression_count || 0,
      likes: metrics.like_count || 0,
      comments: metrics.reply_count || 0,
      shares: metrics.retweet_count || 0,
      saves: metrics.bookmark_count || 0,
      clicks: 0,
    };
  } catch (error) {
    logger.error({ error, tweetId }, 'X metrics fetch failed');
    return null;
  }
}

/**
 * Fetch LinkedIn post statistics.
 */
async function fetchLinkedInMetrics(
  postUrn: string,
  accessToken: string
): Promise<PlatformMetrics | null> {
  try {
    const response = await fetch(
      `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(postUrn)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      likesSummary?: { totalLikes: number };
      commentsSummary?: { totalFirstLevelComments: number };
    };

    return {
      impressions: 0,
      reach: 0,
      likes: data.likesSummary?.totalLikes || 0,
      comments: data.commentsSummary?.totalFirstLevelComments || 0,
      shares: 0,
      saves: 0,
      clicks: 0,
    };
  } catch (error) {
    logger.error({ error, postUrn }, 'LinkedIn metrics fetch failed');
    return null;
  }
}

/**
 * Collect metrics for all published posts across all tenants.
 */
export async function collectAllMetrics(): Promise<{
  processed: number;
  errors: number;
}> {
  let processed = 0;
  let errors = 0;

  try {
    // Get published posts from the last 30 days that haven't been updated recently
    const recentPosts = await db
      .select({
        id: posts.id,
        platform: posts.platform,
        platformPostId: posts.platformPostId,
        tenantId: posts.tenantId,
        socialAccountId: posts.socialAccountId,
      })
      .from(posts)
      .where(
        and(
          eq(posts.status, 'published'),
          sql`${posts.publishedAt} > now() - interval '30 days'`,
          sql`${posts.platformPostId} IS NOT NULL`
        )
      )
      .limit(500);

    for (const post of recentPosts) {
      if (!post.platformPostId || !post.socialAccountId) continue;

      try {
        // Get the social account credentials
        const [account] = await db
          .select()
          .from(socialAccounts)
          .where(eq(socialAccounts.id, post.socialAccountId))
          .limit(1);

        if (!account?.accessTokenEncrypted) continue;

        const accessToken = decryptToken(account.accessTokenEncrypted);
        let metrics: PlatformMetrics | null = null;

        switch (post.platform) {
          case 'instagram':
            metrics = await fetchInstagramMetrics(
              post.platformPostId,
              accessToken
            );
            break;
          case 'x':
            metrics = await fetchXMetrics(post.platformPostId, accessToken);
            break;
          case 'linkedin':
            metrics = await fetchLinkedInMetrics(
              post.platformPostId,
              accessToken
            );
            break;
          // TikTok, Facebook, Telegram: no public metrics API or different pattern
          default:
            continue;
        }

        if (metrics) {
          // Calculate engagement rate
          const totalEngagement =
            metrics.likes + metrics.comments + metrics.shares + metrics.saves;
          const engagementRate =
            metrics.impressions > 0
              ? (totalEngagement / metrics.impressions) * 100
              : 0;

          // Upsert analytics
          await db
            .insert(postAnalytics)
            .values({
              postId: post.id,
              platform: post.platform as any,
              impressions: metrics.impressions,
              reach: metrics.reach,
              engagementRate: Math.round(engagementRate * 100) / 100,
              likes: metrics.likes,
              comments: metrics.comments,
              shares: metrics.shares,
              clicks: metrics.clicks,
              saves: metrics.saves,
              fetchedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [postAnalytics.postId, postAnalytics.platform],
              set: {
                impressions: metrics.impressions,
                reach: metrics.reach,
                engagementRate: Math.round(engagementRate * 100) / 100,
                likes: metrics.likes,
                comments: metrics.comments,
                shares: metrics.shares,
                clicks: metrics.clicks,
                saves: metrics.saves,
                fetchedAt: new Date(),
              },
            });

          processed++;
        }
      } catch (error) {
        errors++;
        logger.error({ error, postId: post.id }, 'Metrics collection failed for post');
      }
    }

    logger.info({ processed, errors }, 'Metrics collection completed');
  } catch (error) {
    logger.error({ error }, 'Metrics collection batch failed');
  }

  return { processed, errors };
}
