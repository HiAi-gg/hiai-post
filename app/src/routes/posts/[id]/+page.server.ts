import { isAuthenticatedRequest } from "$lib/server/bridge";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, fetch, request, locals }) => {
  if (!isAuthenticatedRequest(request, locals)) {
    return { post: null };
  }

  try {
    const res = await fetch(`/api/v1/posts/${params.id}`);
    if (res.ok) {
      const body = await res.json();
      return { post: body.post ?? null };
    }
  } catch {}
  return { post: null };
};
