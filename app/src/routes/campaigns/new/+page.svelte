<script lang="ts">
  import { goto } from '$app/navigation';

  const PLATFORMS = ['instagram', 'tiktok', 'x', 'linkedin', 'facebook', 'telegram'];

  let step = $state(1);
  let saving = $state(false);
  let accounts = $state<any[]>([]);
  let campaignsList = $state<any[]>([]);
  let postsList = $state<any[]>([]);
  let loadingAccounts = $state(true);
  let loadingPosts = $state(false);
  let draftPosts = $state<any[]>([]);

  // Step 1: Campaign details
  let campaignName = $state('');
  let campaignDescription = $state('');
  let startDate = $state('');
  let endDate = $state('');

  // Step 2: Platform selection
  let selectedPlatforms = $state<string[]>([]);

  // Step 3: Post scheduling grid
  let selectedPostIds = $state<string[]>([]);

  // Load accounts for platform selection
  async function loadAccounts() {
    loadingAccounts = true;
    try {
      const res = await fetch('/api/v1/accounts');
      if (res.ok) {
        const body = await res.json();
        accounts = body.accounts || body.data || [];
      }
    } finally {
      loadingAccounts = false;
    }
  }

  // Load draft/available posts for scheduling
  async function loadPosts() {
    loadingPosts = true;
    try {
      const res = await fetch('/api/v1/posts?limit=50');
      if (res.ok) {
        const body = await res.json();
        postsList = body.posts || body.data || [];
        draftPosts = postsList.filter(
          (p: any) => p.status === 'draft' || p.status === 'scheduled',
        );
      }
    } finally {
      loadingPosts = false;
    }
  }

  $effect(() => {
    if (step === 2) loadAccounts();
    if (step === 3) loadPosts();
  });

  function togglePlatform(platform: string) {
    if (selectedPlatforms.includes(platform)) {
      selectedPlatforms = selectedPlatforms.filter((p) => p !== platform);
    } else {
      selectedPlatforms = [...selectedPlatforms, platform];
    }
  }

  function togglePost(postId: string) {
    if (selectedPostIds.includes(postId)) {
      selectedPostIds = selectedPostIds.filter((id) => id !== postId);
    } else {
      selectedPostIds = [...selectedPostIds, postId];
    }
  }

  function canGoNext(): boolean {
    if (step === 1) return campaignName.trim().length > 0;
    if (step === 2) return selectedPlatforms.length > 0;
    if (step === 3) return selectedPostIds.length > 0;
    return true;
  }

  async function createAndLaunch() {
    saving = true;
    try {
      // Create the campaign
      const createRes = await fetch('/api/v1/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignName,
          description: campaignDescription || undefined,
          startDate: startDate ? new Date(startDate).toISOString() : undefined,
          endDate: endDate ? new Date(endDate).toISOString() : undefined,
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.json();
        console.error('Failed to create campaign', err);
        return;
      }

      const createBody = await createRes.json();
      const campaignId = createBody.campaign?.id;

      if (!campaignId) return;

      // Bulk schedule selected posts at 1-hour intervals starting now
      if (selectedPostIds.length > 0) {
        const scheduleStart = startDate ? new Date(startDate) : new Date();
        const scheduleRes = await fetch(`/api/v1/campaigns/${campaignId}/bulk-schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            postIds: selectedPostIds,
            startDate: scheduleStart.toISOString(),
            intervalMinutes: 60,
          }),
        });

        if (!scheduleRes.ok) {
          console.error('Bulk schedule failed', await scheduleRes.json());
        }
      }

      goto('/campaigns');
    } finally {
      saving = false;
    }
  }

  function nextStep() {
    if (step < 4) step++;
  }

  function prevStep() {
    if (step > 1) step--;
  }

  const selectedAccounts = $derived(
    accounts.filter((a) => selectedPlatforms.includes(a.platform)),
  );

  const stepTitles = ['Campaign Details', 'Platform Selection', 'Post Scheduling', 'Review & Launch'];
</script>

<svelte:head>
  <title>New Campaign — HiAi Post</title>
</svelte:head>

<div class="max-w-3xl mx-auto space-y-6">
  <div class="flex items-center gap-3">
    <button onclick={() => goto('/campaigns')} class="text-muted-foreground hover:text-foreground transition-colors">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5m7-7-7 7 7 7"/></svg>
    </button>
    <div>
      <h1 class="text-2xl font-bold">New Campaign</h1>
      <p class="text-sm text-muted-foreground">Step {step} of 4 — {stepTitles[step - 1]}</p>
    </div>
  </div>

  <!-- Step Indicator -->
  <div class="flex gap-2">
    {#each stepTitles as _, i}
      <div
        class="flex-1 h-1.5 rounded-full transition-colors"
        class:bg-primary={i + 1 <= step}
        class:bg-muted={i + 1 > step}
      ></div>
    {/each}
  </div>

  <div class="bg-card border border-border rounded-xl p-6">
    <!-- Step 1: Campaign Details -->
    {#if step === 1}
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1">Campaign Name *</label>
          <input
            bind:value={campaignName}
            class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background"
            placeholder="e.g., Summer Sale 2026"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Description</label>
          <textarea
            bind:value={campaignDescription}
            rows={3}
            class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background resize-y"
            placeholder="Campaign goals, target audience, notes..."
          ></textarea>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium mb-1">Start Date</label>
            <input
              type="datetime-local"
              bind:value={startDate}
              class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background"
            />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">End Date</label>
            <input
              type="datetime-local"
              bind:value={endDate}
              class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background"
            />
          </div>
        </div>
      </div>

    <!-- Step 2: Platform Selection -->
    {:else if step === 2}
      {#if loadingAccounts}
        <div class="text-center py-8 text-muted-foreground text-sm">Loading connected accounts...</div>
      {:else}
        <div class="space-y-3">
          <p class="text-sm text-muted-foreground mb-4">Select which platforms this campaign will target</p>
          <div class="grid grid-cols-2 gap-3">
            {#each PLATFORMS as platform}
              {@const hasAccount = accounts.some((a) => a.platform === platform)}
              <button
                onclick={() => togglePlatform(platform)}
                class={[
                  "flex items-center gap-3 p-3 border rounded-lg text-left transition-colors",
                  selectedPlatforms.includes(platform) && 'border-primary bg-primary/5',
                  !selectedPlatforms.includes(platform) && 'border-border',
                  !hasAccount && 'opacity-50',
                ]}
                disabled={!hasAccount}
              >
                <input
                  type="checkbox"
                  checked={selectedPlatforms.includes(platform)}
                  class="rounded"
                  onchange={() => togglePlatform(platform)}
                />
                <div>
                  <span class="text-sm font-medium capitalize">{platform}</span>
                  {#if !hasAccount}
                    <p class="text-[10px] text-muted-foreground">No account connected</p>
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        </div>
      {/if}

    <!-- Step 3: Post Scheduling Grid -->
    {:else if step === 3}
      {#if loadingPosts}
        <div class="text-center py-8 text-muted-foreground text-sm">Loading available posts...</div>
      {:else if draftPosts.length === 0}
        <div class="text-center py-8 text-muted-foreground">
          <p class="mb-2">No draft or scheduled posts available</p>
          <a href="/posts/new" class="text-sm text-primary hover:underline">Create a post first</a>
        </div>
      {:else}
        <div class="space-y-3">
          <p class="text-sm text-muted-foreground mb-4">Select posts to include in this campaign</p>
          <div class="space-y-2 max-h-96 overflow-y-auto">
            {#each draftPosts as post}
              <button
                onclick={() => togglePost(post.id)}
                class={[
                  "w-full flex items-start gap-3 p-3 border rounded-lg text-left transition-colors",
                  selectedPostIds.includes(post.id) && 'border-primary bg-primary/5',
                  !selectedPostIds.includes(post.id) && 'border-border',
                ]}
              >
                <input
                  type="checkbox"
                  checked={selectedPostIds.includes(post.id)}
                  class="mt-0.5 rounded"
                  onchange={() => togglePost(post.id)}
                />
                <div class="flex-1 min-w-0">
                  <p class="text-sm truncate">{post.contentText?.slice(0, 100) || 'Untitled'}</p>
                  <div class="flex gap-2 mt-1">
                    {#if post.platform}
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-muted capitalize">{post.platform}</span>
                    {/if}
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-muted">{post.status}</span>
                  </div>
                </div>
              </button>
            {/each}
          </div>
        </div>
      {/if}

    <!-- Step 4: Review & Launch -->
    {:else if step === 4}
      <div class="space-y-5">
        <div>
          <h3 class="text-sm font-medium text-muted-foreground mb-2">Campaign Details</h3>
          <div class="bg-muted rounded-lg p-3 space-y-2">
            <div class="flex justify-between">
              <span class="text-sm text-muted-foreground">Name</span>
              <span class="text-sm font-medium">{campaignName}</span>
            </div>
            {#if campaignDescription}
              <div class="flex justify-between">
                <span class="text-sm text-muted-foreground">Description</span>
                <span class="text-sm max-w-xs text-right truncate">{campaignDescription}</span>
              </div>
            {/if}
            <div class="flex justify-between">
              <span class="text-sm text-muted-foreground">Date Range</span>
              <span class="text-sm">{startDate?.slice(0, 10) || 'Not set'} — {endDate?.slice(0, 10) || 'Not set'}</span>
            </div>
          </div>
        </div>

        <div>
          <h3 class="text-sm font-medium text-muted-foreground mb-2">Platforms ({selectedPlatforms.length})</h3>
          <div class="flex flex-wrap gap-2">
            {#each selectedPlatforms as platform}
              <span class="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary capitalize">{platform}</span>
            {/each}
          </div>
        </div>

        <div>
          <h3 class="text-sm font-medium text-muted-foreground mb-2">Posts ({selectedPostIds.length})</h3>
          <div class="bg-muted rounded-lg max-h-40 overflow-y-auto">
            {#each draftPosts.filter((p) => selectedPostIds.includes(p.id)) as post}
              <div class="px-3 py-2 border-b border-border last:border-0">
                <p class="text-sm truncate">{post.contentText?.slice(0, 80) || 'Untitled'}</p>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Navigation Buttons -->
  <div class="flex justify-between">
    <button
      onclick={step === 1 ? () => goto('/campaigns') : prevStep}
      class="px-4 py-2 border border-border rounded-md text-sm hover:bg-muted transition-colors"
    >
      {step === 1 ? 'Cancel' : 'Back'}
    </button>

    {#if step < 4}
      <button
        onclick={nextStep}
        disabled={!canGoNext()}
        class="px-6 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50 transition-opacity"
      >
        Next
      </button>
    {:else}
      <button
        onclick={createAndLaunch}
        disabled={saving}
        class="px-6 py-2 bg-green-600 text-white rounded-md text-sm font-medium disabled:opacity-50 transition-opacity"
      >
        {saving ? 'Creating...' : 'Create & Launch Campaign'}
      </button>
    {/if}
  </div>
</div>
