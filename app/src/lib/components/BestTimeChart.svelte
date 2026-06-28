<script lang="ts">
type Slot = {
  platform: string;
  hour: number;
  dayOfWeek: number;
  avgEngagementRate: number;
  postCount: number;
};

let {
  slots = [] as Slot[],
  title = "Best Posting Times",
}: {
  slots?: Slot[];
  title?: string;
} = $props();

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const _hours = Array.from({ length: 24 }, (_, h) => h);

// Build a 7×24 lookup keyed by `${dayOfWeek}:${hour}`.
const cellMap = $derived.by(() => {
  const m = new Map<string, { rate: number; count: number; platform: string }>();
  for (const s of slots) {
    const key = `${s.dayOfWeek}:${s.hour}`;
    // If multiple platforms map to the same cell, keep the highest rate.
    const existing = m.get(key);
    if (!existing || s.avgEngagementRate > existing.rate) {
      m.set(key, { rate: s.avgEngagementRate, count: s.postCount, platform: s.platform });
    }
  }
  return m;
});

const maxRate = $derived(Math.max(0, ...Array.from(cellMap.values()).map((c) => c.rate)));

// Per-platform top 3 list (slot array already arrives pre-sorted per platform).
const _topPerPlatform = $derived.by(() => {
  const grouped = new Map<string, Slot[]>();
  for (const s of slots) {
    const arr = grouped.get(s.platform) ?? [];
    arr.push(s);
    grouped.set(s.platform, arr);
  }
  return Array.from(grouped.entries()).map(([platform, list]) => ({
    platform,
    items: list.slice(0, 3),
  }));
});

function _colorForRate(rate: number): string {
  if (maxRate <= 0) return "transparent";
  const t = Math.max(0, Math.min(1, rate / maxRate));
  // Gradient from muted blue (low) to vivid primary (high).
  // Mix between hsl(220, 60%, 92%) and hsl(220, 90%, 45%).
  const lightness = 92 - t * 47;
  const saturation = 60 + t * 30;
  return `hsl(220, ${saturation}%, ${lightness}%)`;
}

function formatHour(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function _formatSlot(s: Slot): string {
  return `${days[s.dayOfWeek]} ${formatHour(s.hour)} · ${s.avgEngagementRate.toFixed(1)}%`;
}
</script>

<div class="bg-card border border-border rounded-lg p-6">
  <div class="flex items-center justify-between mb-4">
    <h2 class="text-lg font-semibold">{title}</h2>
    {#if slots.length > 0}
      <span class="text-xs text-muted-foreground">
        Based on {slots.length} time slot{slots.length === 1 ? '' : 's'} (last 90 days)
      </span>
    {/if}
  </div>

  {#if slots.length === 0}
    <p class="text-muted-foreground text-center py-8">
      Not enough data to determine best posting times. Publish more posts to see patterns.
    </p>
  {:else}
    <!-- Heatmap: 24 hour columns × 7 day rows -->
    <div class="overflow-x-auto pb-2">
      <div class="min-w-[720px]">
        <!-- Hour header -->
        <div class="grid grid-cols-[40px_repeat(24,minmax(0,1fr))] gap-1 text-[10px] text-muted-foreground mb-1">
          <div></div>
          {#each hours as h}
            <div class="text-center">{h % 3 === 0 ? formatHour(h) : ''}</div>
          {/each}
        </div>

        <!-- Day rows -->
        {#each days as dayName, dayIdx}
          <div class="grid grid-cols-[40px_repeat(24,minmax(0,1fr))] gap-1 mb-1">
            <div class="text-xs text-muted-foreground flex items-center">{dayName}</div>
            {#each hours as h}
              {@const cell = cellMap.get(`${dayIdx}:${h}`)}
              {#if cell}
                <div
                  class="aspect-square rounded-sm transition-transform hover:scale-110 cursor-default"
                  style:background={colorForRate(cell.rate)}
                  title="{dayName} {formatHour(h)} — {cell.rate.toFixed(1)}% engagement ({cell.count} post{cell.count === 1 ? '' : 's'})"
                ></div>
              {:else}
                <div
                  class="aspect-square rounded-sm border border-dashed border-border/40"
                  title="{dayName} {formatHour(h)} — no data"
                ></div>
              {/if}
            {/each}
          </div>
        {/each}
      </div>
    </div>

    <!-- Legend -->
    <div class="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
      <span>Low</span>
      <div class="flex gap-0.5">
        {#each [0.2, 0.4, 0.6, 0.8, 1.0] as t}
          <div
            class="w-4 h-3 rounded-sm"
            style:background={colorForRate(t * maxRate)}
          ></div>
        {/each}
      </div>
      <span>High engagement</span>
    </div>

    <!-- Per-platform top 3 -->
    {#if topPerPlatform.length > 0}
      <div class="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {#each topPerPlatform as { platform, items }}
          {@const brandColor = (platformBrandColors as Record<string, string>)[platform] ?? platformFallbackColor}
          <div class="rounded-lg border border-border p-3">
            <div class="flex items-center gap-2 mb-2">
              <span class="inline-block w-2.5 h-2.5 rounded-full" style:background={brandColor}></span>
              <span class="font-medium text-sm capitalize">{platform}</span>
            </div>
            <ol class="space-y-1.5">
              {#each items as slot, i}
                <li class="flex items-center justify-between text-xs">
                  <span class="flex items-center gap-2">
                    <span class="w-4 text-center text-muted-foreground">{i + 1}</span>
                    <span class="font-mono">{formatSlot(slot)}</span>
                  </span>
                  <span class="text-muted-foreground">{slot.postCount}p</span>
                </li>
              {/each}
            </ol>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>