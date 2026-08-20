<script lang="ts">
import { PageHeader } from "@hiai/ui";
import { Badge } from "@hiai/ui/components/ui/badge/index.js";
import { Button } from "@hiai/ui/components/ui/button/index.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@hiai/ui/components/ui/card/index.js";
import { Input } from "@hiai/ui/components/ui/input/index.js";
import { Label } from "@hiai/ui/components/ui/label/index.js";
import {
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValue,
} from "@hiai/ui/components/ui/select/index.js";
import { Textarea } from "@hiai/ui/components/ui/textarea/index.js";
import {
  type ContentItem,
  generateWriter,
  listContentItems,
  listProjects,
  type Project,
  type WriterApiError,
  type WriterContentType,
} from "$lib/features/writer/api";
import WriterEditor from "$lib/features/writer/WriterEditor.svelte";

/**
 * Writer page — AI content generation with a full review workflow.
 *
 * Generate article (hiai-kit content.article) or social_post (temporary
 * local writer fallback) drafts, edit, rewrite/regenerate, browse and
 * restore revisions, and drive submit-review/approve. All API calls go
 * through the same-origin proxy (`/api/v1/*`) — never direct hiai-kit.
 */

// ── Lookup data (projects + recent items) ───────────────────────────────
let projects = $state<Project[]>([]);
let projectsLoading = $state(true);
let projectsError = $state<string | null>(null);

let items = $state<ContentItem[]>([]);
let itemsLoading = $state(true);
let itemsError = $state<string | null>(null);
let activeItemId = $state<string | null>(null);
// Editor-bound working item — synced whenever the selection changes.
let activeItem = $state<ContentItem | null>(null);

// ── Generate form state ─────────────────────────────────────────────────
let projectId = $state("");
let contentType = $state<WriterContentType>("social_post");
let topic = $state("");
let language = $state("en");
let tone = $state("professional");
let instruction = $state("");
let context = $state("");

let generating = $state(false);
let generateError = $state<string | null>(null);

const canGenerate = $derived(topic.trim().length > 0);

// Resolve the selected item (runs after selection / list changes).
$effect(() => {
  activeItem = items.find((i) => i.id === activeItemId) ?? null;
});

const TONES = [
  "professional",
  "casual",
  "humorous",
  "inspirational",
  "neutral",
  "executive",
  "technical",
  "creative",
];

function errorText(err: unknown): string {
  if (err instanceof Error && "status" in err && (err as WriterApiError).correlationId) {
    const e = err as WriterApiError;
    return `${e.message}${e.correlationId ? ` (correlation ${e.correlationId})` : ""}`;
  }
  return err instanceof Error ? err.message : String(err);
}

async function loadProjects() {
  projectsLoading = true;
  projectsError = null;
  try {
    const result = await listProjects();
    projects = result.projects;
  } catch (err) {
    projectsError = errorText(err);
  } finally {
    projectsLoading = false;
  }
}

async function loadItems() {
  itemsLoading = true;
  itemsError = null;
  try {
    const result = await listContentItems({ limit: 20 });
    items = result.items;
    // Keep the selection when it still exists; otherwise fall back to the newest.
    if (!activeItemId || !items.some((i) => i.id === activeItemId)) {
      activeItemId = items[0]?.id ?? null;
    }
  } catch (err) {
    itemsError = errorText(err);
  } finally {
    itemsLoading = false;
  }
}

$effect(() => {
  void loadProjects();
  void loadItems();
});

/** POST /api/v1/writer/generate — create a new content item + revision #1. */
async function handleGenerate() {
  if (generating || !canGenerate) return;
  generateError = null;
  generating = true;
  try {
    const result = await generateWriter({
      projectId: projectId.trim() || undefined,
      contentType,
      topic: topic.trim(),
      language: language.trim() || "en",
      tone: tone.trim() || undefined,
      instruction: instruction.trim() || undefined,
      context: context.trim() || undefined,
    });
    // Refresh the list and select the new item so the editor loads it.
    items = [result.item, ...items.filter((i) => i.id !== result.item.id)];
    activeItemId = result.item.id;
  } catch (err) {
    generateError = errorText(err);
  } finally {
    generating = false;
  }
}

/** Keep the list row + editor in sync when the editor mutates the item. */
function handleItemChanged(updated: ContentItem) {
  items = items.map((i) => (i.id === updated.id ? updated : i));
  if (activeItemId === updated.id) activeItem = updated;
}
</script>

<svelte:head>
  <title>Writer — HiAi Post</title>
</svelte:head>

<div class="mx-auto max-w-7xl space-y-6">
  <PageHeader
    title="Writer"
    description="Generate and refine articles (hiai-kit content.article) and social posts (local writer fallback — hiai-kit content.post is not implemented yet). Drafts persist as content items with immutable revision history and an explicit review flow."
  />

  <div class="grid gap-6 lg:grid-cols-5">
    <!-- Generate form -->
    <Card class="self-start lg:col-span-2">
      <CardHeader>
        <CardTitle>New draft</CardTitle>
        <CardDescription>Pick a project, describe the topic, and generate a first draft.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <Label for="writer-project">Project (optional)</Label>
          {#if projectsLoading}
            <p class="text-sm text-muted-foreground">Loading projects…</p>
          {:else if projectsError}
            <p class="text-sm text-destructive" role="alert">Failed to load projects: {projectsError}</p>
          {:else}
            <SelectRoot type="single" bind:value={projectId}>
              <SelectTrigger id="writer-project" class="w-full">
                <SelectValue placeholder="No project" />
              </SelectTrigger>
              <SelectContent>
                {#each projects as project}
                  <SelectItem value={project.id}>{project.name}</SelectItem>
                {/each}
              </SelectContent>
            </SelectRoot>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="writer-content-type">Content type</Label>
          <SelectRoot type="single" bind:value={contentType}>
            <SelectTrigger id="writer-content-type" class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="social_post">Social post (local writer fallback)</SelectItem>
              <SelectItem value="article">Article (hiai-kit content.article)</SelectItem>
            </SelectContent>
          </SelectRoot>
        </div>

        <div class="space-y-2">
          <Label for="writer-topic">Topic / instruction</Label>
          <Textarea
            id="writer-topic"
            bind:value={topic}
            placeholder="e.g. Launch announcement for our Q3 analytics release"
            rows={3}
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-2">
            <Label for="writer-language">Language</Label>
            <Input id="writer-language" bind:value={language} placeholder="en" />
          </div>
          <div class="space-y-2">
            <Label for="writer-tone">Tone</Label>
            <SelectRoot type="single" bind:value={tone}>
              <SelectTrigger id="writer-tone" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {#each TONES as t}
                  <SelectItem value={t}>{t}</SelectItem>
                {/each}
              </SelectContent>
            </SelectRoot>
          </div>
        </div>

        <div class="space-y-2">
          <Label for="writer-instruction">Instruction (optional)</Label>
          <Textarea
            id="writer-instruction"
            bind:value={instruction}
            placeholder="Additional direction for the generator…"
            rows={2}
          />
        </div>

        <div class="space-y-2">
          <Label for="writer-context">Context (optional)</Label>
          <Textarea
            id="writer-context"
            bind:value={context}
            placeholder="Audience, product details, goals…"
            rows={3}
          />
        </div>

        {#if generateError}
          <p class="text-sm text-destructive" role="alert">Generation failed: {generateError}</p>
        {/if}
      </CardContent>
      <CardFooter>
        <Button type="button" onclick={handleGenerate} disabled={generating || !canGenerate}>
          {generating ? "Generating…" : "Generate draft"}
        </Button>
      </CardFooter>
    </Card>

    <!-- Recent drafts + editor -->
    <div class="space-y-6 lg:col-span-3">
      <Card>
        <CardHeader>
          <CardTitle>Recent drafts</CardTitle>
          <CardDescription>Select a draft to edit, rewrite, restore, or review it.</CardDescription>
        </CardHeader>
        <CardContent class="space-y-3">
          {#if itemsLoading}
            <p class="text-sm text-muted-foreground py-6 text-center">Loading drafts…</p>
          {:else if itemsError}
            <div class="py-6 text-center space-y-3">
              <p class="text-sm text-destructive" role="alert">Failed to load drafts: {itemsError}</p>
              <Button variant="outline" size="sm" onclick={() => void loadItems()}>Retry</Button>
            </div>
          {:else if items.length === 0}
            <p class="text-sm text-muted-foreground py-6 text-center">
              No drafts yet. Generate your first one on the left.
            </p>
          {:else}
            {#each items as item}
              <button
                type="button"
                onclick={() => (activeItemId = item.id)}
                class="flex w-full items-center justify-between gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-muted"
                class:border-primary={item.id === activeItemId}
              >
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{item.title || "Untitled"}</p>
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    {new Date(item.updatedAt).toLocaleString()}
                    {#if item.bodyJson?.contentType} · {item.bodyJson.contentType}{/if}
                  </p>
                </div>
                <Badge
                  variant={item.status === "approved" ? "default" : item.status === "changes_requested" ? "destructive" : "secondary"}
                >
                  {item.status}
                </Badge>
              </button>
            {/each}
          {/if}
        </CardContent>
      </Card>

      <WriterEditor bind:item={activeItem} onItemChanged={handleItemChanged} />
    </div>
  </div>
</div>
