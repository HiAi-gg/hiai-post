import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
  const [postsRes, accountsRes, queueRes, deadLetterRes] = await Promise.allSettled([
    fetch('/api/v1/posts?limit=10&status=scheduled').then(r => r.json()),
    fetch('/api/v1/accounts').then(r => r.json()),
    fetch('/api/v1/queue/status').then(r => r.json()),
    fetch('/api/v1/queue/dead-letter').then(r => r.json()),
  ]);

  const queueData = queueRes.status === 'fulfilled' ? queueRes.value ?? {} : {};
  const deadLetterData = deadLetterRes.status === 'fulfilled' ? deadLetterRes.value?.items ?? [] : [];

  // Count published from posts API
  const publishedRes = await Promise.allSettled([
    fetch('/api/v1/posts?limit=1&status=published').then(r => r.json()),
  ]);
  const publishedCount = publishedRes[0].status === 'fulfilled' ? publishedRes[0].value?.pagination?.total ?? 0 : 0;

  return {
    recentPosts: postsRes.status === 'fulfilled' ? postsRes.value?.data ?? [] : [],
    accounts: accountsRes.status === 'fulfilled' ? accountsRes.value?.data ?? [] : [],
    queueStatus: {
      pending: queueData.pending ?? 0,
      published: publishedCount,
      failed: deadLetterData.length,
    },
  };
};
