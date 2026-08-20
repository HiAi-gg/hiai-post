import type { LayoutServerLoad } from "./$types";

/**
 * Resolves the session user for the UI shell.
 *
 * `/api/auth/get-session` is served by the Better Auth delegation route on
 * the backend (mounted outside the protected chain), so this works for
 * anonymous visitors too — it simply returns `user: null` when no session
 * exists. The session cookie is forwarded by the auth proxy; the hooks
 * bridge (`src/hooks.server.ts`) separately extracts the session token for
 * protected `/api/v1/*` calls.
 */
export const load: LayoutServerLoad = async ({ fetch }) => {
  try {
    const res = await fetch("/api/auth/get-session");
    if (res.ok) {
      const session = await res.json();
      return {
        user: session?.user ?? null,
        mode: import.meta.env.PUBLIC_HIAI_MODE || "standalone",
      };
    }
  } catch (err) {
    console.error(
      "[+layout.server] auth fetch failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
  return { user: null, mode: import.meta.env.PUBLIC_HIAI_MODE || "standalone" };
};
