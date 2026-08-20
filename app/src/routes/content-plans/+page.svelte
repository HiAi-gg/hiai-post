<script lang="ts">
import Calendar from "$components/Calendar.svelte";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

// Map content-plan rows onto the Calendar's post shape (date is a timestamp
// in the backend, the calendar wants a YYYY-MM-DD key).
const calendarPosts = $derived.by(() =>
  data.plans.map((plan: any) => ({
    id: plan.id,
    title: plan.title,
    contentText: plan.title ?? "",
    platform: "calendar",
    date: plan.date ? new Date(plan.date).toISOString().slice(0, 10) : "",
    scheduledTime: plan.slotTime,
    status: plan.status,
  }))
);
</script>

<svelte:head>
  <title>Content Plans — HiAi Post</title>
</svelte:head>

<div class="p-6 max-w-7xl mx-auto space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold">Content Plans</h1>
    <button class="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">New Plan</button>
  </div>

  <Calendar posts={calendarPosts} />

  <div class="space-y-2">
    {#if data.plans.length === 0}
      <p class="text-muted-foreground py-8 text-center">No content plans yet. Create one to start scheduling!</p>
    {/if}
    {#each data.plans as plan}
      <div class="bg-card border border-border rounded-lg p-4 flex items-center justify-between">
        <div>
          <p class="font-medium">{plan.title}</p>
          <p class="text-sm text-muted-foreground">{plan.date} {plan.slotTime ?? ''}</p>
        </div>
        <span class="px-2 py-0.5 text-xs rounded-full bg-muted capitalize">{plan.status}</span>
      </div>
    {/each}
  </div>
</div>
