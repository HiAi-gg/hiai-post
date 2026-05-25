<script lang="ts">
  interface Post { id: string; contentText?: string; platform: string; scheduledAt?: string; status: string; }
  let { posts = [] as Post[] } = $props();
</script>

<div class="bg-card border border-border rounded-lg overflow-hidden">
  <div class="p-4 border-b border-border">
    <h3 class="font-semibold text-sm">Upcoming Posts</h3>
  </div>
  <div class="divide-y divide-border">
    {#if posts.length === 0}
      <p class="p-4 text-sm text-muted-foreground text-center">No upcoming posts.</p>
    {/if}
    {#each posts as post}
      <a href="/posts/{post.id}" class="block p-3 hover:bg-muted/50 transition-colors">
        <p class="text-sm font-medium truncate">{post.contentText?.slice(0, 60) ?? 'Untitled'}</p>
        <div class="flex items-center gap-2 mt-1">
          <span class="text-xs capitalize text-muted-foreground">{post.platform}</span>
          {#if post.scheduledAt}
            <span class="text-xs text-muted-foreground">{new Date(post.scheduledAt).toLocaleString()}</span>
          {/if}
        </div>
      </a>
    {/each}
  </div>
</div>
