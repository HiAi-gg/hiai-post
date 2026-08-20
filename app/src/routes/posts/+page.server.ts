import { isAuthenticatedRequest } from "$lib/server/bridge";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, fetch, request, locals }) => {
  const status = url.searchParams.get("status") ?? "";
  const platform = url.searchParams.get("platform") ?? "";
  const page = url.searchParams.get("page") ?? "1";

  const params = new URLSearchParams({ page, limit: "20" });
  if (status) params.set("status", status);
  if (platform) params.set("platform", platform);

  if (!isAuthenticatedRequest(request, locals)) {
    return { posts: [], total: 0 };
  }

  try {
    const res = await fetch(`/api/v1/posts?${params}`);
    const body = await res.json();
    return { posts: body.posts ?? [], total: body.pagination?.total ?? 0 };
  } catch {
    return { posts: [], total: 0 };
  }
};
