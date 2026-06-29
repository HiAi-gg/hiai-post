<script lang="ts">
import { type EditorOutput, HiAiEditor } from "@hiai/ui";
import { platformBrandColors } from "../platform-brand-colors";

interface Props {
  content?: string;
  platforms?: string[];
  mediaUrls?: string[];
  scheduledAt?: string;
  onGenerate?: (topic: string) => Promise<string>;
  onPublish?: () => void;
  onSchedule?: (date: string) => void;
}

let {
  content = $bindable(""),
  platforms = $bindable(["instagram"]),
  mediaUrls = $bindable([]),
  scheduledAt = $bindable(""),
  onGenerate,
  onPublish,
  onSchedule,
}: Props = $props();

let topic = $state("");
let _generating = $state(false);
let _showSchedule = $state(false);
let scheduleDate = $state("");
let scheduleTime = $state("");
let _dragActive = $state(false);
let _showPreview = $state(false);
let _selectedPreviewPlatform = $state("instagram");

const _ALL_PLATFORMS = [
  "instagram",
  "tiktok",
  "x",
  "x-post",
  "threads",
  "linkedin",
  "facebook",
  "telegram",
  "pinterest",
  "youtube-shorts",
  "youtube-long",
];
const _platformIcons: Record<string, string> = {
  instagram: "📸",
  tiktok: "🎵",
  x: "🧵",
  "x-post": "𝕏",
  threads: "🧵",
  linkedin: "💼",
  facebook: "📘",
  telegram: "✈️",
  pinterest: "📌",
  "youtube-shorts": "🎬",
  "youtube-long": "▶️",
};
const _platformColors: Record<string, string> = platformBrandColors;

const charLimits: Record<string, number> = {
  instagram: 2200,
  tiktok: 2200,
  x: 275,
  "x-post": 280,
  threads: 500,
  linkedin: 3000,
  facebook: 63206,
  telegram: 4096,
  pinterest: 500,
  "youtube-shorts": 3000,
  "youtube-long": 50000,
};

const activeLimit = $derived(Math.min(...platforms.map((p) => charLimits[p] ?? 2200)));
const remaining = $derived(activeLimit - content.length);
const _overLimit = $derived(remaining < 0);

function _togglePlatform(p: string) {
  if (platforms.includes(p)) {
    if (platforms.length > 1) platforms = platforms.filter((x) => x !== p);
  } else {
    platforms = [...platforms, p];
  }
}

async function _handleGenerate() {
  if (!topic || !onGenerate) return;
  _generating = true;
  try {
    content = await onGenerate(topic);
  } finally {
    _generating = false;
  }
}

function _handleSchedule() {
  if (scheduleDate && scheduleTime && onSchedule) {
    const iso = `${scheduleDate}T${scheduleTime}:00Z`;
    onSchedule(iso);
    _showSchedule = false;
  }
}

function _handleDrop(e: DragEvent) {
  e.preventDefault();
  _dragActive = false;
  const files = e.dataTransfer?.files;
  if (files) {
    for (const file of files) {
      if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
        const url = URL.createObjectURL(file);
        mediaUrls = [...mediaUrls, url];
      }
    }
  }
}

function _removeMedia(index: number) {
  mediaUrls = mediaUrls.filter((_: string, i: number) => i !== index);
}
</script>

<div class="space-y-4">
  <!-- AI Generation -->
  <div class="bg-muted/50 rounded-lg p-3">
    <div class="flex gap-2">
      <input bind:value={topic} placeholder="Enter topic for AI generation..." class="flex-1 px-3 py-2 border border-border rounded-md text-sm bg-background" />
      <button onclick={handleGenerate} disabled={generating || !topic} class="px-4 py-2 bg-accent text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50 transition-opacity">
        {generating ? '⏳ Generating...' : '🤖 AI Generate'}
      </button>
    </div>
  </div>

  <!-- Platform Selector -->
  <div>
    <p class="text-sm font-medium mb-2">Platforms</p>
    <div class="flex flex-wrap gap-2">
      {#each ALL_PLATFORMS as p}
        {@const selected = platforms.includes(p)}
        <button
          onclick={() => togglePlatform(p)}
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
          class:border-transparent={selected}
          class:text-white={selected}
          class:border-border={!selected}
          class:hover:border-muted-foreground={!selected}
          style={selected ? `background-color: ${platformColors[p]}` : ''}
        >
          <span>{platformIcons[p]}</span>
          <span class="capitalize">{p}</span>
        </button>
      {/each}
    </div>
  </div>

  <!-- Content Editor (svelte-tiptap) -->
  <div>
    <div class="border border-border rounded-md overflow-hidden">
      <HiAiEditor
        {content}
        onUpdate={(out: EditorOutput) => {
          content = out.markdown;
          contentJson = out.json;
        }}
        placeholder="Write your post content..."
      />
    </div>
    <div class="flex justify-between mt-1">
      <div class="flex gap-2">
        {#each platforms as p}
          {@const limit = charLimits[p] ?? 2200}
          {@const over = content.length > limit}
          <span class={["text-[10px] px-1.5 py-0.5 rounded capitalize", over && 'bg-red-500/10 text-red-500', !over && 'text-muted-foreground']}>
            {platformIcons[p]} {content.length}/{limit}
          </span>
        {/each}
      </div>
      {#if overLimit}
        <p class="text-xs text-destructive font-medium">⚠ Exceeds limit on some platforms</p>
      {/if}
    </div>
  </div>

  <!-- Media Upload -->
  <div
    class={[
      "border-2 border-dashed rounded-lg p-4 text-center transition-colors",
      dragActive && 'border-primary bg-primary/5',
      !dragActive && 'border-border',
    ]}
    role="region"
    ondragover={(e) => { e.preventDefault(); dragActive = true; }}
    ondragleave={() => dragActive = false}
    ondrop={handleDrop}
  >
    {#if mediaUrls.length > 0}
      <div class="flex flex-wrap gap-2 mb-2">
        {#each mediaUrls as url, i}
          <div class="relative group">
            <div class="w-16 h-16 rounded border border-border bg-muted flex items-center justify-center overflow-hidden">
              {#if url.startsWith('blob:') || url.match(/\.(jpg|jpeg|png|gif|webp)$/i)}
                <img src={url} alt="Media" class="w-full h-full object-cover" />
              {:else}
                <span class="text-xs text-muted-foreground">🎬</span>
              {/if}
            </div>
            <button onclick={() => removeMedia(i)} class="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-destructive-foreground rounded-full text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">✕</button>
          </div>
        {/each}
      </div>
    {/if}
    <p class="text-sm text-muted-foreground">
      {#if mediaUrls.length === 0}
        📁 Drag & drop images/videos here or
        <label class="text-primary cursor-pointer hover:underline">browse<input type="file" accept="image/*,video/*" multiple class="hidden" onchange={(e) => {
          const files = (e.target as HTMLInputElement).files;
          if (files) { for (const f of files) { mediaUrls = [...mediaUrls, URL.createObjectURL(f)]; } }
        }} /></label>
      {:else}
        Drop more files or <label class="text-primary cursor-pointer hover:underline">browse<input type="file" accept="image/*,video/*" multiple class="hidden" onchange={(e) => {
          const files = (e.target as HTMLInputElement).files;
          if (files) { for (const f of files) { mediaUrls = [...mediaUrls, URL.createObjectURL(f)]; } }
        }} /></label>
      {/if}
    </p>
  </div>

  <!-- Actions -->
  <div class="flex items-center gap-3 pt-2">
    <button onclick={onPublish} disabled={!content || overLimit} class="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-semibold disabled:opacity-50 transition-opacity hover:bg-primary/90">
      🚀 Publish Now
    </button>
    <div class="relative">
      <button onclick={() => showSchedule = !showSchedule} class="px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
        📅 Schedule
      </button>
      {#if showSchedule}
        <div class="absolute top-full left-0 mt-2 bg-card border border-border rounded-lg shadow-lg p-4 z-50 w-72">
          <div class="space-y-3">
            <div>
              <label class="text-xs font-medium text-muted-foreground">Date</label>
              <input type="date" bind:value={scheduleDate} class="w-full px-2 py-1.5 border border-border rounded text-sm bg-background" />
            </div>
            <div>
              <label class="text-xs font-medium text-muted-foreground">Time</label>
              <input type="time" bind:value={scheduleTime} class="w-full px-2 py-1.5 border border-border rounded text-sm bg-background" />
            </div>
            <button onclick={handleSchedule} disabled={!scheduleDate || !scheduleTime} class="w-full px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50">Confirm Schedule</button>
          </div>
        </div>
      {/if}
    </div>
    <div class="flex-1"></div>
    <button onclick={() => showPreview = !showPreview} class="px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
      {showPreview ? 'Hide' : '👁 Preview'}
    </button>
  </div>

  <!-- Platform Preview -->
  {#if showPreview}
    <div class="border border-border rounded-lg p-4">
      <div class="flex gap-2 mb-3">
        {#each platforms as p}
          <button
            onclick={() => selectedPreviewPlatform = p}
            class="px-2 py-1 text-xs rounded capitalize transition-colors"
            class:bg-primary={selectedPreviewPlatform === p}
            class:text-primary-foreground={selectedPreviewPlatform === p}
            class:bg-muted={selectedPreviewPlatform !== p}
          >{platformIcons[p]} {p}</button>
        {/each}
      </div>
      <PlatformPreview platform={selectedPreviewPlatform} content={content} mediaUrls={mediaUrls} />
    </div>
  {/if}
</div>
