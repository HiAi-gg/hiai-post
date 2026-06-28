import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ fetch }) => {
  try {
    const res = await fetch("/api/v1/campaigns");
    if (res.ok) {
      const body = await res.json();
      return { campaigns: body.data ?? [] };
    }
  } catch (err) {
    console.error("[campaigns page.server] error:", err);
  }
  return { campaigns: [] };
};
