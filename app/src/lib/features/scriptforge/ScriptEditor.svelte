<script lang="ts">
import { Badge } from "@hiai/ui/components/ui/badge/index.js";
import { Button } from "@hiai/ui/components/ui/button/index.js";
import { Label } from "@hiai/ui/components/ui/label/index.js";
import { Textarea } from "@hiai/ui/components/ui/textarea/index.js";
import type { ScriptDraft } from "./types";

interface Props {
  script: ScriptDraft;
  isFinal?: boolean;
  showVideoAudio?: boolean;
  editLoading?: boolean;
  onEditRequest?: (feedback: string) => void;
}

let { script, isFinal = false, showVideoAudio = false, editLoading = false, onEditRequest }: Props = $props();

let expanded = $state<number[]>([]);
let copied = $state<"text" | "all" | null>(null);
let showEdit = $state(false);
let feedback = $state("");

function toggle(index: number) {
  expanded = expanded.includes(index) ? expanded.filter((item) => item !== index) : [...expanded, index];
}

async function writeClipboard(text: string, kind: "text" | "all") {
  try {
    await navigator.clipboard.writeText(text);
    copied = kind;
    setTimeout(() => {
      if (copied === kind) copied = null;
    }, 2000);
  } catch {
    copied = null;
  }
}

function copyTextOnly() {
  const lines = [...(script.segments ?? []).map((seg) => seg.text), script.cta].filter(Boolean);
  void writeClipboard(lines.join("\n"), "text");
}

function copyAll() {
  const model = script.metadata?.polishModelUsed
    ? `${script.metadata.modelUsed ?? "unknown"} + ${script.metadata.polishModelUsed}`
    : (script.metadata?.modelUsed ?? "unknown");
  const lines = [
    `# ${script.title ?? "Untitled script"}`,
    `Duration: ${script.duration ?? "?"}s | Language: ${script.language ?? "?"} | Words: ${script.metadata?.wordCount ?? "?"} | Model: ${model}`,
    "",
    "## HOOK",
    script.hook ?? "",
    "",
    "## SCRIPT",
    ...(script.segments ?? []).map((seg) => `[${seg.timestamp ?? ""}]\n${seg.text ?? ""}`),
    "",
    "## CTA",
    script.cta ?? "",
  ];
  void writeClipboard(lines.join("\n"), "all");
}

function submitEdit() {
  if (!feedback.trim() || !onEditRequest) return;
  onEditRequest(feedback.trim());
  showEdit = false;
  feedback = "";
}
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center gap-2">
    {#if typeof script.duration === "number"}
      <Badge variant="secondary">~{script.duration}s</Badge>
    {/if}
    {#if typeof script.metadata?.wordCount === "number"}
      <Badge variant="secondary">{script.metadata.wordCount} words</Badge>
    {/if}
    {#if typeof script.metadata?.readingPace === "number"}
      <Badge variant="secondary">{script.metadata.readingPace} wpm</Badge>
    {/if}
    {#if script.metadata?.modelUsed}
      <Badge variant="secondary">{script.metadata.modelUsed}</Badge>
    {/if}
    <div class="ml-auto flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onclick={copyTextOnly}>
        {copied === "text" ? "Copied text" : "Copy text"}
      </Button>
      <Button type="button" variant="outline" size="sm" onclick={copyAll}>
        {copied === "all" ? "Copied all" : "Copy all"}
      </Button>
      {#if isFinal && onEditRequest}
        <Button type="button" variant="outline" size="sm" onclick={() => (showEdit = !showEdit)} disabled={editLoading}>
          {editLoading ? "Polishing…" : "Re-polish"}
        </Button>
      {/if}
    </div>
  </div>

  {#if showEdit}
    <div class="space-y-2 rounded-md border border-border p-3">
      <Label for="script-edit-feedback">What should change?</Label>
      <Textarea
        id="script-edit-feedback"
        bind:value={feedback}
        rows={3}
        placeholder="Make the hook punchier and shorten the middle segments…"
      />
      <div class="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onclick={() => (showEdit = false)}>Cancel</Button>
        <Button type="button" size="sm" onclick={submitEdit} disabled={!feedback.trim()}>Send</Button>
      </div>
    </div>
  {/if}

  <div class="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
    <p class="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">Hook</p>
    <p class="mt-1 text-sm font-semibold">{script.hook ?? ""}</p>
  </div>

  <ol class="space-y-2">
    {#each script.segments ?? [] as seg, index (index)}
      {@const open = expanded.includes(index)}
      <li class="rounded-md border border-border {seg.isOpinion ? 'border-amber-500/40 bg-amber-500/5' : ''}">
        <button type="button" class="flex w-full items-start gap-3 p-3 text-left" onclick={() => toggle(index)}>
          {#if seg.timestamp}
            <span class="shrink-0 font-mono text-xs text-muted-foreground">[{seg.timestamp}]</span>
          {/if}
          {#if seg.isOpinion}
            <Badge variant="secondary">opinion</Badge>
          {/if}
          <p class="min-w-0 flex-1 text-sm {open ? '' : 'truncate'}">{seg.text ?? ""}</p>
        </button>
        {#if open}
          <div class="space-y-2 border-t border-border px-3 py-3">
            <p class="whitespace-pre-wrap text-sm">{seg.text ?? ""}</p>
            {#if showVideoAudio}
              {#if seg.visual}
                <p class="text-xs text-muted-foreground"><span class="font-medium">Visual:</span> {seg.visual}</p>
              {/if}
              {#if seg.audio}
                <p class="text-xs text-muted-foreground"><span class="font-medium">Audio:</span> {seg.audio}</p>
              {/if}
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ol>

  {#if script.cta}
    <div class="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
      <p class="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">CTA</p>
      <p class="mt-1 text-sm font-medium">{script.cta}</p>
    </div>
  {/if}
</div>
