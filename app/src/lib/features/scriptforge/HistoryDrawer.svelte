<script lang="ts">
import { Badge } from "@hiai/ui/components/ui/badge/index.js";
import { Button } from "@hiai/ui/components/ui/button/index.js";
import { Label } from "@hiai/ui/components/ui/label/index.js";
import { Textarea } from "@hiai/ui/components/ui/textarea/index.js";
import type { ScriptforgeRunSummary } from "./api";
import type { CritiqueResult, ScriptDraft, TopicIdea } from "./types";

type HistoryTab = "scripts" | "drafts" | "topics";

interface Props {
  open: boolean;
  runs: ScriptforgeRunSummary[];
  loading?: boolean;
  error?: string | null;
  selectedRunId?: string | null;
  selectedTopics?: TopicIdea[];
  selectedDrafts?: ScriptDraft[];
  selectedFinals?: ScriptDraft[];
  selectedCritiques?: CritiqueResult[];
  onClose: () => void;
  onRefresh: () => void;
  onOpen: (runId: string, tab: HistoryTab) => void;
  onUseTopic?: (topic: TopicIdea, research: unknown) => void;
  onRePolishSaved?: (script: ScriptDraft, critique: CritiqueResult | undefined, feedback: string) => Promise<void>;
}

let {
  open,
  runs,
  loading = false,
  error = null,
  selectedRunId = null,
  selectedTopics = [],
  selectedDrafts = [],
  selectedFinals = [],
  selectedCritiques = [],
  onClose,
  onRefresh,
  onOpen,
  onUseTopic,
  onRePolishSaved,
}: Props = $props();

let tab = $state<HistoryTab>("scripts");
let feedback = $state("");
let polishError = $state<string | null>(null);
let polishing = $state(false);
const tabs: HistoryTab[] = ["scripts", "drafts", "topics"];

const scripts = $derived(runs.filter((run) => run.finalCount > 0));
const drafts = $derived(runs.filter((run) => run.draftCount > 0));
const topics = $derived(runs.filter((run) => run.topicCount > 0));
const visible = $derived(tab === "scripts" ? scripts : tab === "drafts" ? drafts : topics);

async function polishFirst() {
  if (!onRePolishSaved || !feedback.trim() || selectedFinals.length === 0) return;
  polishing = true;
  polishError = null;
  try {
    await onRePolishSaved(selectedFinals[0]!, selectedCritiques[0], feedback.trim());
    feedback = "";
  } catch (err) {
    polishError = err instanceof Error ? err.message : String(err);
  } finally {
    polishing = false;
  }
}
</script>

{#if open}
  <button
    type="button"
    class="fixed inset-0 z-40 bg-black/50"
    aria-label="Close history"
    onclick={onClose}
  ></button>
  <div
    class="fixed inset-y-0 left-0 z-50 flex w-full max-w-md flex-col border-r border-border bg-background shadow-xl"
    role="dialog"
    aria-modal="true"
    aria-label="Script history"
  >
    <div class="flex items-center justify-between border-b border-border px-4 py-3">
      <div>
        <p class="text-sm font-semibold">History</p>
        <p class="text-xs text-muted-foreground">Runs stored by hiai-kit (survives restart)</p>
      </div>
      <div class="flex gap-2">
        <Button type="button" variant="outline" size="sm" onclick={onRefresh}>Refresh</Button>
        <Button type="button" variant="outline" size="sm" onclick={onClose}>Close</Button>
      </div>
    </div>

    <div class="flex gap-1 border-b border-border px-3 py-2">
      {#each tabs as item (item)}
        <Button type="button" size="sm" variant={tab === item ? "default" : "outline"} onclick={() => (tab = item)}>
          {item}
        </Button>
      {/each}
    </div>

    <div class="flex-1 overflow-y-auto p-3 space-y-2">
      {#if loading}
        <p class="text-sm text-muted-foreground">Loading history…</p>
      {:else if error}
        <p class="text-sm text-destructive" role="alert">{error}</p>
      {:else if visible.length === 0}
        <p class="text-sm text-muted-foreground">No {tab} yet. Run a pipeline to populate this list.</p>
      {:else}
        {#each visible as run (run.runId)}
          <button
            type="button"
            class="w-full rounded-md border border-border p-3 text-left hover:bg-muted/50 {selectedRunId === run.runId
              ? 'border-primary'
              : ''}"
            onclick={() => onOpen(run.runId, tab)}
          >
            <p class="truncate text-sm font-medium">{run.query || run.runId}</p>
            <div class="mt-1 flex flex-wrap gap-1">
              <Badge variant="secondary">{run.topicCount} topics</Badge>
              <Badge variant="secondary">{run.draftCount} drafts</Badge>
              <Badge variant="secondary">{run.finalCount} finals</Badge>
            </div>
            <p class="mt-1 text-[11px] text-muted-foreground">{run.updatedAt || run.createdAt}</p>
          </button>
        {/each}
      {/if}

      {#if selectedRunId}
        <div class="space-y-3 border-t border-border pt-3">
          {#if tab === "topics" && selectedTopics.length > 0}
            {#each selectedTopics as topic (topic.id)}
              <div class="rounded-md border border-border p-3">
                <p class="text-sm font-medium">{topic.title}</p>
                {#if topic.angle}
                  <p class="mt-1 text-xs text-muted-foreground">{topic.angle}</p>
                {/if}
                {#if onUseTopic}
                  <Button class="mt-2" type="button" size="sm" onclick={() => onUseTopic(topic, undefined)}>
                    Use this topic
                  </Button>
                {/if}
              </div>
            {/each}
          {/if}

          {#if tab !== "topics"}
            {#each (tab === "scripts" ? selectedFinals : selectedDrafts) as script, index (script.id ?? index)}
              <div class="rounded-md border border-border p-3">
                <p class="text-sm font-medium">{script.title ?? "Untitled"}</p>
                <p class="mt-1 text-xs italic text-muted-foreground">“{script.hook ?? ""}”</p>
              </div>
            {/each}
          {/if}

          {#if tab === "scripts" && selectedFinals.length > 0 && onRePolishSaved}
            <div class="space-y-2">
              <Label for="history-polish">Re-polish saved script</Label>
              <Textarea id="history-polish" bind:value={feedback} rows={3} />
              {#if polishError}
                <p class="text-sm text-destructive">{polishError}</p>
              {/if}
              <Button type="button" size="sm" onclick={() => void polishFirst()} disabled={polishing || !feedback.trim()}>
                {polishing ? "Polishing…" : "Re-polish saved"}
              </Button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
