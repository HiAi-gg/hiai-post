import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ fetch }) => {
  try {
    const res = await fetch("/api/v1/content-plans");
    if (res.ok) {
      const body = await res.json();
      return { plans: body.data ?? [] };
    }
  } catch {}
  return { plans: [] };
};
