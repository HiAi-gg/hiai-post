<script lang="ts">
let { platform = "instagram", content = "", mediaUrls = [] as string[] } = $props();

const charLimits: Record<string, number> = {
  instagram: 2200,
  tiktok: 2200,
  x: 280,
  linkedin: 3000,
  facebook: 63206,
  telegram: 4096,
  threads: 500,
  pinterest: 500,
};

const limit = $derived(charLimits[platform] ?? 2200);
const _isOver = $derived(content.length > limit);
</script>

<div class="bg-card border border-border rounded-lg p-4">
  <div class="flex items-center justify-between mb-3">
    <p class="text-xs font-medium text-muted-foreground uppercase">{platform} preview</p>
    <span class="text-[10px]" class:text-destructive={isOver} class:text-muted-foreground={!isOver}>{content.length}/{limit}</span>
  </div>

  {#if platform === 'instagram'}
    <div class="border border-border rounded-lg overflow-hidden max-w-sm">
      <div class="flex items-center gap-2 p-3">
        <div class="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500"></div>
        <p class="text-sm font-medium">your_username</p>
      </div>
      {#if mediaUrls.length > 0}
        <div class="aspect-square bg-muted flex items-center justify-center overflow-hidden">
          {#if mediaUrls[0].match(/\.(jpg|jpeg|png|gif|webp)$/i) || mediaUrls[0].startsWith('blob:')}
            <img src={mediaUrls[0]} alt="Post media" class="w-full h-full object-cover" />
          {:else}
            <span class="text-4xl">🎬</span>
          {/if}
        </div>
      {:else}
        <div class="aspect-square bg-muted flex items-center justify-center">
          <span class="text-muted-foreground text-sm">📷 No media</span>
        </div>
      {/if}
      <div class="p-3">
        <p class="text-sm"><strong class="text-primary">your_username</strong> <span class="whitespace-pre-wrap">{content}</span></p>
        {#if mediaUrls.length > 1}
          <p class="text-xs text-muted-foreground mt-1">📸 +{mediaUrls.length - 1} more (carousel)</p>
        {/if}
      </div>
    </div>

  {:else if platform === 'x'}
    <div class="border border-border rounded-lg p-4 max-w-md">
      <div class="flex gap-3">
        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 shrink-0 flex items-center justify-center text-white font-bold text-sm">𝕏</div>
        <div class="flex-1">
          <p class="text-sm"><strong>Your Name</strong> <span class="text-muted-foreground">@handle · now</span></p>
          <p class="text-sm mt-1 whitespace-pre-wrap">{content}</p>
          {#if mediaUrls.length > 0}
            <div class="mt-2 rounded-xl overflow-hidden border border-border">
              <img src={mediaUrls[0]} alt="Media" class="w-full h-auto max-h-60 object-cover" />
            </div>
          {/if}
          <div class="flex gap-6 mt-3 text-muted-foreground text-xs">
            <span>💬 0</span><span>🔁 0</span><span>❤️ 0</span><span>📊 0</span>
          </div>
        </div>
      </div>
    </div>

  {:else if platform === 'linkedin'}
    <div class="border border-border rounded-lg p-4 max-w-md">
      <div class="flex items-center gap-2 mb-3">
        <div class="w-12 h-12 rounded-full bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center text-white font-bold">Y</div>
        <div>
          <p class="text-sm font-medium">Your Name</p>
          <p class="text-xs text-muted-foreground">Title at Company</p>
        </div>
      </div>
      <p class="text-sm whitespace-pre-wrap mb-3">{content}</p>
      {#if mediaUrls.length > 0}
        <div class="rounded overflow-hidden border border-border">
          <img src={mediaUrls[0]} alt="Media" class="w-full h-auto max-h-60 object-cover" />
        </div>
      {/if}
    </div>

  {:else if platform === 'facebook'}
    <div class="border border-border rounded-lg p-4 max-w-md">
      <div class="flex items-center gap-2 mb-3">
        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold">Y</div>
        <div>
          <p class="text-sm font-medium">Your Page</p>
          <p class="text-xs text-muted-foreground">Just now · 🌍</p>
        </div>
      </div>
      <p class="text-sm whitespace-pre-wrap mb-3">{content}</p>
      {#if mediaUrls.length > 0}
        <div class="rounded overflow-hidden">
          <img src={mediaUrls[0]} alt="Media" class="w-full h-auto object-cover" />
        </div>
      {/if}
    </div>

  {:else if platform === 'tiktok'}
    <div class="border border-border rounded-lg overflow-hidden max-w-[200px] mx-auto bg-black text-white">
      <div class="aspect-[9/16] flex flex-col justify-end p-3 bg-gradient-to-t from-black/80 to-transparent">
        <p class="text-sm font-semibold mb-1">@your_username</p>
        <p class="text-xs whitespace-pre-wrap line-clamp-3">{content}</p>
        {#if mediaUrls.length > 0}
          <div class="absolute inset-0 -z-10">
            <img src={mediaUrls[0]} alt="" class="w-full h-full object-cover" />
          </div>
        {/if}
      </div>
    </div>

  {:else if platform === 'telegram'}
    <div class="border border-border rounded-lg overflow-hidden max-w-sm bg-[var(--background)]">
      <div class="bg-[var(--platform-telegram)] text-white p-3 rounded-t-lg">
        <p class="text-sm font-medium">Your Channel</p>
      </div>
      <div class="p-3">
        <p class="text-sm whitespace-pre-wrap">{content}</p>
        {#if mediaUrls.length > 0}
          <div class="mt-2 rounded overflow-hidden">
            <img src={mediaUrls[0]} alt="Media" class="w-full h-auto max-h-60 object-cover" />
          </div>
        {/if}
      </div>
    </div>

  {:else if platform === 'threads'}
    <div class="border border-border rounded-lg overflow-hidden max-w-sm bg-[var(--background)]">
      <div class="flex items-center gap-2 p-3">
        <div class="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-xs font-bold">@</div>
        <p class="text-sm font-medium">your_username</p>
      </div>
      <div class="px-3 pb-3">
        <p class="text-sm whitespace-pre-wrap">{content}</p>
        {#if mediaUrls.length > 0}
          <div class="mt-2 rounded-lg overflow-hidden">
            <img src={mediaUrls[0]} alt="Media" class="w-full h-auto max-h-60 object-cover" />
          </div>
        {/if}
      </div>
    </div>

  {:else if platform === 'pinterest'}
    <div class="border border-border rounded-lg overflow-hidden max-w-[200px] mx-auto">
      {#if mediaUrls.length > 0}
        <div class="aspect-[2/3] bg-muted overflow-hidden rounded-t-lg">
          <img src={mediaUrls[0]} alt="Pin" class="w-full h-full object-cover" />
        </div>
      {:else}
        <div class="aspect-[2/3] bg-muted flex items-center justify-center rounded-t-lg">
          <span class="text-4xl">📌</span>
        </div>
      {/if}
      <div class="p-2">
        <p class="text-xs font-medium line-clamp-2">{content}</p>
      </div>
    </div>

  {:else}
    <div class="border border-border rounded-lg p-4 max-w-md">
      <p class="text-sm whitespace-pre-wrap">{content}</p>
    </div>
  {/if}
</div>
