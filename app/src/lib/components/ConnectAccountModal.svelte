<script lang="ts">
let { open = $bindable(false), onConnect } = $props();

const _PLATFORMS = [
  { id: "instagram", name: "Instagram" },
  { id: "tiktok", name: "TikTok" },
  { id: "x", name: "X (Twitter)" },
  { id: "linkedin", name: "LinkedIn" },
  { id: "facebook", name: "Facebook" },
  { id: "telegram", name: "Telegram" },
];

async function _connect(platformId: string) {
  if (onConnect) await onConnect(platformId);
  open = false;
}
</script>

{#if open}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onclick={() => open = false} role="dialog" aria-modal="true">
    <div class="bg-card rounded-lg shadow-lg p-6 max-w-sm w-full mx-4" onclick={e => e.stopPropagation()}>
      <h2 class="text-lg font-bold mb-4">Connect Account</h2>
      <div class="space-y-2">
        {#each PLATFORMS as p}
          <button onclick={() => connect(p.id)} class="w-full text-left px-4 py-3 border border-border rounded-lg hover:bg-muted transition-colors">
            <p class="font-medium">{p.name}</p>
          </button>
        {/each}
      </div>
      <button onclick={() => open = false} class="mt-4 w-full px-4 py-2 text-sm text-muted-foreground hover:bg-muted rounded-md">Cancel</button>
    </div>
  </div>
{/if}
