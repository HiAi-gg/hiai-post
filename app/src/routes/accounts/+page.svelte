<script lang="ts">
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

const _PLATFORMS = [
  { id: "instagram", name: "Instagram" },
  { id: "tiktok", name: "TikTok" },
  { id: "x", name: "X (Twitter)" },
  { id: "linkedin", name: "LinkedIn" },
  { id: "facebook", name: "Facebook" },
  { id: "telegram", name: "Telegram" },
] as const;

function _isConnected(platformId: string) {
  return data.accounts.some((a: any) => a.platform === platformId);
}

async function _connect(platformId: string) {
  const res = await fetch(`/api/v1/oauth/${platformId}/connect`, { method: "POST" });
  if (res.ok) {
    const body = await res.json();
    if (body.url) window.location.href = body.url;
  }
}

async function _disconnect(accountId: string) {
  if (!confirm("Disconnect this account?")) return;
  await fetch(`/api/v1/accounts/${accountId}`, { method: "DELETE" });
  location.reload();
}
</script>

<svelte:head>
  <title>Social Accounts — HiAi Post</title>
</svelte:head>

<div class="p-6 max-w-4xl mx-auto space-y-6">
  <h1 class="text-2xl font-bold">Social Accounts</h1>

  <div class="grid sm:grid-cols-2 gap-4">
    {#each PLATFORMS as p}
      {@const account = data.accounts.find((a: any) => a.platform === p.id)}
      <div class="bg-card border border-border rounded-lg p-5 flex items-center gap-4">
        <div class="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold shrink-0" style:background={platformLogoColors[p.id]}>
          {p.name[0]}
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-medium">{p.name}</p>
          {#if account}
            <p class="text-sm text-muted-foreground truncate">@{account.username}</p>
          {:else}
            <p class="text-sm text-muted-foreground">Not connected</p>
          {/if}
        </div>
        {#if account}
          <button onclick={() => disconnect(account.id)} class="px-3 py-1.5 text-xs border border-destructive text-destructive rounded-md hover:bg-destructive/10">Disconnect</button>
        {:else}
          <button onclick={() => connect(p.id)} class="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:opacity-90">Connect</button>
        {/if}
      </div>
    {/each}
  </div>
</div>
