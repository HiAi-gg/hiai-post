<script lang="ts">
import { goto } from "$app/navigation";

const _PLATFORMS = ["instagram", "tiktok", "x", "linkedin", "facebook", "telegram"];

let platform = $state("instagram");
let contentText = $state("");
let scheduledAt = $state("");
let _saving = $state(false);
let _generating = $state(false);
let topic = $state("");

async function _save(status: "draft" | "scheduled") {
  _saving = true;
  try {
    const res = await fetch("/api/v1/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contentText,
        platform,
        status,
        scheduledAt: status === "scheduled" ? scheduledAt : undefined,
      }),
    });
    if (res.ok) {
      const body = await res.json();
      goto(`/posts/${body.data.id}`);
    }
  } finally {
    _saving = false;
  }
}

async function _generateWithAI() {
  if (!topic) return;
  _generating = true;
  try {
    const res = await fetch("/api/v1/posts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, platforms: [platform] }),
    });
    if (res.ok) {
      const body = await res.json();
      if (body.posts?.[0]?.content) {
        contentText = body.posts[0].content;
      }
    }
  } finally {
    _generating = false;
  }
}
</script>

<svelte:head>
  <title>New Post — HiAi Post</title>
</svelte:head>

<div class="p-6 max-w-4xl mx-auto space-y-6">
  <h1 class="text-2xl font-bold">New Post</h1>

  <div class="flex gap-2">
    {#each PLATFORMS as p}
      <button
        onclick={() => platform = p}
        class="px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-colors"
        class:bg-primary={platform === p}
        class:text-primary-foreground={platform === p}
        class:bg-muted={platform !== p}
      >{p}</button>
    {/each}
  </div>

  <div class="bg-card border border-border rounded-lg p-4 space-y-3">
    <label class="block text-sm font-medium">AI Generate</label>
    <div class="flex gap-2">
      <input bind:value={topic} placeholder="Enter topic for AI generation..." class="flex-1 px-3 py-2 border border-border rounded-md text-sm bg-background" />
      <button onclick={generateWithAI} disabled={generating || !topic} class="px-4 py-2 bg-accent text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50">
        {generating ? 'Generating...' : 'Generate'}
      </button>
    </div>
  </div>

  <div class="space-y-2">
    <label for="content" class="block text-sm font-medium">Content</label>
    <textarea id="content" bind:value={contentText} rows={10} class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background resize-y" placeholder="Write your post content..."></textarea>
    <p class="text-xs text-muted-foreground">{contentText.length} characters</p>
  </div>

  <div class="bg-card border border-border rounded-lg p-4 space-y-3">
    <label class="flex items-center gap-2 text-sm font-medium">
      <input type="checkbox" bind:checked={() => !!scheduledAt, (v) => scheduledAt = v ? new Date(Date.now() + 3600000).toISOString().slice(0, 16) : ''} class="rounded" />
      Schedule for later
    </label>
    {#if scheduledAt}
      <input type="datetime-local" bind:value={scheduledAt} class="px-3 py-2 border border-border rounded-md text-sm bg-background" />
    {/if}
  </div>

  <div class="flex gap-3">
    <button onclick={() => save('draft')} disabled={saving || !contentText} class="px-4 py-2 border border-border rounded-md text-sm font-medium hover:bg-muted disabled:opacity-50">Save Draft</button>
    {#if scheduledAt}
      <button onclick={() => save('scheduled')} disabled={saving || !contentText} class="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50">Schedule</button>
    {:else}
      <button onclick={() => save('draft')} disabled={saving || !contentText} class="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50">Publish Now</button>
    {/if}
  </div>
</div>
