<script lang="ts">
  import StatusBadge from '$lib/components/StatusBadge.svelte';

  let { data } = $props();

  let showCreate = $state(false);
  let newCampaign = $state({ name: '', description: '', startDate: '', endDate: '' });
  let creating = $state(false);

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-500/10 text-gray-500',
    active: 'bg-green-500/10 text-green-500',
    completed: 'bg-blue-500/10 text-blue-500',
    paused: 'bg-yellow-500/10 text-yellow-500',
  };

  async function createCampaign() {
    creating = true;
    try {
      const res = await fetch('/api/v1/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCampaign),
      });
      if (res.ok) {
        const created = await res.json();
        data.campaigns = [...data.campaigns, created.data || created];
        newCampaign = { name: '', description: '', startDate: '', endDate: '' };
        showCreate = false;
      }
    } finally { creating = false; }
  }

  function getProgress(campaign: any): string {
    const posts = campaign.posts || [];
    if (!posts.length) return '0 / 0';
    const published = posts.filter((p: any) => p.status === 'published').length;
    return `${published} / ${posts.length}`;
  }

  function getProgressPercent(campaign: any): number {
    const posts = campaign.posts || [];
    if (!posts.length) return 0;
    const published = posts.filter((p: any) => p.status === 'published').length;
    return Math.round((published / posts.length) * 100);
  }
</script>

<svelte:head><title>Campaigns — hiai-post</title></svelte:head>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold">Campaigns</h1>
      <p class="text-sm text-muted-foreground mt-1">Group posts into coordinated campaigns with date ranges</p>
    </div>
    <button onclick={() => showCreate = !showCreate} class="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
      + New Campaign
    </button>
  </div>

  {#if showCreate}
    <div class="bg-card border border-border rounded-lg p-6">
      <h2 class="font-semibold mb-4">Create Campaign</h2>
      <div class="grid grid-cols-2 gap-4">
        <div class="col-span-2">
          <label class="block text-sm font-medium mb-1">Name</label>
          <input bind:value={newCampaign.name} class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background" placeholder="e.g., Summer Sale 2026" />
        </div>
        <div class="col-span-2">
          <label class="block text-sm font-medium mb-1">Description</label>
          <textarea bind:value={newCampaign.description} rows={2} class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background" placeholder="Campaign goals and notes..."></textarea>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Start Date</label>
          <input type="date" bind:value={newCampaign.startDate} class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">End Date</label>
          <input type="date" bind:value={newCampaign.endDate} class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background" />
        </div>
      </div>
      <div class="flex justify-end gap-2 mt-4">
        <button onclick={() => showCreate = false} class="px-4 py-2 border border-border rounded-md text-sm hover:bg-muted transition-colors">Cancel</button>
        <button onclick={createCampaign} disabled={creating || !newCampaign.name} class="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50 transition-opacity">
          {creating ? 'Creating...' : 'Create Campaign'}
        </button>
      </div>
    </div>
  {/if}

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
          <p class="text-xs text-muted-foreground mb-3">📅 {campaign.startDate} — {campaign.endDate}</p>
        {/if}
        <div class="space-y-1.5">
          <div class="flex justify-between text-xs">
            <span class="text-muted-foreground">Progress</span>
            <span class="font-medium">{getProgress(campaign)}</span>
          </div>
          <div class="w-full bg-muted rounded-full h-1.5">
            <div class="bg-primary rounded-full h-1.5 transition-all" style="width: {getProgressPercent(campaign)}%"></div>
          </div>
        </div>
      </div>
    {:else}
      <div class="col-span-full text-center py-12 text-muted-foreground">
        <p class="text-lg mb-2">No campaigns yet</p>
        <p class="text-sm">Create a campaign to group and coordinate your posts</p>
      </div>
    {/each}
  </div>
</div>
