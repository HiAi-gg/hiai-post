import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ fetch }) => {
  const [postsRes, accountsRes, queueRes, deadLetterRes] = await Promise.allSettled([
    fetch("/api/v1/posts?limit=10&status=scheduled").then((r) => r.json()),
    fetch("/api/v1/accounts").then((r) => r.json()),
    fetch("/api/v1/queue/status").then((r) => r.json()),
    fetch("/api/v1/queue/dead-letter").then((r) => r.json()),
  ]);

  const queueData = queueRes.status === "fulfilled" ? (queueRes.value ?? {}) : {};
  const deadLetterData =
    deadLetterRes.status === "fulfilled" ? (deadLetterRes.value?.items ?? []) : [];

  // Count posts by status (total / scheduled / published)
  const [scheduledRes, publishedRes, totalRes] = await Promise.allSettled([
    fetch("/api/v1/posts?limit=1&status=scheduled").then((r) => r.json()),
    fetch("/api/v1/posts?limit=1&status=published").then((r) => r.json()),
    fetch("/api/v1/posts?limit=1").then((r) => r.json()),
  ]);

  const scheduledCount =
    scheduledRes.status === "fulfilled" ? (scheduledRes.value?.pagination?.total ?? 0) : 0;
  const publishedCount =
    publishedRes.status === "fulfilled" ? (publishedRes.value?.pagination?.total ?? 0) : 0;
  const totalPosts = totalRes.status === "fulfilled" ? (totalRes.value?.pagination?.total ?? 0) : 0;

  // Connected accounts: status === 'active' (matches page logic on connectedPlatforms)
  const accountsList = accountsRes.status === "fulfilled" ? (accountsRes.value?.data ?? []) : [];
  const connectedAccountsCount = accountsList.filter((a: any) => a.status === "active").length;

  return {
    recentPosts: postsRes.status === "fulfilled" ? (postsRes.value?.data ?? []) : [],
    accounts: accountsList,
    queueStatus: {
      pending: queueData.pending ?? 0,
      published: publishedCount,
      failed: deadLetterData.length,
    },
    summary: {
      totalPosts,
      scheduled: scheduledCount,
      published: publishedCount,
      connectedAccounts: connectedAccountsCount,
    },
  };
};
