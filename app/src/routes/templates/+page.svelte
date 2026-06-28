<script lang="ts">
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Templates — HiAi Post</title>
</svelte:head>

<div class="p-6 max-w-4xl mx-auto space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold">Templates</h1>
    <button class="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">New Template</button>
  </div>

  <div class="space-y-2">
    {#if data.templates.length === 0}
      <p class="text-muted-foreground py-8 text-center">No templates yet. Create reusable post templates for faster content creation.</p>
    {/if}
    {#each data.templates as tpl}
      <div class="bg-card border border-border rounded-lg p-4 flex items-center justify-between">
        <div class="flex-1 min-w-0">
          <p class="font-medium">{tpl.name}</p>
          <p class="text-sm text-muted-foreground truncate">{tpl.contentText?.slice(0, 120)}</p>
        </div>
        <div class="flex gap-2 items-center ml-4">
          <span class="px-2 py-0.5 text-xs rounded-full bg-muted capitalize">{tpl.platform ?? 'multi'}</span>
          <a href="/templates/{tpl.id}" class="px-3 py-1.5 text-xs border border-border rounded-md hover:bg-muted">Edit</a>
        </div>
      </div>
    {/each}
  </div>
</div>
