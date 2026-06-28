import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ fetch }) => {
  console.error('[+layout.server] start');
  try {
    const res = await fetch('/api/auth/get-session');
    console.error('[+layout.server] auth status:', res.status);
    if (res.ok) {
      const session = await res.json();
      console.error('[+layout.server] session:', JSON.stringify(session));
      return { user: session?.user ?? null, mode: import.meta.env.PUBLIC_HIAI_MODE || 'standalone' };
    }
  } catch (err) {
    console.error('[+layout.server] auth fetch failed:', err instanceof Error ? err.message : String(err));
  }
  console.error('[+layout.server] returning anon');
  return { user: null, mode: import.meta.env.PUBLIC_HIAI_MODE || 'standalone' };
};