<script lang="ts">
  import { goto } from '$app/navigation';

  let { data } = $props();

  let bulkTarget = $state<string | null>(null);
  let bulkPostIds = $state('');
  let bulkStartDate = $state('');
  let bulkInterval = $state(30);
  let bulkScheduling = $state(false);

  let toggling = $state<Record<string, boolean>>({});

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-500/10 text-gray-500',
    active: 'bg-green-500/10 text-green-500',
    completed: 'bg-blue-500/10 text-blue-500',
    paused: 'bg-yellow-500/10 text-yellow-500',
  };

  const isAdmin = data?.user?.role === 'admin';

  function getProgressStats(campaign: any) {
    const posts = campaign.posts || [];
    const published = posts.filter((p: any) => p.status === 'published').length;
    const scheduled = posts.filter((p: any) => p.status === 'scheduled').length;
    const failed = posts.filter((p: any) => p.status === 'failed').length;
    const total = posts.length;
    const done = published + failed;
    const remaining = total - done;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { published, scheduled, failed, remaining, total, percent };
  }

  async function togglePauseResume(campaign: any) {
    const id = campaign.id;
    toggling = { ...toggling, [id]: true };
    try {
      const action = campaign.status === 'active' ? 'pause' : 'resume';
      const res = await fetch(`/api/v1/campaigns/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const body = await res.json();
        campaign.status = body.campaign.status;
      }
    } finally {
      toggling = { ...toggling, [id]: false };
    }
  }

  async function doBulkSchedule() {
    if (!bulkTarget || !bulkPostIds || !bulkStartDate) return;
    bulkScheduling = true;
    try {
      const ids = bulkPostIds.split(',').map((s) => s.trim()).filter(Boolean);
      const res = await fetch(`/api/v1/campaigns/${bulkTarget}/bulk-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postIds: ids,
          startDate: new Date(bulkStartDate).toISOString(),
          intervalMinutes: bulkInterval,
        }),
      });
      if (res.ok) {
        bulkTarget = null;
        bulkPostIds = '';
        bulkStartDate = '';
        bulkInterval = 30;
        goto('/campaigns');
      }
    } finally {
      bulkScheduling = false;
    }
  }
</script>

<svelte:head><title>Campaigns — hiai-post</title></svelte:head>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold">Campaigns</h1>
      <p class="text-sm text-muted-foreground mt-1">Group posts into coordinated campaigns with date ranges</p>
    </div>
    <a href="/campaigns/new" class="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors inline-block">
      + New Campaign
    </a>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    {#each data.campaigns as campaign}
      <div class="bg-card border border-border rounded-lg p-5 hover:shadow-md transition-shadow">
        <div class="flex items-start justify-between mb-3">
          <h3 class="font-semibold text-sm truncate flex-1">{campaign.name}</h3>
          <span class="text-[10px] px-2 py-0.5 rounded-full capitalize {statusColors[campaign.status] || ''}">{campaign.status}</span>
        </div>
        {#if campaign.description}
          <p class="text-xs text-muted-foreground mb-3 line-clamp-2">{campaign.description}</p>
        {/if}
        {#if campaign.startDate && campaign.endDate}
          <p class="text-xs text-muted-foreground mb-3">{campaign.startDate.slice(0, 10)} — {campaign.endDate.slice(0, 10)}</p>
        {/if}

        {#if campaign.posts}
          {@const stats = getProgressStats(campaign)}
          <div class="space-y-1.5 mb-3">
            <div class="flex justify-between text-xs">
              <span class="text-muted-foreground">Progress</span>
              <span class="font-medium">{stats.published} published / {stats.total} total</span>
            </div>
            <div class="w-full bg-muted rounded-full h-1.5">
              <div
                class="bg-primary rounded-full h-1.5 transition-all"
                style="width: {stats.percent}%"
              ></div>
            </div>
            <div class="flex gap-3 text-[10px] text-muted-foreground">
              <span>{stats.published} published</span>
              {#if stats.scheduled > 0}<span>{stats.scheduled} scheduled</span>{/if}
              {#if stats.failed > 0}<span class="text-red-500">{stats.failed} failed</span>{/if}
              {#if stats.remaining > 0}<span>{stats.remaining} remaining</span>{/if}
            </div>
          </div>
        {/if}

        {#if isAdmin}
          <div class="flex gap-2 pt-2 border-t border-border">
            {#if campaign.status === 'active' || campaign.status === 'paused'}
              <button
                onclick={() => togglePauseResume(campaign)}
                disabled={toggling[campaign.id]}
                class={[
                  "flex-1 px-3 py-1.5 text-xs rounded-md font-medium transition-colors",
                  campaign.status === 'active' && 'bg-yellow-500/10 text-yellow-600',
                  campaign.status === 'paused' && 'bg-green-500/10 text-green-600',
                  toggling[campaign.id] && 'opacity-50',
                ]}
              >
                {toggling[campaign.id] ? '...' : campaign.status === 'active' ? 'Pause' : 'Resume'}
              </button>
            {/if}
            <button
              onclick={() => bulkTarget = campaign.id}
              class="flex-1 px-3 py-1.5 text-xs rounded-md font-medium bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 transition-colors"
            >
              Bulk Schedule
            </button>
          </div>
        {/if}
      </div>
    {:else}
      <div class="col-span-full text-center py-12 text-muted-foreground">
        <p class="text-lg mb-2">No campaigns yet</p>
        <p class="text-sm">Create a campaign to group and coordinate your posts</p>
      </div>
    {/each}
  </div>
</div>

<!-- Bulk Schedule Modal -->
{#if bulkTarget}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onclick={() => bulkTarget = null} role="presentation">
    <div class="bg-card border border-border rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <h2 class="font-semibold mb-4">Bulk Schedule Posts</h2>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1">Post IDs (comma-separated)</label>
          <textarea
            bind:value={bulkPostIds}
            rows={3}
            class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background"
            placeholder="uuid-1, uuid-2, uuid-3"
          ></textarea>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Start Date & Time</label>
          <input
            type="datetime-local"
            bind:value={bulkStartDate}
            class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Interval (minutes)</label>
          <input
            type="number"
            bind:value={bulkInterval}
            min={1}
            max={1440}
            class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background"
          />
        </div>
      </div>
      <div class="flex justify-end gap-2 mt-6">
        <button
          onclick={() => bulkTarget = null}
          class="px-4 py-2 border border-border rounded-md text-sm hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          onclick={doBulkSchedule}
          disabled={bulkScheduling || !bulkPostIds || !bulkStartDate}
          class="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50 transition-opacity"
        >
          {bulkScheduling ? 'Scheduling...' : 'Schedule'}
        </button>
      </div>
    </div>
  </div>
{/if}
