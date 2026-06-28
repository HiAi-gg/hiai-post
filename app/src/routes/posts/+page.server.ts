import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, fetch }) => {
  const status = url.searchParams.get("status") ?? "";
  const platform = url.searchParams.get("platform") ?? "";
  const page = url.searchParams.get("page") ?? "1";

  const params = new URLSearchParams({ page, limit: "20" });
  if (status) params.set("status", status);
  if (platform) params.set("platform", platform);

  try {
    const res = await fetch(`/api/v1/posts?${params}`);
    const body = await res.json();
    return { posts: body.data ?? [], total: body.total ?? 0 };
  } catch {
    return { posts: [], total: 0 };
  }
};
