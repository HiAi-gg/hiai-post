/**
 * LinkedIn Analytics client — fetch share engagement metrics via Marketing API.
 */

import { logger } from "../../lib/logger.js";

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

function computeEngagementRate(metrics: {
  likes: number;
  comments: number;
  shares: number;
  impressions: number;
}): number {
  const totalEngagement = metrics.likes + metrics.comments + metrics.shares;
  return metrics.impressions > 0
    ? Math.round((totalEngagement / metrics.impressions) * 10000) / 100
    : 0;
}

interface SocialActionsResponse {
  likesSummary?: { totalLikes?: number };
  commentsSummary?: { totalFirstLevelComments?: number };
}

/**
 * Fetch LinkedIn share analytics via socialActions endpoint.
 */
export async function fetchLinkedInAnalytics(
  shareId: string,
  accessToken: string
): Promise<PostAnalytics | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const encodedShareId = encodeURIComponent(shareId);
    const url = `https://api.linkedin.com/v2/socialActions/${encodedShareId}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      signal: controller.signal,
    });

    if (response.status === 429) {
      logger.warn({ shareId }, "LinkedIn API rate limited (429)");
      return null;
    }

    if (!response.ok) {
      logger.error({ status: response.status, shareId }, "LinkedIn analytics fetch failed");
      return null;
    }

    const data = (await response.json()) as SocialActionsResponse;
    const likes = data.likesSummary?.totalLikes ?? 0;
    const comments = data.commentsSummary?.totalFirstLevelComments ?? 0;
    const engagementRate = computeEngagementRate({ likes, comments, shares: 0, impressions: 0 });

    return {
      postId: shareId,
      platform: "linkedin",
      impressions: 0,
      reach: 0,
      engagementRate,
      likes,
      comments,
      shares: 0,
      clicks: 0,
      saves: 0,
      fetchedAt: new Date(),
    };
  } catch (error) {
    logger.error({ error, shareId }, "LinkedIn analytics fetch error");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
