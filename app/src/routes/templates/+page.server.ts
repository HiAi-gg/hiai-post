import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ fetch }) => {
  try {
    const res = await fetch("/api/v1/templates");
    if (res.ok) {
      const body = await res.json();
      return { templates: body.data ?? [] };
    }
  } catch {}
  return { templates: [] };
};
