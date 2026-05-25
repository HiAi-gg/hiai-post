<script lang="ts">
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let post = $state(data.post);
  let saving = $state(false);

  async function updatePost() {
    if (!post) return;
    saving = true;
    try {
      const res = await fetch(`/api/v1/posts/${post.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentText: post.contentText, scheduledAt: post.scheduledAt }),
      });
      if (res.ok) goto('/posts');
    } finally {
      saving = false;
    }
  }

  async function deletePost() {
    if (!post || !confirm('Delete this post?')) return;
    await fetch(`/api/v1/posts/${post.id}`, { method: 'DELETE' });
    goto('/posts');
  }

  async function publishNow() {
    if (!post) return;
    saving = true;
    try {
      const res = await fetch(`/api/v1/posts/${post.id}/publish`, { method: 'POST' });
      if (res.ok) goto('/posts');
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>Edit Post — HiAi Post</title>
</svelte:head>

<div class="p-6 max-w-4xl mx-auto space-y-6">
  {#if !post}
    <p class="text-muted-foreground py-8 text-center">Post not found.</p>
  {:else}
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">Edit Post</h1>
      <span class="px-2 py-0.5 text-xs rounded-full bg-muted capitalize">{post.platform} — {post.status}</span>
    </div>

    <textarea bind:value={post.contentText} rows={10} class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background resize-y"></textarea>

    <div class="flex gap-3">
      <button onclick={updatePost} disabled={saving} class="px-4 py-2 border border-border rounded-md text-sm font-medium hover:bg-muted disabled:opacity-50">Save</button>
      {#if post.status === 'draft' || post.status === 'scheduled'}
        <button onclick={publishNow} disabled={saving} class="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50">Publish Now</button>
      {/if}
      <button onclick={deletePost} class="px-4 py-2 text-destructive border border-destructive rounded-md text-sm font-medium hover:bg-destructive/10 ml-auto">Delete</button>
    </div>
  {/if}
</div>
