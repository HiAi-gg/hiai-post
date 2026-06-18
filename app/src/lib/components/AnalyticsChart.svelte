<script lang="ts">
  /**
   * The default bar color is sourced from the CSS custom property
   * `--chart-1` defined in `app.css` (which itself falls back to
   * the active theme's `--ring` token). Consumers can pass any
   * CSS color string via the `color` prop.
   */
  let { data = [] as Array<{ date: string; value: number }>, label = 'Value', color = 'var(--chart-1)' } = $props();

  const max = $derived(Math.max(...data.map(d => d.value), 1));
</script>

<div class="bg-card border border-border rounded-lg p-4">
  <p class="text-sm font-medium mb-4">{label}</p>
  <div class="flex items-end gap-1 h-32">
    {#each data as point}
      <div class="flex-1 flex flex-col items-center gap-1">
        <div class="w-full rounded-t transition-all" style:height="{(point.value / max) * 100}%" style:background={color}></div>
      </div>
    {/each}
  </div>
  <div class="flex justify-between mt-2">
    {#if data.length > 0}
      <span class="text-xs text-muted-foreground">{data[0].date}</span>
      <span class="text-xs text-muted-foreground">{data[data.length - 1].date}</span>
    {/if}
  </div>
</div>
