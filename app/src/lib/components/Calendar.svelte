<script lang="ts">
import { platformBrandColors } from "../platform-brand-colors";

interface Post {
  id: string;
  title?: string;
  contentText: string;
  platform: string;
  date: string; // YYYY-MM-DD
  scheduledTime?: string; // HH:MM optional
  status: "draft" | "scheduled" | "published" | "failed";
}

let { posts = [] as Post[], onDateClick, onPostClick, onPostMove } = $props();

let currentDate = $state(new Date());
let view = $state<"month" | "week" | "day">("month");
let dragTarget = $state<string | null>(null);
let dragOver = $state<string | null>(null);

const _platformColors: Record<string, string> = platformBrandColors;

const _platformIcons: Record<string, string> = {
  instagram: "📸",
  tiktok: "🎵",
  x: "𝕏",
  linkedin: "💼",
  facebook: "📘",
  telegram: "✈️",
};

const _statusStyles: Record<string, string> = {
  draft: "opacity-60 border-dashed",
  scheduled: "",
  published: "bg-green-500/10 text-green-600",
  failed: "bg-red-500/10 text-red-600",
};

const monthStart = $derived(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
const monthEnd = $derived(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0));
const startDay = $derived(monthStart.getDay());

const _days = $derived.by(() => {
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

// Week view: starts on Sunday of the week containing currentDate
const weekStart = $derived.by(() => {
  const d = new Date(currentDate);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
});

const _weekDays = $derived.by(() => {
  const result: Array<{ date: Date; posts: Post[] }> = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + i);
    const dateStr = date.toISOString().slice(0, 10);
    result.push({
      date,
      posts: posts.filter((p: Post) => p.date === dateStr),
    });
  }
  return result;
});

// Day view: single day = currentDate
const dayDate = $derived.by(() => {
  const d = new Date(currentDate);
  d.setHours(0, 0, 0, 0);
  return d;
});

const _dayPosts = $derived.by(() => {
  const dateStr = dayDate.toISOString().slice(0, 10);
  return posts.filter((p: Post) => p.date === dateStr);
});

// Day-view derived values (replaces inline `{@const}` which Svelte 5 forbids
// outside direct children of `{#if}` / `{#each}` / etc.).
const dayDateStr = $derived(dayDate.toISOString().slice(0, 10));
const _dayIsDropTarget = $derived(dragOver === dayDateStr);

// Hourly slots: 0..23
const _HOURS = Array.from({ length: 24 }, (_, h) => h);

function _postsForHour(list: Post[], hour: number): Post[] {
  return list.filter((p) => {
    if (!p.scheduledTime) return hour === 9; // default bucket at 9am when no time set
    const hh = parseInt(p.scheduledTime.split(":")[0], 10);
    return Number.isFinite(hh) ? hh === hour : false;
  });
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function _prev() {
  if (view === "month") {
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
  } else if (view === "week") {
    currentDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate() - 7
    );
  } else {
    currentDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate() - 1
    );
  }
}

function _next() {
  if (view === "month") {
    currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  } else if (view === "week") {
    currentDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate() + 7
    );
  } else {
    currentDate = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate() + 1
    );
  }
}

function _today() {
  currentDate = new Date();
}

const _monthLabel = $derived(`${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`);

const _weekLabel = $derived.by(() => {
  const end = new Date(weekStart);
  end.setDate(weekStart.getDate() + 6);
  const sameMonth = weekStart.getMonth() === end.getMonth();
  const sameYear = weekStart.getFullYear() === end.getFullYear();
  if (sameMonth) {
    return `${MONTHS[weekStart.getMonth()]} ${weekStart.getDate()}–${end.getDate()}, ${weekStart.getFullYear()}`;
  }
  if (sameYear) {
    return `${MONTHS[weekStart.getMonth()]} ${weekStart.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${weekStart.getFullYear()}`;
  }
  return `${MONTHS[weekStart.getMonth()]} ${weekStart.getDate()}, ${weekStart.getFullYear()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
});

const _dayLabel = $derived(
  `${DAYS[dayDate.getDay()]}, ${MONTHS[dayDate.getMonth()]} ${dayDate.getDate()}, ${dayDate.getFullYear()}`
);

function _formatHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

function _handleDragStart(e: DragEvent, postId: string) {
  dragTarget = postId;
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

function _handleDragOver(e: DragEvent, dateStr: string) {
  e.preventDefault();
  dragOver = dateStr;
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
}

function _handleDrop(e: DragEvent, dateStr: string) {
  e.preventDefault();
  if (dragTarget && onPostMove) {
    onPostMove(dragTarget, dateStr);
  }
  dragTarget = null;
  dragOver = null;
}

function _handleDragEnd() {
  dragTarget = null;
  dragOver = null;
}

function _handleDateClick(dateStr: string) {
  if (onDateClick) onDateClick(dateStr);
}

function _handlePostClick(e: Event, postId: string) {
  e.stopPropagation();
  if (onPostClick) onPostClick(postId);
}

function _truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
</script>

<div class="bg-card border border-border rounded-lg overflow-hidden select-none">
  <div class="flex items-center justify-between p-4 border-b border-border">
    <div class="flex gap-2">
      <button onclick={prev} class="p-1.5 hover:bg-muted rounded-md transition-colors" aria-label="Previous">&larr;</button>
      <button onclick={today} class="px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted transition-colors">Today</button>
      <button onclick={next} class="p-1.5 hover:bg-muted rounded-md transition-colors" aria-label="Next">&rarr;</button>
    </div>
    <h2 class="font-semibold text-lg">
      {#if view === 'month'}{monthLabel}
      {:else if view === 'week'}{weekLabel}
      {:else}{dayLabel}{/if}
    </h2>
    <div class="flex gap-1">
      <button onclick={() => view = 'month'} class="px-3 py-1 text-xs rounded-md transition-colors" class:bg-primary={view==='month'} class:text-primary-foreground={view==='month'} class:bg-muted={view!=='month'}>Month</button>
      <button onclick={() => view = 'week'} class="px-3 py-1 text-xs rounded-md transition-colors" class:bg-primary={view==='week'} class:text-primary-foreground={view==='week'} class:bg-muted={view!=='week'}>Week</button>
      <button onclick={() => view = 'day'} class="px-3 py-1 text-xs rounded-md transition-colors" class:bg-primary={view==='day'} class:text-primary-foreground={view==='day'} class:bg-muted={view!=='day'}>Day</button>
    </div>
  </div>

  {#if view === 'month'}
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

  {:else if view === 'week'}
    <div class="grid grid-cols-7 border-b border-border">
      {#each weekDays as { date }}
        {@const isToday = date.toDateString() === new Date().toDateString()}
        <div class="p-2 text-xs font-semibold text-center text-muted-foreground uppercase tracking-wider">
          <div>{DAYS[date.getDay()]}</div>
          <div class="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full text-sm" class:bg-primary={isToday} class:text-primary-foreground={isToday}>
            {date.getDate()}
          </div>
        </div>
      {/each}
    </div>

    <div class="grid grid-cols-7">
      {#each weekDays as { date, posts: colPosts }}
        {@const dateStr = date.toISOString().slice(0, 10)}
        {@const isDropTarget = dragOver === dateStr}
        <div
          class="border-r border-b border-border last:border-r-0 cursor-pointer transition-colors hover:bg-muted/30 {isDropTarget ? 'bg-primary/5 ring-2 ring-primary' : ''}"
          role="gridcell"
          ondragover={(e) => handleDragOver(e, dateStr)}
          ondrop={(e) => handleDrop(e, dateStr)}
          ondragleave={() => dragOver = null}
          onclick={() => handleDateClick(dateStr)}
        >
          {#each HOURS as h}
            {@const slotPosts = postsForHour(colPosts, h)}
            <div class="h-12 px-1 py-0.5 border-b border-border/40 text-[10px] text-muted-foreground overflow-hidden">
              {#if h === 0 || h % 3 === 0}
                <span class="opacity-50">{formatHour(h)}</span>
              {/if}
              {#each slotPosts as post}
                {@const color = platformColors[post.platform] || platformFallbackColor}
                <div
                  class="mt-0.5 text-[11px] rounded px-1 py-0.5 truncate cursor-grab active:cursor-grabbing border-l-2 hover:opacity-80 transition-opacity {statusStyles[post.status] || ''}"
                  style="border-left-color: {color}; background-color: {color}15;"
                  draggable="true"
                  ondragstart={(e) => handleDragStart(e, post.id)}
                  ondragend={handleDragEnd}
                  onclick={(e) => handlePostClick(e, post.id)}
                  role="button"
                  tabindex="0"
                  title="{platformIcons[post.platform] || ''} {post.scheduledTime ? post.scheduledTime + ' · ' : ''}{truncate(post.contentText, 60)}"
                >
                  <span class="mr-0.5">{platformIcons[post.platform] || ''}</span>
                  {truncate(post.contentText, 22)}
                </div>
              {/each}
            </div>
          {/each}
        </div>
      {/each}
    </div>

  {:else}
    <!-- Day view: single day, hourly slots -->
    <div class="grid grid-cols-[80px_1fr] border-b border-border">
      <div></div>
      <div class="p-2 text-xs font-semibold text-center text-muted-foreground uppercase tracking-wider">
        {dayLabel}
      </div>
    </div>

    <div class="grid grid-cols-[80px_1fr]">
      <div>
        {#each HOURS as h}
          <div class="h-14 px-2 py-1 border-b border-r border-border text-[10px] text-muted-foreground text-right">
            {formatHour(h)}
          </div>
        {/each}
      </div>
      <div>
        <div
          class="cursor-pointer transition-colors hover:bg-muted/30 {dayIsDropTarget ? 'bg-primary/5 ring-2 ring-primary' : ''}"
          role="gridcell"
          ondragover={(e) => handleDragOver(e, dayDateStr)}
          ondrop={(e) => handleDrop(e, dayDateStr)}
          ondragleave={() => dragOver = null}
          onclick={() => handleDateClick(dayDateStr)}
        >
          {#each HOURS as h}
            {@const slotPosts = postsForHour(dayPosts, h)}
            <div class="h-14 px-2 py-1 border-b border-border overflow-hidden">
              {#each slotPosts as post}
                {@const color = platformColors[post.platform] || platformFallbackColor}
                <div
                  class="text-xs rounded px-1.5 py-0.5 mb-0.5 truncate cursor-grab active:cursor-grabbing border-l-2 hover:opacity-80 transition-opacity {statusStyles[post.status] || ''}"
                  style="border-left-color: {color}; background-color: {color}15;"
                  draggable="true"
                  ondragstart={(e) => handleDragStart(e, post.id)}
                  ondragend={handleDragEnd}
                  onclick={(e) => handlePostClick(e, post.id)}
                  role="button"
                  tabindex="0"
                  title="{platformIcons[post.platform] || ''} {post.scheduledTime ? post.scheduledTime + ' · ' : ''}{truncate(post.contentText, 80)}"
                >
                  <span class="mr-1">{platformIcons[post.platform] || ''}</span>
                  {post.scheduledTime ? post.scheduledTime + ' · ' : ''}{truncate(post.contentText, 60)}
                </div>
              {/each}
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>
