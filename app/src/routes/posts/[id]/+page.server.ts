import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, fetch }) => {
  try {
    const res = await fetch(`/api/v1/posts/${params.id}`);
    if (res.ok) {
      const body = await res.json();
      return { post: body.data };
    }
  } catch {}
  return { post: null };
};
