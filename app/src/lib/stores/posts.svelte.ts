interface Post {
  id: string;
  contentText: string;
  platform: string;
  status: string;
  scheduledAt?: string;
  publishedAt?: string;
  mediaUrls: string[];
}

let posts = $state<Post[]>([]);
let loading = $state(false);

export const postsStore = {
  get posts() { return posts; },
  get loading() { return loading; },
  set(p: Post[]) { posts = p; },
  add(p: Post) { posts = [p, ...posts]; },
  update(id: string, data: Partial<Post>) {
    posts = posts.map(p => p.id === id ? { ...p, ...data } : p);
  },
  remove(id: string) { posts = posts.filter(p => p.id !== id); },
  startLoad() { loading = true; },
  endLoad() { loading = false; },
};
