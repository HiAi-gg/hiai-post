import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, url }) => {
  const tenantId = url.searchParams.get('tenantId') || '';
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';

  const qs = new URLSearchParams();
  if (tenantId) qs.set('tenantId', tenantId);
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const query = qs.toString();

  const [overviewRes, platformsRes, topPostsRes, postsRes] = await Promise.allSettled([
    fetch(`/api/v1/analytics/overview?${query}`).then(r => r.json()),
    fetch(`/api/v1/analytics/platforms?${query}`).then(r => r.json()),
    fetch(`/api/v1/analytics/top-posts?${query}&limit=10`).then(r => r.json()),
    fetch(`/api/v1/posts?limit=50&status=published`).then(r => r.json()),
  ]);

  const overview = overviewRes.status === 'fulfilled' ? overviewRes.value?.metrics ?? {} : {};
  const platforms = platformsRes.status === 'fulfilled' ? platformsRes.value?.platforms ?? [] : [];
  const topPosts = topPostsRes.status === 'fulfilled' ? topPostsRes.value?.posts ?? [] : [];
  const recentPosts = postsRes.status === 'fulfilled' ? postsRes.value?.data ?? [] : [];

  // Build engagement timeline from recent posts (group by day)
  const timeline: Record<string, { impressions: number; reach: number; engagement: number; count: number }> = {};
  for (const post of recentPosts) {
    const day = post.publishedAt ? new Date(post.publishedAt).toISOString().slice(0, 10) : 'unknown';
    if (!timeline[day]) timeline[day] = { impressions: 0, reach: 0, engagement: 0, count: 0 };
    timeline[day].count++;
  }
  const timelineData = Object.entries(timeline)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, ...d }));

  // Best posting times (extract hour from published posts)
  const hourCounts: Record<number, number> = {};
  for (const post of recentPosts) {
    if (post.publishedAt) {
      const hour = new Date(post.publishedAt).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    }
  }
  const bestHours = Object.entries(hourCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([hour, count]) => ({ hour: parseInt(hour), count }));

  return {
    overview: {
      totalPosts: overview.totalPosts ?? 0,
      published: overview.publishedPosts ?? 0,
      scheduled: overview.scheduledPosts ?? 0,
      draft: overview.draftPosts ?? 0,
      engagementRate: overview.averageEngagementRate ?? 0,
      totalReach: overview.totalReach ?? 0,
      totalImpressions: overview.totalImpressions ?? 0,
      totalLikes: overview.totalLikes ?? 0,
      totalComments: overview.totalComments ?? 0,
      totalShares: overview.totalShares ?? 0,
      topPlatform: overview.topPlatform ?? 'none',
      bestPostingTime: overview.bestPostingTime ?? 'N/A',
    },
    platforms,
    topPosts,
    timeline: timelineData,
    bestHours,
    tenantId,
  };
};
