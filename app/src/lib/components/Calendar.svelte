<script lang="ts">
  import { onMount } from 'svelte';
  import { platformBrandColors, platformFallbackColor } from '../platform-brand-colors';

  interface Post {
    id: string;
    title?: string;
    contentText: string;
    platform: string;
    date: string; // YYYY-MM-DD
    status: 'draft' | 'scheduled' | 'published' | 'failed';
  }

  let { posts = [] as Post[], onDateClick, onPostClick, onPostMove } = $props();

  let currentDate = $state(new Date());
  let view = $state<'month' | 'week'>('month');
  let dragTarget = $state<string | null>(null);
  let dragOver = $state<string | null>(null);

  const platformColors: Record<string, string> = platformBrandColors;

  const platformIcons: Record<string, string> = {
    instagram: '📸',
    tiktok: '🎵',
    x: '𝕏',
    linkedin: '💼',
    facebook: '📘',
    telegram: '✈️',
  };

  const statusStyles: Record<string, string> = {
    draft: 'opacity-60 border-dashed',
    scheduled: '',
    published: 'bg-green-500/10 text-green-600',
    failed: 'bg-red-500/10 text-red-600',
  };

  const monthStart = $derived(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
  const monthEnd = $derived(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0));
  const startDay = $derived(monthStart.getDay());

  const days = $derived.by(() => {
    const result: Array<{ date: Date; posts: Post[] }> = [];
    for (let i = 0; i < startDay; i++) {
      result.push({ date: new Date(monthStart.getTime() - (startDay - i) * 86400000), posts: [] });
    }
    for (let d = 1; d <= monthEnd.getDate(); d++) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), d);
      const dateStr = date.toISOString().slice(0, 10);
      result.push({ date, posts: posts.filter((p: Post) => p.date === dateStr) });
    }
    while (result.length % 7 !== 0) {
      const last = result[result.length - 1];
      result.push({ date: new Date(last.date.getTime() + 86400000), posts: [] });
    }
    return result;
  });

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function prev() { currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1); }
  function next() { currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1); }
  function today() { currentDate = new Date(); }

  const monthLabel = $derived(`${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`);

  function handleDragStart(e: DragEvent, postId: string) {
    dragTarget = postId;
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: DragEvent, dateStr: string) {
    e.preventDefault();
    dragOver = dateStr;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(e: DragEvent, dateStr: string) {
    e.preventDefault();
    if (dragTarget && onPostMove) {
      onPostMove(dragTarget, dateStr);
    }
    dragTarget = null;
    dragOver = null;
  }

  function handleDragEnd() {
    dragTarget = null;
    dragOver = null;
  }

  function handleDateClick(dateStr: string) {
    if (onDateClick) onDateClick(dateStr);
  }

  function handlePostClick(e: Event, postId: string) {
    e.stopPropagation();
    if (onPostClick) onPostClick(postId);
  }

  function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + '...' : text;
  }
</script>

<div class="bg-card border border-border rounded-lg overflow-hidden select-none">
  <div class="flex items-center justify-between p-4 border-b border-border">
    <div class="flex gap-2">
      <button onclick={prev} class="p-1.5 hover:bg-muted rounded-md transition-colors" aria-label="Previous month">&larr;</button>
      <button onclick={today} class="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors">Today</button>
      <button onclick={next} class="p-1.5 hover:bg-muted rounded-md transition-colors" aria-label="Next month">&rarr;</button>
    </div>
    <h2 class="font-semibold text-lg">{monthLabel}</h2>
    <div class="flex gap-1">
      <button onclick={() => view = 'month'} class="px-3 py-1 text-xs rounded-md transition-colors" class:bg-primary={view==='month'} class:text-primary-foreground={view==='month'} class:bg-muted={view!=='month'}>Month</button>
      <button onclick={() => view = 'week'} class="px-3 py-1 text-xs rounded-md transition-colors" class:bg-primary={view==='week'} class:text-primary-foreground={view==='week'} class:bg-muted={view!=='week'}>Week</button>
    </div>
  </div>

  <div class="grid grid-cols-7 border-b border-border">
    {#each DAYS as day}
      <div class="p-2 text-xs font-semibold text-center text-muted-foreground uppercase tracking-wider">{day}</div>
    {/each}
  </div>

  <div class="grid grid-cols-7">
    {#each days as { date, posts: dayPosts }}
      {@const dateStr = date.toISOString().slice(0, 10)}
      {@const isToday = date.toDateString() === new Date().toDateString()}
      {@const isCurrentMonth = date.getMonth() === currentDate.getMonth()}
      {@const isDropTarget = dragOver === dateStr}
      <div
        class="min-h-[100px] p-1.5 border-r border-b border-border last:border-r-0 cursor-pointer transition-colors hover:bg-muted/50 {isDropTarget ? 'bg-primary/5 ring-2 ring-primary' : ''} {!isCurrentMonth ? 'opacity-40' : ''}"
        role="gridcell"
        ondragover={(e) => handleDragOver(e, dateStr)}
        ondrop={(e) => handleDrop(e, dateStr)}
        ondragleave={() => dragOver = null}
        onclick={() => handleDateClick(dateStr)}
      >
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-medium inline-flex items-center justify-center w-6 h-6 rounded-full" class:bg-primary={isToday} class:text-primary-foreground={isToday}>
            {date.getDate()}
          </span>
          {#if dayPosts.length > 0}
            <span class="text-[10px] text-muted-foreground">{dayPosts.length}</span>
          {/if}
        </div>
        <div class="space-y-0.5">
          {#each dayPosts.slice(0, 3) as post}
            {@const color = platformColors[post.platform] || platformFallbackColor}
            <div
              class="text-xs rounded px-1.5 py-0.5 truncate cursor-grab active:cursor-grabbing border-l-2 hover:opacity-80 transition-opacity {statusStyles[post.status] || ''}"
              style="border-left-color: {color}; background-color: {color}15;"
              draggable="true"
              ondragstart={(e) => handleDragStart(e, post.id)}
              ondragend={handleDragEnd}
              onclick={(e) => handlePostClick(e, post.id)}
              role="button"
              tabindex="0"
              title="{platformIcons[post.platform] || ''} {truncate(post.contentText, 60)}"
            >
              <span class="mr-0.5">{platformIcons[post.platform] || ''}</span>
              {truncate(post.contentText, 25)}
            </div>
          {/each}
          {#if dayPosts.length > 3}
            <p class="text-[10px] text-muted-foreground pl-1">+{dayPosts.length - 3} more</p>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>
