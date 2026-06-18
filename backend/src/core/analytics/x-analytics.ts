/**
 * X (Twitter) Analytics client — fetch tweet engagement metrics via API v2.
 */

import { logger } from '../../lib/logger.js';

export interface PostAnalytics {
  postId: string;
  platform: string;
  impressions: number;
  reach: number;
  engagementRate: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  saves: number;
  fetchedAt: Date;
}

function computeEngagementRate(metrics: { likes: number; replies: number; retweets: number; bookmarks: number; impressions: number }): number {
  const totalEngagement = metrics.likes + metrics.replies + metrics.retweets + metrics.bookmarks;
  return metrics.impressions > 0 ? Math.round((totalEngagement / metrics.impressions) * 10000) / 100 : 0;
}

/**
 * Fetch X tweet analytics via API v2.
 */
export async function fetchXAnalytics(
  tweetId: string,
  bearerToken: string,
): Promise<PostAnalytics | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const url = `https://api.x.com/2/tweets/${tweetId}?tweet.fields=public_metrics,non_public_metrics`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${bearerToken}` },
      signal: controller.signal,
    });

    if (response.status === 429) {
      logger.warn({ tweetId }, 'X API rate limited (429)');
      return null;
    }

    if (!response.ok) {
      logger.error({ status: response.status, tweetId }, 'X analytics fetch failed');
      return null;
    }

    const json = (await response.json()) as {
      data?: {
        public_metrics?: {
          impression_count?: number;
          like_count?: number;
          reply_count?: number;
          retweet_count?: number;
          quote_count?: number;
          bookmark_count?: number;
        };
      };
    };

    const metrics = json.data?.public_metrics;
    if (!metrics) {
      logger.warn({ tweetId }, 'X analytics returned no metrics data');
      return null;
    }

    const impressions = metrics.impression_count ?? 0;
    const likes = metrics.like_count ?? 0;
    const replies = metrics.reply_count ?? 0;
    const retweets = metrics.retweet_count ?? 0;
    const bookmarks = metrics.bookmark_count ?? 0;
    const engagementRate = computeEngagementRate({ likes, replies, retweets, bookmarks, impressions });

    return {
      postId: tweetId,
      platform: 'x',
      impressions,
      reach: impressions,
      engagementRate,
      likes,
      comments: replies,
      shares: retweets + (metrics.quote_count ?? 0),
      clicks: 0,
      saves: bookmarks,
      fetchedAt: new Date(),
    };
  } catch (error) {
    logger.error({ error, tweetId }, 'X analytics fetch error');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
