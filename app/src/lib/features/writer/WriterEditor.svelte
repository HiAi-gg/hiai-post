<script lang="ts">
import { Badge } from "@hiai/ui/components/ui/badge/index.js";
import { Button } from "@hiai/ui/components/ui/button/index.js";
import {
  Card,
  CardContent,
  CardDescription,
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
  approveContent,
  type ContentItem,
  type ContentRevision,
  createRevision,
  getContentItem,
  listRevisions,
  requestContentChanges,
  restoreRevision,
  rewriteWriter,
  submitForReview,
  type WriterApiError,
  type WriterRewriteInput,
} from "./api";

/**
 * Focused Writer editor: edit the working copy, rewrite/regenerate via the
 * backend, browse immutable revisions, restore a past snapshot, and drive
 * the review/approval state machine. Every button performs a REAL API call
 * (same-origin proxy) — there are no placeholder actions.
 *
 * `item` is bindable so the page keeps the selected item in sync. When the
 * backend returns a refreshed item (rewrite/restore/review), `onItemChanged`
 * lets the parent refresh its lists.
 */

interface Props {
  item?: ContentItem | null;
  onItemChanged?: (item: ContentItem) => void;
}

let { item = $bindable<ContentItem | null>(null), onItemChanged }: Props = $props();

// ── Working copy (synced when the selected item changes) ────────────────
let title = $state("");
let bodyText = $state("");
let loadedItemId = $state<string | null>(null);

// ── Rewrite params ───────────────────────────────────────────────────────
let rewriteInstruction = $state("");
let rewriteTone = $state("");
let rewriteLanguage = $state("en");

// ── Revisions ────────────────────────────────────────────────────────────
let revisions = $state<ContentRevision[]>([]);
let revisionsLoading = $state(false);
let revisionsError = $state<string | null>(null);

// ── Busy / error state per action ────────────────────────────────────────
let saving = $state(false);
let rewriting = $state(false);
let restoringId = $state<string | null>(null);
let reviewing = $state(false);
let requestingChanges = $state(false);
let changesNote = $state("");
let actionError = $state<string | null>(null);

const backendLabel = $derived.by(() => {
  const backend = item?.bodyJson?.backend;
  if (backend === "hiai-kit:content.article") return "hiai-kit content.article";
  if (backend === "local:content-generate") return "local writer fallback (temporary)";
  return backend ? String(backend) : "";
});

const statusVariant = $derived.by(() => {
  const status = item?.status;
  if (status === "approved") return "default" as const;
  if (status === "in_review") return "secondary" as const;
  if (status === "changes_requested") return "destructive" as const;
  return "outline" as const;
});

const latestRevisionNumber = $derived(revisions[0]?.revisionNumber ?? 0);

function errorText(err: unknown): string {
  if (err instanceof Error && "status" in err && (err as WriterApiError).correlationId) {
    const e = err as WriterApiError;
    return `${e.message}${e.correlationId ? ` (correlation ${e.correlationId})` : ""}`;
  }
  return err instanceof Error ? err.message : String(err);
}

async function loadRevisions() {
  if (!item) return;
  const id = item.id;
  revisionsLoading = true;
  revisionsError = null;
  try {
    const result = await listRevisions(id);
    if (id !== item?.id) return; // item switched while loading
    revisions = result.revisions;
  } catch (err) {
    revisionsError = errorText(err);
  } finally {
    if (id === item?.id) revisionsLoading = false;
  }
}

// Reset the working copy + load history whenever the selected item changes.
$effect(() => {
  if (!item) {
    loadedItemId = null;
    return;
  }
  if (item.id === loadedItemId) return;
  loadedItemId = item.id;
  title = item.title;
  bodyText = item.bodyText ?? "";
  rewriteInstruction = "";
  changesNote = "";
  actionError = null;
  void loadRevisions();
});

function publishItem(updated: ContentItem) {
  item = updated;
  onItemChanged?.(updated);
}

/** Save the edited working copy as a new revision (history preserved). */
async function saveEdit() {
  if (!item || saving) return;
  actionError = null;
  saving = true;
  try {
    const { revision } = await createRevision(item.id, {
      title: title.trim() || item.title,
      bodyText,
      changeNote: "Manual edit",
    });
    const current = await getContentItem(item.id);
    publishItem(current.item);
    revisions = [revision, ...revisions.filter((r) => r.id !== revision.id)];
  } catch (err) {
    actionError = errorText(err);
  } finally {
    saving = false;
  }
}

/** Rewrite/regenerate via POST /api/v1/writer/rewrite (append-only). */
async function rewrite() {
  if (!item || rewriting) return;
  if (!rewriteInstruction.trim()) {
    actionError = "Enter a rewrite instruction first.";
    return;
  }
  actionError = null;
  rewriting = true;
  try {
    const input: WriterRewriteInput = {
      contentItemId: item.id,
      topic: title.trim() || item.title,
      instruction: rewriteInstruction.trim(),
      language: rewriteLanguage.trim() || "en",
      tone: rewriteTone.trim() || undefined,
    };
    const result = await rewriteWriter(input);
    publishItem(result.item);
    void loadRevisions();
  } catch (err) {
    actionError = errorText(err);
  } finally {
    rewriting = false;
  }
}

/** Restore a historical snapshot (copies + appends — never rewrites history). */
async function restore(rev: ContentRevision) {
  if (!item || restoringId) return;
  actionError = null;
  restoringId = rev.id;
  try {
    const result = await restoreRevision(item.id, rev.id);
    publishItem(result.item);
    void loadRevisions();
  } catch (err) {
    actionError = errorText(err);
  } finally {
    restoringId = null;
  }
}

/** Submit the current working copy for review (draft/changes_requested → in_review). */
async function submitReview() {
  if (!item || reviewing) return;
  actionError = null;
  reviewing = true;
  try {
    const result = await submitForReview(item.id);
    publishItem(result.item);
  } catch (err) {
    actionError = errorText(err);
  } finally {
    reviewing = false;
  }
}

/** Approve (in_review → approved) — admin+; editors get a surfaced 403. */
async function approve() {
  if (!item || reviewing) return;
  actionError = null;
  reviewing = true;
  try {
    const result = await approveContent(item.id);
    publishItem(result.item);
  } catch (err) {
    actionError = errorText(err);
  } finally {
    reviewing = false;
  }
}

/** Request changes (in_review → changes_requested) with a reviewer note — editor+. */
async function requestChanges() {
  if (!item || requestingChanges) return;
  if (!changesNote.trim()) {
    actionError = "Enter a note describing the requested changes first.";
    return;
  }
  actionError = null;
  requestingChanges = true;
  try {
    const result = await requestContentChanges(item.id, changesNote.trim());
    publishItem(result.item);
    changesNote = "";
  } catch (err) {
    actionError = errorText(err);
  } finally {
    requestingChanges = false;
  }
}
</script>

{#if !item}
  <Card>
    <CardContent class="py-10">
      <p class="text-center text-sm text-muted-foreground">
        Generate or select a content item to start editing.
      </p>
    </CardContent>
  </Card>
{:else}
  <Card>
    <CardHeader>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <CardTitle class="truncate">{item.title || "Untitled"}</CardTitle>
          <CardDescription>
            Revision {latestRevisionNumber} · {item.status}
            {#if backendLabel} · {backendLabel}{/if}
          </CardDescription>
        </div>
        <div class="flex items-center gap-2">
          <Badge variant={statusVariant}>{item.status}</Badge>
          {#if item.bodyJson?.contentType}
            <Badge variant="outline">{item.bodyJson.contentType}</Badge>
          {/if}
        </div>
      </div>
    </CardHeader>

    <CardContent class="space-y-5">
      <div class="space-y-2">
        <Label for="writer-editor-title">Title</Label>
        <Input id="writer-editor-title" bind:value={title} />
      </div>

      <div class="space-y-2">
        <Label for="writer-editor-body">Content</Label>
        <Textarea id="writer-editor-body" bind:value={bodyText} rows={14} class="font-mono text-sm" />
      </div>

      {#if actionError}
        <p class="text-sm text-destructive" role="alert">{actionError}</p>
      {/if}

      <div class="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onclick={saveEdit} disabled={saving || !title.trim()}>
          {saving ? "Saving…" : "Save edit"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onclick={submitReview}
          disabled={reviewing || item.status === "in_review" || item.status === "approved"}
        >
          {reviewing ? "Submitting…" : "Submit for review"}
        </Button>
        {#if item.status === "in_review"}
          <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Input
              id="writer-changes-note"
              bind:value={changesNote}
              placeholder="Changes needed…"
              class="w-full sm:w-64"
            />
            <Button
              type="button"
              variant="outline"
              onclick={requestChanges}
              disabled={requestingChanges || !changesNote.trim()}
            >
              {requestingChanges ? "Requesting…" : "Request changes"}
            </Button>
          </div>
        {/if}
        <Button
          type="button"
          onclick={approve}
          disabled={reviewing || item.status !== "in_review"}
        >
          {reviewing ? "Approving…" : "Approve"}
        </Button>
      </div>

      <div class="space-y-3 rounded-md border border-border p-3">
        <div class="flex items-center justify-between">
          <Label for="writer-rewrite-instruction">Rewrite / regenerate</Label>
          <span class="text-xs text-muted-foreground">
            {#if item.bodyJson?.backend === "hiai-kit:content.article"}
              hiai-kit content.article
            {:else}
              local writer fallback (temporary — hiai-kit content.post not implemented)
            {/if}
          </span>
        </div>
        <Textarea
          id="writer-rewrite-instruction"
          bind:value={rewriteInstruction}
          placeholder="e.g. tighten the hook, add an FAQ section, make it punchier…"
          rows={3}
        />
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-2">
            <Label for="writer-rewrite-tone">Tone (optional)</Label>
            <SelectRoot type="single" bind:value={rewriteTone}>
              <SelectTrigger id="writer-rewrite-tone" class="w-full">
                <SelectValue placeholder="Keep current tone" />
              </SelectTrigger>
              <SelectContent>
                {#each ["professional", "casual", "humorous", "inspirational", "neutral", "executive", "technical", "creative"] as tone}
                  <SelectItem value={tone}>{tone}</SelectItem>
                {/each}
              </SelectContent>
            </SelectRoot>
          </div>
          <div class="space-y-2">
            <Label for="writer-rewrite-language">Language</Label>
            <Input id="writer-rewrite-language" bind:value={rewriteLanguage} placeholder="en" />
          </div>
        </div>
        <Button type="button" onclick={rewrite} disabled={rewriting || !rewriteInstruction.trim()}>
          {rewriting ? "Rewriting…" : "Rewrite / regenerate"}
        </Button>
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <Label>Revisions ({revisions.length})</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onclick={() => void loadRevisions()}
            disabled={revisionsLoading}
          >
            Refresh
          </Button>
        </div>

        {#if revisionsLoading}
          <p class="text-sm text-muted-foreground py-4 text-center">Loading revisions…</p>
        {:else if revisionsError}
          <p class="text-sm text-destructive" role="alert">Failed to load revisions: {revisionsError}</p>
        {:else if revisions.length === 0}
          <p class="text-sm text-muted-foreground py-4 text-center">No revisions yet.</p>
        {:else}
          <ul class="space-y-2">
            {#each revisions as rev}
              <li class="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">
                    Revision #{rev.revisionNumber}
                    {#if rev.revisionNumber === latestRevisionNumber}
                      <span class="text-xs font-normal text-muted-foreground">(current)</span>
                    {/if}
                  </p>
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    {new Date(rev.createdAt).toLocaleString()}
                    {#if rev.changeNote} · {rev.changeNote}{/if}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onclick={() => void restore(rev)}
                  disabled={restoringId !== null || rev.revisionNumber === latestRevisionNumber}
                >
                  {restoringId === rev.id ? "Restoring…" : "Restore"}
                </Button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </CardContent>
  </Card>
{/if}
