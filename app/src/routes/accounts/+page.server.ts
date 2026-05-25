import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
  try {
    const res = await fetch('/api/v1/accounts');
    if (res.ok) {
      const body = await res.json();
      return { accounts: body.data ?? [] };
    }
  } catch {}
  return { accounts: [] };
};
