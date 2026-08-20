<script lang="ts">
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>Audit Report — HiAi Post</title>
  <meta
    name="description"
    content="HiAi-Post repository audit report — status, findings, blockers, and completion estimates."
  />
</svelte:head>

<div class="mx-auto max-w-5xl space-y-4" data-route="audit">
  <header>
    <h1 class="text-2xl font-semibold tracking-tight">Audit Report</h1>
    <p class="mt-1 text-sm text-muted-foreground">
      Rendered at build time from the canonical
      <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">audit-report.md</code>
      in the repository root (audit dated 2026-08-10).
    </p>
  </header>

  <article class="audit-markdown rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6 md:p-10">
    {@html data.html}
  </article>
</div>

<style>
  /* Route-scoped responsive layout: the root layout always renders the
     AdminSidebar `<aside>`, which eats most of a 375px viewport. Hide it (and
     slim the root `<main>` padding) while this report page is mounted. Other
     routes are unaffected — the `:has()` selector only matches while the
     `[data-route="audit"]` element is in the DOM. */
  @media (max-width: 640px) {
    :global(:root:has([data-route="audit"]) aside) {
      display: none;
    }

    :global(:root:has([data-route="audit"]) main) {
      padding: 1rem;
    }
  }

  .audit-markdown :global(h1) {
    margin: 0 0 1rem;
    font-size: 1.75rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.3;
  }

  .audit-markdown :global(h2) {
    margin: 2.5rem 0 1rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--color-border);
    font-size: 1.375rem;
    font-weight: 600;
    line-height: 1.4;
  }

  .audit-markdown :global(h3) {
    margin: 2rem 0 0.75rem;
    font-size: 1.125rem;
    font-weight: 600;
    line-height: 1.4;
  }

  .audit-markdown :global(h4),
  .audit-markdown :global(h5),
  .audit-markdown :global(h6) {
    margin: 1.5rem 0 0.5rem;
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.4;
  }

  .audit-markdown :global(p) {
    margin: 1rem 0;
    line-height: 1.7;
  }

  .audit-markdown :global(ul),
  .audit-markdown :global(ol) {
    margin: 1rem 0;
    padding-left: 1.75rem;
  }

  .audit-markdown :global(li) {
    margin: 0.4rem 0;
    line-height: 1.6;
  }

  .audit-markdown :global(li > ul),
  .audit-markdown :global(li > ol) {
    margin: 0.4rem 0;
  }

  .audit-markdown :global(a) {
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .audit-markdown :global(a:hover) {
    opacity: 0.85;
  }

  .audit-markdown :global(code) {
    padding: 0.15em 0.4em;
    border-radius: 0.3em;
    background: var(--color-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.85em;
  }

  .audit-markdown :global(pre) {
    margin: 1.25rem 0;
    padding: 1rem 1.25rem;
    overflow-x: auto;
    border-radius: var(--radius);
    background: var(--color-muted);
    font-size: 0.8125rem;
    line-height: 1.6;
  }

  .audit-markdown :global(pre code) {
    display: block;
    padding: 0;
    border-radius: 0;
    background: transparent;
    font-size: inherit;
    line-height: inherit;
    white-space: pre;
  }

  .audit-markdown :global(table) {
    display: block;
    width: max-content;
    max-width: 100%;
    margin: 1.25rem 0;
    overflow-x: auto;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .audit-markdown :global(th),
  .audit-markdown :global(td) {
    border-bottom: 1px solid var(--color-border);
    padding: 0.5rem 0.75rem;
    vertical-align: top;
    text-align: left;
  }

  .audit-markdown :global(th) {
    background: var(--color-muted);
    font-weight: 600;
    white-space: nowrap;
  }

  .audit-markdown :global(tbody tr:nth-child(even) td) {
    background: color-mix(in srgb, var(--color-muted) 35%, transparent);
  }

  .audit-markdown :global(blockquote) {
    margin: 1.25rem 0;
    padding: 0.25rem 1rem;
    border-left: 3px solid var(--color-border);
    color: var(--color-muted-foreground);
  }

  .audit-markdown :global(blockquote p) {
    margin: 0.5rem 0;
  }

  .audit-markdown :global(hr) {
    margin: 2rem 0;
    border: none;
    border-top: 1px solid var(--color-border);
  }

  .audit-markdown :global(strong) {
    color: var(--color-foreground);
  }
</style>
