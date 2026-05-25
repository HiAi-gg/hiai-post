import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
  const res = await fetch('/api/v1/campaigns');
  const data = await res.json();
  return { campaigns: data.data || data || [] };
};
