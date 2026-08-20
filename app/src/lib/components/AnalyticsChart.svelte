<script lang="ts">
import { BarChart } from "layerchart";
import type { ComponentProps } from "svelte";

// Re-bind the chart component to a local const: the Svelte template needs a
// value import, while the `series` type is derived via `typeof`. Binding it
// here keeps Biome's import organizer from narrowing the import to type-only
// (which Svelte templates cannot use as a component).
const BarChartComponent = BarChart;

/**
 * The default bar color is sourced from the CSS custom property
 * `--chart-1` defined in `app.css` (which itself falls back to
 * the active theme's `--ring` token). Consumers can pass any
 * CSS color string via the `color` prop.
 */
let {
  data = [] as Array<{ date: string; value: number }>,
  label = "Value",
  color = "var(--chart-1)",
} = $props();

// Single-series bar chart config. LayerChart defaults to a `default` series,
// but supplying an explicit `series` array lets us thread the `color` prop
// through to the bars (LayerChart uses `cRange`/series `color`, not a `color`
// prop on `<BarChart>` itself).
const series = $derived<ComponentProps<typeof BarChartComponent>["series"]>([
  {
    key: "value",
    label,
    color,
  },
]);

// X-domain = each date in order, so bar widths are even and tick labels match
// the input. LayerChart's bar band scale otherwise derives order from the
// data array, which is what we want, but pinning the domain keeps the chart
// stable when data is partially updated.
const xDomain = $derived(data.map((d) => d.date));

// Force the chart to re-mount when the data array reference changes so
// LayerChart recomputes scales correctly (avoids stale band positions
// when consumers pass a new array with the same length).
const chartKey = $derived(data.length);
</script>

<div class="bg-card border border-border rounded-lg p-4">
  <p class="text-sm font-medium mb-4">{label}</p>
  <div class="h-32 w-full">
    {#if data.length > 0}
      {#key chartKey}
        <BarChartComponent
          {data}
          x="date"
          y="value"
          {series}
          {xDomain}
          axis
          grid
          rule
          labels={false}
          legend={false}
          bandPadding={0.2}
          props={{
            bars: { radius: 4 },
          }}
        />
      {/key}
    {:else}
      <div class="flex h-full items-center justify-center text-xs text-muted-foreground">
        No data
      </div>
    {/if}
  </div>
</div>
