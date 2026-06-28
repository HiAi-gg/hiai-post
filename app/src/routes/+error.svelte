<script lang="ts">
import { page } from "$app/stores";

let { error } = $props();

const _status = $derived($page.status);
const _message = $derived($page.error?.message ?? error?.message ?? "Something went wrong.");
const _isDev = $derived(import.meta.env.DEV);
const _stack = $derived(error?.stack ?? "");

function _retry() {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}

function _goHome() {
  if (typeof window !== "undefined") {
    window.location.href = "/";
  }
}
</script>

<svelte:head>
  <title>{status} — HiAi Post</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
  <div class="w-full max-w-lg rounded-lg border border-border bg-card p-8 text-center shadow-sm">
    <p class="text-sm font-medium text-muted-foreground">Error {status}</p>

    <h1 class="mt-2 text-2xl font-semibold tracking-tight">
      {status === 404 ? 'Page not found' : 'Something went wrong'}
    </h1>

    <p class="mt-3 text-sm text-muted-foreground">
      {status === 404
        ? "The page you're looking for doesn't exist or has been moved."
        : message}
    </p>

    {#if isDev && stack}
      <pre
        class="mt-6 max-h-48 overflow-auto rounded-md border border-border bg-muted p-3 text-left text-xs text-muted-foreground"
      >{stack}</pre>
    {/if}

    <div class="mt-6 flex justify-center gap-3">
      <button
        type="button"
        onclick={goHome}
        class="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        Go home
      </button>
      <button
        type="button"
        onclick={retry}
        class="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
      >
        Retry
      </button>
    </div>
  </div>
</div>
