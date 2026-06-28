/**
 * Instagram Analytics client — fetch post engagement metrics via Graph API v19.0.
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

function getMetric(
  data: Array<{ name: string; values: Array<{ value: number }> }>,
  name: string
): number {
  return data.find((m) => m.name === name)?.values[0]?.value ?? 0;
}

function computeEngagementRate(metrics: {
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  impressions: number;
}): number {
  const totalEngagement = metrics.likes + metrics.comments + metrics.shares + metrics.saves;
  return metrics.impressions > 0
    ? Math.round((totalEngagement / metrics.impressions) * 10000) / 100
    : 0;
}

/**
 * Fetch Instagram post insights from the Graph API.
 */
export async function fetchInstagramInsights(
  mediaId: string,
  accessToken: string,
  metrics?: string[]
): Promise<PostAnalytics | null> {
  const defaultMetrics = "impressions,reach,engagement,likes,comments,shares,saved";
  const metricParam = metrics ? metrics.join(",") : defaultMetrics;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const url = `https://graph.facebook.com/v19.0/${mediaId}/insights?metric=${metricParam}&access_token=${accessToken}`;
    const response = await fetch(url, { signal: controller.signal });

    if (response.status === 429) {
      logger.warn({ mediaId }, "Instagram API rate limited (429)");
      return null;
    }

    if (!response.ok) {
      logger.error({ status: response.status, mediaId }, "Instagram insights fetch failed");
      return null;
    }

    const json = (await response.json()) as {
      data?: Array<{ name: string; values: Array<{ value: number }> }>;
    };

    const data = json.data ?? [];
    const impressions = getMetric(data, "impressions");
    const reach = getMetric(data, "reach");
    const likes = getMetric(data, "likes");
    const comments = getMetric(data, "comments");
    const shares = getMetric(data, "shares");
    const saves = getMetric(data, "saved");

    const engagementRate = computeEngagementRate({ likes, comments, shares, saves, impressions });

    return {
      postId: mediaId,
      platform: "instagram",
      impressions,
      reach,
      engagementRate,
      likes,
      comments,
      shares,
      clicks: 0,
      saves,
      fetchedAt: new Date(),
    };
  } catch (error) {
    logger.error({ error, mediaId }, "Instagram insights fetch error");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
