import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
  console.error('[accounts page.server] start');
  try {
    const res = await fetch('/api/v1/accounts');
    console.error('[accounts page.server] status:', res.status);
    if (res.ok) {
      const body = await res.json();
      console.error('[accounts page.server] body keys:', Object.keys(body || {}));
      return { accounts: body.data ?? [] };
    }
  } catch (err) {
    console.error('[accounts page.server] error:', err);
  }
  return { accounts: [] };
};