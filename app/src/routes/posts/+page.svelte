<script lang="ts">
  import type { PageData } from './$types';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  let { data }: { data: PageData } = $props();

  const PLATFORMS = ['instagram', 'tiktok', 'x', 'linkedin', 'facebook', 'telegram'];
  const STATUSES = ['draft', 'scheduled', 'publishing', 'published', 'failed'];

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(page.url.searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete('page');
    goto(`?${params}`);
  }
</script>

<svelte:head>
  <title>Posts — HiAi Post</title>
</svelte:head>

<div class="p-6 max-w-7xl mx-auto space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold">Posts</h1>
    <a href="/posts/new" class="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">New Post</a>
  </div>

  <div class="flex gap-2 flex-wrap">
    <select onchange={e => setFilter('status', e.currentTarget.value)} class="px-3 py-1.5 border border-border rounded-md text-sm bg-card">
      <option value="">All statuses</option>
      {#each STATUSES as s}<option value={s}>{s}</option>{/each}
    </select>
    <select onchange={e => setFilter('platform', e.currentTarget.value)} class="px-3 py-1.5 border border-border rounded-md text-sm bg-card">
      <option value="">All platforms</option>
      {#each PLATFORMS as p}<option value={p}>{p}</option>{/each}
    </select>
  </div>

  <div class="space-y-2">
    {#if data.posts.length === 0}
      <p class="text-muted-foreground py-8 text-center">No posts found. Create your first post!</p>
    {/if}
    {#each data.posts as post}
      <a href="/posts/{post.id}" class="block bg-card border border-border rounded-lg p-4 hover:shadow-md transition-shadow">
        <div class="flex items-start justify-between">
          <div class="flex-1 min-w-0">
            <p class="font-medium truncate">{post.contentText?.slice(0, 100) ?? 'Untitled'}</p>
            <div class="flex gap-2 mt-2">
              <span class="inline-block px-2 py-0.5 text-xs rounded-full bg-muted">{post.platform}</span>
              <span class="inline-block px-2 py-0.5 text-xs rounded-full" class:bg-green-100={post.status==='published'} class:bg-yellow-100={post.status==='scheduled'} class:bg-red-100={post.status==='failed'} class:bg-gray-100={post.status==='draft'}>{post.status}</span>
            </div>
          </div>
          <span class="text-xs text-muted-foreground ml-4 shrink-0">
            {post.scheduledAt ? new Date(post.scheduledAt).toLocaleString() : post.publishedAt ? new Date(post.publishedAt).toLocaleString() : ''}
          </span>
        </div>
      </a>
    {/each}
  </div>
</div>
