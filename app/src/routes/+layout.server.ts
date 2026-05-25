import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ fetch }) => {
  try {
    const res = await fetch('/api/auth/session');
    if (res.ok) {
      const session = await res.json();
      return { user: session.user ?? null, mode: import.meta.env.PUBLIC_HIAI_MODE ?? 'standalone' };
    }
  } catch {}
  return { user: null, mode: import.meta.env.PUBLIC_HIAI_MODE ?? 'standalone' };
};
