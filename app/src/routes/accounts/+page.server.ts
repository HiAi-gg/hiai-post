import { isAuthenticatedRequest } from "$lib/server/bridge";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ fetch, request, locals }) => {
  if (!isAuthenticatedRequest(request, locals)) {
    return { accounts: [] };
  }

  try {
    const res = await fetch("/api/v1/accounts");
    if (res.ok) {
      const body = await res.json();
      return { accounts: body.accounts ?? [] };
    }
  } catch (err) {
    console.error("[accounts page.server] error:", err);
  }
  return { accounts: [] };
};
