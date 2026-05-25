<script lang="ts">
  import type { PageData } from './$types';
  import Calendar from '$lib/components/Calendar.svelte';
  import UpcomingPosts from '$lib/components/UpcomingPosts.svelte';

  let { data }: { data: PageData } = $props();

  const platformIcons: Record<string, string> = {
    instagram: '📷',
    x: '𝕏',
    linkedin: '💼',
    tiktok: '🎵',
    facebook: '📘',
    telegram: '✈️',
  };

  // Compute connected platforms
  const connectedPlatforms = $derived(
    data.accounts.map((a: any) => ({
      platform: a.platform,
      username: a.username,
      icon: platformIcons[a.platform] ?? '📱',
      connected: a.status === 'active',
    }))
  );

  const allPlatforms = ['instagram', 'x', 'linkedin', 'tiktok', 'facebook', 'telegram'];
  const disconnectedPlatforms = $derived(
    allPlatforms.filter(p => !connectedPlatforms.some((c: any) => c.platform === p))
  );

  // Next scheduled post countdown
  const nextPost = $derived(
    data.recentPosts.length > 0 ? data.recentPosts[0] : null
  );
  const nextPostTime = $derived(
    nextPost?.scheduledAt ? new Date(nextPost.scheduledAt) : null
  );
</script>

<svelte:head>
  <title>Dashboard — HiAi Post</title>
</svelte:head>

<div class="p-6 max-w-7xl mx-auto space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold">Dashboard</h1>
    <a href="/posts/new" class="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
      + New Post
    </a>
  </div>

  <!-- Stats -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div class="bg-card rounded-lg border border-border p-4">
      <p class="text-sm text-muted-foreground">Scheduled</p>
      <p class="text-3xl font-bold mt-1">{data.queueStatus.pending ?? 0}</p>
      <p class="text-xs text-muted-foreground mt-1">in queue</p>
    </div>
    <div class="bg-card rounded-lg border border-border p-4">
      <p class="text-sm text-muted-foreground">Published</p>
      <p class="text-3xl font-bold mt-1">{data.queueStatus.published ?? 0}</p>
      <p class="text-xs text-muted-foreground mt-1">total</p>
    </div>
    <div class="bg-card rounded-lg border border-border p-4">
      <p class="text-sm text-muted-foreground">Failed</p>
      <p class="text-3xl font-bold mt-1 {data.queueStatus.failed > 0 ? 'text-destructive' : ''}">
        {data.queueStatus.failed ?? 0}
      </p>
      <p class="text-xs text-muted-foreground mt-1">dead letter</p>
    </div>
    <div class="bg-card rounded-lg border border-border p-4">
      <p class="text-sm text-muted-foreground">Accounts</p>
      <p class="text-3xl font-bold mt-1">{data.accounts.length}</p>
      <p class="text-xs text-muted-foreground mt-1">connected</p>
    </div>
  </div>

  <!-- Next Scheduled Post -->
  {#if nextPost}
    <div class="bg-primary/5 border border-primary/20 rounded-lg p-4 flex items-center justify-between">
      <div>
        <p class="text-sm text-muted-foreground">Next scheduled post</p>
        <p class="font-medium mt-1 truncate max-w-md">{nextPost.contentText?.slice(0, 80) ?? 'Untitled'}...</p>
      </div>
      <div class="text-right">
        <p class="text-sm font-medium">
          {nextPostTime ? nextPostTime.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
        </p>
        <p class="text-xs text-muted-foreground">
          {nextPostTime ? nextPostTime.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
        </p>
      </div>
    </div>
  {/if}

  <!-- Main Content Grid -->
  <div class="grid lg:grid-cols-3 gap-6">
    <div class="lg:col-span-2 space-y-6">
      <!-- Calendar -->
      <div class="bg-card rounded-lg border border-border p-4">
        <Calendar />
      </div>

      <!-- Recent Posts Table -->
      <div class="bg-card rounded-lg border border-border p-4">
        <h2 class="text-lg font-semibold mb-3">Recent Posts</h2>
        {#if data.recentPosts.length > 0}
          <div class="space-y-2">
            {#each data.recentPosts.slice(0, 5) as post}
              <a href="/posts/{post.id}" class="flex items-center gap-3 p-2 rounded hover:bg-muted/50 transition-colors">
                <span class="text-lg">{platformIcons[post.platform] ?? '📱'}</span>
                <div class="flex-1 min-w-0">
                  <p class="text-sm truncate">{post.contentText?.slice(0, 60) ?? 'No content'}</p>
                  <p class="text-xs text-muted-foreground">
                    {post.platform} · {post.status}
                    {#if post.scheduledAt} · {new Date(post.scheduledAt).toLocaleString()}{/if}
                  </p>
                </div>
                <span class="text-xs px-2 py-0.5 rounded-full"
                  class:bg-green-100={post.status === 'published'}
                  class:text-green-700={post.status === 'published'}
                  class:bg-yellow-100={post.status === 'scheduled'}
                  class:text-yellow-700={post.status === 'scheduled'}
                  class:bg-red-100={post.status === 'failed'}
                  class:text-red-700={post.status === 'failed'}
                  class:bg-gray-100={post.status === 'draft'}
                  class:text-gray-700={post.status === 'draft'}
                >
                  {post.status}
                </span>
              </a>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-muted-foreground text-center py-4">No posts yet. Create your first post!</p>
        {/if}
      </div>
    </div>

    <!-- Sidebar -->
    <div class="space-y-6">
      <!-- Connected Accounts -->
      <div class="bg-card rounded-lg border border-border p-4">
        <h2 class="text-lg font-semibold mb-3">Social Accounts</h2>
        <div class="space-y-2">
          {#each connectedPlatforms as acc}
            <div class="flex items-center gap-2 p-2 rounded bg-green-50 dark:bg-green-950/30">
              <span class="text-lg">{acc.icon}</span>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium capitalize">{acc.platform}</p>
                <p class="text-xs text-muted-foreground truncate">{acc.username}</p>
              </div>
              <span class="w-2 h-2 rounded-full bg-green-500"></span>
            </div>
          {/each}
          {#if disconnectedPlatforms.length > 0}
            <div class="pt-2 border-t border-border">
              <p class="text-xs text-muted-foreground mb-2">Not connected:</p>
              <div class="flex flex-wrap gap-2">
                {#each disconnectedPlatforms as p}
                  <a href="/accounts" class="text-xs px-2 py-1 rounded border border-dashed border-muted-foreground/30 text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                    {platformIcons[p] ?? '📱'} {p}
                  </a>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="bg-card rounded-lg border border-border p-4">
        <h2 class="text-lg font-semibold mb-3">Quick Actions</h2>
        <div class="space-y-2">
          <a href="/posts/new" class="block w-full text-center px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:opacity-90">Create Post</a>
          <a href="/posts/new?ai=true" class="block w-full text-center px-4 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm hover:opacity-90">AI Generate</a>
          <a href="/content-plans" class="block w-full text-center px-4 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm hover:opacity-90">Content Calendar</a>
          <a href="/templates" class="block w-full text-center px-4 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm hover:opacity-90">Templates</a>
          <a href="/analytics" class="block w-full text-center px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted/50">View Analytics</a>
        </div>
      </div>
    </div>
  </div>
</div>
