import { isAuthenticatedRequest } from "$lib/server/bridge";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ fetch, locals, request }) => {
  if (!isAuthenticatedRequest(request, locals)) {
    return {
      recentPosts: [],
      accounts: [],
      queueStatus: { pending: 0, published: 0, failed: 0 },
      summary: { totalPosts: 0, scheduled: 0, published: 0, connectedAccounts: 0 },
    };
  }

  const tenantId = locals.tenantId;
  const tenantQuery = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";

  const [postsRes, accountsRes, queueRes, deadLetterRes] = await Promise.allSettled([
    fetch("/api/v1/posts?limit=10&status=scheduled").then((r) => r.json()),
    fetch("/api/v1/accounts").then((r) => r.json()),
    // Queue endpoints read the workspace from the query string (backend
    // contract) — skipped when no tenant is resolved (e.g. no session).
    tenantQuery
      ? fetch(`/api/v1/queue/status${tenantQuery}`).then((r) => r.json())
      : Promise.resolve(null),
    tenantQuery
      ? fetch(`/api/v1/queue/dead-letter${tenantQuery}`).then((r) => r.json())
      : Promise.resolve(null),
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
  const accountsList =
    accountsRes.status === "fulfilled" ? (accountsRes.value?.accounts ?? []) : [];
  const connectedAccountsCount = accountsList.filter((a: any) => a.status === "active").length;

  return {
    recentPosts: postsRes.status === "fulfilled" ? (postsRes.value?.posts ?? []) : [],
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
