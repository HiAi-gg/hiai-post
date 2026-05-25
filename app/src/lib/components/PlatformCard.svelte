<script lang="ts">
  let { account, onConnect, onDisconnect } = $props();

  const COLORS: Record<string, string> = {
    instagram: '#E4405F', tiktok: '#000000', x: '#1DA1F2',
    linkedin: '#0A66C2', facebook: '#1877F2', telegram: '#26A5E4',
    threads: '#000000', pinterest: '#E60023',
  };
</script>

<div class="bg-card border border-border rounded-lg p-4 flex items-center gap-4">
  <div class="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold shrink-0"
    style:background={COLORS[account.platform] ?? '#888'}>
    {(account.platform ?? '?')[0].toUpperCase()}
  </div>
  <div class="flex-1 min-w-0">
    <p class="font-medium capitalize">{account.platform}</p>
    <p class="text-sm text-muted-foreground truncate">{account.username ?? account.displayName ?? 'Connected'}</p>
  </div>
  {#if onDisconnect}
    <button onclick={() => onDisconnect(account.id)} class="px-3 py-1.5 text-xs border border-destructive text-destructive rounded-md hover:bg-destructive/10">Disconnect</button>
  {/if}
</div>
