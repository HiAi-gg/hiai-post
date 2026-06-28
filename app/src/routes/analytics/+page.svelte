<script lang="ts">
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();
const _a = $derived(data.overview);
const _platforms = $derived(data.platforms);
const _topPosts = $derived(data.topPosts);
const timeline = $derived(data.timeline);
const _bestHours = $derived(data.bestHours);
const _bestTimes = $derived(data.bestTimes ?? []);

// Platform icon/color map
const platformMeta: Record<string, { icon: string; color: string; bg: string }> = {
  instagram: { icon: "📷", color: "text-pink-600", bg: "bg-pink-50 dark:bg-pink-950" },
  x: { icon: "𝕏", color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950" },
  linkedin: { icon: "💼", color: "text-blue-700", bg: "bg-blue-50 dark:bg-blue-950" },
  tiktok: { icon: "🎵", color: "text-gray-900", bg: "bg-gray-50 dark:bg-gray-900" },
  facebook: { icon: "📘", color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950" },
  telegram: { icon: "✈️", color: "text-sky-500", bg: "bg-sky-50 dark:bg-sky-950" },
};

function _getMeta(platform: string) {
  return platformMeta[platform] ?? { icon: "📱", color: "text-muted-foreground", bg: "bg-muted" };
}

function _formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

// Find max for timeline chart scaling
const _maxTimelineCount = $derived(Math.max(...timeline.map((d) => d.count), 1));

// Time range selector
let _timeRange = $state("30d");
const _ranges = ["7d", "30d", "90d", "all"] as const;

function _getDays(r: string): number {
  if (r === "7d") return 7;
  if (r === "90d") return 90;
  if (r === "all") return 365;
  return 30;
}
</script>

<svelte:head>
  <title>Analytics — HiAi Post</title>
</svelte:head>

<div class="p-6 max-w-7xl mx-auto space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold">Analytics</h1>
    <div class="flex gap-1 bg-muted rounded-lg p-0.5">
      {#each ranges as r}
        <button
          class="px-3 py-1.5 text-sm rounded-md transition-colors"
          class:bg-background={timeRange === r}
          class:shadow-sm={timeRange === r}
          class:text-foreground={timeRange === r}
          class:text-muted-foreground={timeRange !== r}
          onclick={() => timeRange = r}
        >{r}</button>
      {/each}
    </div>
  </div>

  <!-- Overview Stats -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div class="bg-card border border-border rounded-lg p-4">
      <p class="text-sm text-muted-foreground">Total Posts</p>
      <p class="text-3xl font-bold mt-1">{a.totalPosts}</p>
      <p class="text-xs text-muted-foreground mt-1">{a.published} published · {a.scheduled} scheduled</p>
    </div>
    <div class="bg-card border border-border rounded-lg p-4">
      <p class="text-sm text-muted-foreground">Engagement Rate</p>
      <p class="text-3xl font-bold mt-1">{a.engagementRate.toFixed(1)}%</p>
      <p class="text-xs text-muted-foreground mt-1">avg across all posts</p>
    </div>
    <div class="bg-card border border-border rounded-lg p-4">
      <p class="text-sm text-muted-foreground">Total Reach</p>
      <p class="text-3xl font-bold mt-1">{formatNum(a.totalReach)}</p>
      <p class="text-xs text-muted-foreground mt-1">{formatNum(a.totalImpressions)} impressions</p>
    </div>
    <div class="bg-card border border-border rounded-lg p-4">
      <p class="text-sm text-muted-foreground">Interactions</p>
      <p class="text-3xl font-bold mt-1">{formatNum(a.totalLikes + a.totalComments + a.totalShares)}</p>
      <p class="text-xs text-muted-foreground mt-1">❤️ {formatNum(a.totalLikes)} · 💬 {formatNum(a.totalComments)} · 🔁 {formatNum(a.totalShares)}</p>
    </div>
  </div>

  <!-- Best Info Cards -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div class="bg-card border border-border rounded-lg p-4">
      <p class="text-sm text-muted-foreground mb-1">Top Platform</p>
      <div class="flex items-center gap-2">
        <span class="text-2xl">{getMeta(a.topPlatform).icon}</span>
        <span class="text-lg font-semibold capitalize">{a.topPlatform}</span>
      </div>
    </div>
    <div class="bg-card border border-border rounded-lg p-4">
      <p class="text-sm text-muted-foreground mb-1">Best Posting Time</p>
      <p class="text-lg font-semibold">{a.bestPostingTime}</p>
    </div>
  </div>

  <!-- Posting Activity Timeline -->
  <div class="bg-card border border-border rounded-lg p-6">
    <h2 class="text-lg font-semibold mb-4">Posting Activity</h2>
    {#if timeline.length > 0}
      <div class="flex items-end gap-1 h-32">
        {#each timeline as day}
          <div class="flex-1 flex flex-col items-center gap-1" title="{day.date}: {day.count} posts">
            <div
              class="w-full bg-primary/80 rounded-t-sm min-h-[2px] transition-all"
              style="height: {(day.count / maxTimelineCount) * 100}%"
            ></div>
            <span class="text-[9px] text-muted-foreground -rotate-45 origin-top-left whitespace-nowrap">
              {day.date.slice(5)}
            </span>
          </div>
        {/each}
      </div>
    {:else}
      <p class="text-muted-foreground text-center py-8">No posting activity data yet.</p>
    {/if}
  </div>

  <!-- Platform Breakdown -->
  <div class="bg-card border border-border rounded-lg p-6">
    <h2 class="text-lg font-semibold mb-4">Platform Breakdown</h2>
    {#if platforms.length > 0}
      <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
        {#each platforms as p}
          {@const meta = getMeta(p.platform)}
          <div class="rounded-lg border border-border p-4 {meta.bg}">
            <div class="flex items-center gap-2 mb-3">
              <span class="text-xl">{meta.icon}</span>
              <span class="font-semibold capitalize {meta.color}">{p.platform}</span>
            </div>
            <div class="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p class="text-muted-foreground">Posts</p>
                <p class="font-semibold">{p.posts}</p>
              </div>
              <div>
                <p class="text-muted-foreground">Impressions</p>
                <p class="font-semibold">{formatNum(p.impressions)}</p>
              </div>
              <div>
                <p class="text-muted-foreground">Reach</p>
                <p class="font-semibold">{formatNum(p.reach)}</p>
              </div>
              <div>
                <p class="text-muted-foreground">Engagement</p>
                <p class="font-semibold">{formatNum(p.engagement)}</p>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <p class="text-muted-foreground text-center py-8">No platform data yet. Connect social accounts and publish posts to see analytics.</p>
    {/if}
  </div>

  <!-- Top Posts -->
  <div class="bg-card border border-border rounded-lg p-6">
    <h2 class="text-lg font-semibold mb-4">Top Performing Posts</h2>
    {#if topPosts.length > 0}
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border text-muted-foreground">
              <th class="text-left py-2 px-3">Content</th>
              <th class="text-left py-2 px-3">Platform</th>
              <th class="text-right py-2 px-3">Impressions</th>
              <th class="text-right py-2 px-3">Reach</th>
              <th class="text-right py-2 px-3">Engagement</th>
              <th class="text-right py-2 px-3">Likes</th>
              <th class="text-right py-2 px-3">Comments</th>
              <th class="text-right py-2 px-3">Shares</th>
            </tr>
          </thead>
          <tbody>
            {#each topPosts as post}
              {@const meta = getMeta(post.platform)}
              <tr class="border-b border-border/50 hover:bg-muted/50">
                <td class="py-2 px-3 max-w-[200px] truncate">{post.contentPreview}</td>
                <td class="py-2 px-3">
                  <span class="inline-flex items-center gap-1">
                    <span>{meta.icon}</span>
                    <span class="capitalize">{post.platform}</span>
                  </span>
                </td>
                <td class="py-2 px-3 text-right font-mono">{formatNum(post.impressions)}</td>
                <td class="py-2 px-3 text-right font-mono">{formatNum(post.reach)}</td>
                <td class="py-2 px-3 text-right font-mono">{post.engagementRate.toFixed(1)}%</td>
                <td class="py-2 px-3 text-right font-mono">{formatNum(post.likes)}</td>
                <td class="py-2 px-3 text-right font-mono">{formatNum(post.comments)}</td>
                <td class="py-2 px-3 text-right font-mono">{formatNum(post.shares)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="text-muted-foreground text-center py-8">No post performance data yet. Analytics are collected every 6 hours for published posts.</p>
    {/if}
  </div>

  <!-- Best Posting Times Heatmap -->
  <BestTimeChart slots={bestTimes} title="Best Posting Times" />

  {#if bestTimes.length === 0 && bestHours.length > 0}
    <div class="bg-card border border-border rounded-lg p-6">
      <h2 class="text-lg font-semibold mb-4">Top Hours (fallback)</h2>
      <div class="grid grid-cols-5 gap-3">
        {#each bestHours as h, i}
          <div class="text-center p-3 rounded-lg {i === 0 ? 'bg-primary/10 border-2 border-primary' : 'bg-muted'}">
            <p class="text-2xl font-bold">{h.hour}:00</p>
            <p class="text-xs text-muted-foreground mt-1">{h.count} posts</p>
            {#if i === 0}
              <p class="text-xs text-primary font-medium mt-1">Best time</p>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
