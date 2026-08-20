<script lang="ts">
import { LiveIndicator, PageHeader } from "@hiai/ui";
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
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hiai/ui/components/ui/dialog/index.js";
import { Input } from "@hiai/ui/components/ui/input/index.js";
import { Label } from "@hiai/ui/components/ui/label/index.js";
import {
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValue,
} from "@hiai/ui/components/ui/select/index.js";
import { Switch } from "@hiai/ui/components/ui/switch/index.js";
import { Textarea } from "@hiai/ui/components/ui/textarea/index.js";
import {
  continuePipeline,
  type RePolishParams,
  rePolish,
  runPipeline,
  type ScriptforgeEvent,
  type ScriptforgeMode,
} from "$lib/features/scriptforge/api";
import { FeatureApiError } from "$lib/features/shared/client";

const LANGUAGES = [
  { code: "ru", label: "Russian" },
  { code: "en", label: "English" },
  { code: "uk", label: "Ukrainian" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "pl", label: "Polish" },
  { code: "tr", label: "Turkish" },
  { code: "zh", label: "Chinese" },
  { code: "kk", label: "Kazakh" },
];

interface TopicData {
  id: string;
  title: string;
  description?: string;
  viralPotential?: number;
  hookVariants?: string[];
  selectedHook?: string;
}

interface ScriptSegment {
  timestamp?: string;
  visual?: string;
  audio?: string;
  text?: string;
  isOpinion?: boolean;
}

interface ScriptResult {
  title?: string;
  hook?: string;
  cta?: string;
  duration?: number;
  readingPace?: number;
  wordCount?: number;
  segments?: ScriptSegment[];
}

interface StageInfo {
  stage: string;
  status: "running" | "done" | "error";
  message: string;
  progress: number;
}

type StreamState = "idle" | "running" | "selection" | "done" | "error" | "aborted";

// ── Form state ───────────────────────────────────────────────────────────
let topic = $state("");
let language = $state("ru");
let duration = $state("45");
let mode = $state("auto");
let isSuper = $state(false);
let isOpinion = $state(false);

// ── Run state ────────────────────────────────────────────────────────────
let runId = $state("");
let streamState = $state<StreamState>("idle");
let streamError = $state<string | null>(null);
let events = $state<ScriptforgeEvent[]>([]);
let activeController: AbortController | null = null;

// Manual selection state.
let selectedTopicIds = $state<string[]>([]);
let selectedHooks = $state<Record<string, number>>({});

// Re-polish state.
let polishOpen = $state(false);
let polishIndex = $state(0);
let polishFeedback = $state("");
let polishing = $state(false);
let polishError = $state<string | null>(null);
let polishSuccess = $state<string | null>(null);
let scriptOverrides = $state<Record<number, unknown>>({});

function errorText(err: unknown): string {
  if (err instanceof FeatureApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

const running = $derived(streamState === "running");

const canStart = $derived(topic.trim().length > 0);

// ── Derived pipeline data ────────────────────────────────────────────────
const topics = $derived.by(() => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev.type !== "result" || !ev.data) continue;
    const data = ev.data as { topics?: unknown };
    if (Array.isArray(data.topics)) return data.topics as TopicData[];
  }
  return [];
});

const finalScripts = $derived.by(() => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev.type !== "result" || !ev.message?.includes("finalized") || !ev.data) continue;
    const data = ev.data as { finalScripts?: unknown[]; scripts?: unknown[] };
    return data.finalScripts ?? data.scripts ?? [];
  }
  return [];
});

const displayScripts = $derived(
  finalScripts.map((script, i) => (scriptOverrides[i] !== undefined ? scriptOverrides[i] : script))
);

const stages = $derived.by(() => {
  const map = new Map<string, StageInfo>();
  for (const ev of events) {
    if (ev.type === "stage_start" && ev.stage) {
      map.set(ev.stage, {
        stage: ev.stage,
        status: "running",
        message: ev.message ?? "",
        progress: 0,
      });
    } else if (ev.type === "stage_progress" && ev.stage) {
      const s = map.get(ev.stage);
      if (s) {
        const progress = (ev.data as { progress?: number } | undefined)?.progress;
        if (typeof progress === "number") s.progress = progress;
        if (ev.message) s.message = ev.message;
      }
    } else if (ev.type === "stage_complete" && ev.stage) {
      const s = map.get(ev.stage);
      if (s) {
        s.status = "done";
        if (ev.message) s.message = ev.message;
      }
    } else if (
      ev.type === "result" &&
      typeof (ev.data as { stage?: unknown } | undefined)?.stage === "string"
    ) {
      const stage = (ev.data as { stage: string }).stage;
      map.set(stage, { stage, status: "done", message: ev.message ?? "", progress: 100 });
    } else if (ev.type === "error" && ev.stage) {
      map.set(ev.stage, {
        stage: ev.stage,
        status: "error",
        message: ev.message ?? "Stage failed",
        progress: 100,
      });
    }
  }
  return [...map.values()];
});

const awaitingSelection = $derived(
  mode === "manual" && topics.length > 0 && finalScripts.length === 0 && !running
);

function asScript(value: unknown): ScriptResult {
  if (!value || typeof value !== "object") return {};
  return value as ScriptResult;
}

// ── Pipeline actions ─────────────────────────────────────────────────────
function resetRun() {
  streamError = null;
  events = [];
  selectedTopicIds = [];
  selectedHooks = {};
  scriptOverrides = {};
  activeController?.abort();
}

function pushEvent(ev: ScriptforgeEvent) {
  events = [...events, ev];
  if (ev.type === "error") streamError = ev.message ?? "Pipeline failed";
}

async function handleRun() {
  if (running || !canStart) return;
  resetRun();
  runId = crypto.randomUUID();
  streamState = "running";
  const controller = new AbortController();
  activeController = controller;
  try {
    await runPipeline(
      {
        runId,
        topic: topic.trim(),
        language,
        duration: Number(duration) || 45,
        mode: mode as ScriptforgeMode,
        isSuper,
        isOpinion,
      },
      { signal: controller.signal, onEvent: pushEvent }
    );
    if (!controller.signal.aborted) {
      streamState =
        mode === "manual" && topics.length > 0 && finalScripts.length === 0 ? "selection" : "done";
    }
  } catch (err) {
    if (controller.signal.aborted) {
      streamState = "aborted";
    } else {
      streamError = errorText(err);
      streamState = "error";
    }
  } finally {
    activeController = null;
  }
}

async function handleContinue() {
  if (running || selectedTopicIds.length === 0) return;
  streamError = null;
  streamState = "running";
  const controller = new AbortController();
  activeController = controller;
  try {
    await continuePipeline(
      {
        runId,
        topic: topic.trim(),
        language,
        duration: Number(duration) || 45,
        mode: "manual",
        isSuper,
        isOpinion,
        selectedTopicIds: selectedTopicIds,
        selectedHookIndices: selectedTopicIds.map((id) => selectedHooks[id] ?? 0),
      },
      { signal: controller.signal, onEvent: pushEvent }
    );
    if (!controller.signal.aborted) streamState = "done";
  } catch (err) {
    if (controller.signal.aborted) {
      streamState = "aborted";
    } else {
      streamError = errorText(err);
      streamState = "error";
    }
  } finally {
    activeController = null;
  }
}

function handleAbort() {
  activeController?.abort();
  streamState = "aborted";
}

function toggleTopic(id: string) {
  if (selectedTopicIds.includes(id)) {
    selectedTopicIds = selectedTopicIds.filter((t) => t !== id);
  } else {
    selectedTopicIds = [...selectedTopicIds, id];
  }
}

// ── Re-polish ────────────────────────────────────────────────────────────
function openPolish(index: number) {
  polishIndex = index;
  polishFeedback = "";
  polishError = null;
  polishSuccess = null;
  polishOpen = true;
}

async function handlePolish() {
  if (polishing) return;
  polishing = true;
  polishError = null;
  polishSuccess = null;
  try {
    const params: RePolishParams = {
      runId,
      scriptIndex: polishIndex,
      userFeedback: polishFeedback.trim(),
      language,
      duration: Number(duration) || 45,
      isSuper,
    };
    const res = await rePolish(params);
    scriptOverrides = { ...scriptOverrides, [polishIndex]: res.finalScript };
    polishSuccess = "Script re-polished. The updated version is now shown in the results.";
  } catch (err) {
    polishError = errorText(err);
  } finally {
    polishing = false;
  }
}

function stageLabel(stage: string): string {
  return stage.replaceAll("_", " ");
}
</script>

<svelte:head>
  <title>Scripts — HiAi Post</title>
</svelte:head>

<div class="mx-auto max-w-7xl space-y-6">
  <PageHeader
    title="Scripts"
    description="Research a topic, generate viral script drafts with hooks and CTA, then refine them with AI feedback."
  >
    {#snippet actions()}
      <LiveIndicator connected={running} />
    {/snippet}
  </PageHeader>

  <div class="grid gap-6 lg:grid-cols-5">
    <!-- Pipeline form -->
    <Card class="self-start lg:col-span-2">
      <CardHeader>
        <CardTitle>New script</CardTitle>
        <CardDescription>Topics are researched and drafted in the background; progress streams live below.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="space-y-2">
          <Label for="script-topic">Topic</Label>
          <Textarea
            id="script-topic"
            bind:value={topic}
            placeholder="e.g. how to grow a personal brand on LinkedIn in 2026"
            rows={3}
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-2">
            <Label for="script-language">Language</Label>
            <SelectRoot type="single" bind:value={language}>
              <SelectTrigger id="script-language" class="w-full">
                <SelectValue placeholder="Language" />
              </SelectTrigger>
              <SelectContent>
                {#each LANGUAGES as lang}
                  <SelectItem value={lang.code}>{lang.label}</SelectItem>
                {/each}
              </SelectContent>
            </SelectRoot>
          </div>
          <div class="space-y-2">
            <Label for="script-duration">Duration (seconds)</Label>
            <Input id="script-duration" type="number" min={15} max={600} bind:value={duration} />
          </div>
        </div>

        <div class="space-y-2">
          <Label for="script-mode">Mode</Label>
          <SelectRoot type="single" bind:value={mode}>
            <SelectTrigger id="script-mode" class="w-full">
              <SelectValue placeholder="Mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto — pick the best topic</SelectItem>
              <SelectItem value="manual">Manual — choose topics yourself</SelectItem>
            </SelectContent>
          </SelectRoot>
        </div>

        <div class="space-y-3">
          <div class="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <div>
              <p class="text-sm font-medium">Super mode</p>
              <p class="text-xs text-muted-foreground">Use a stronger (slower) model.</p>
            </div>
            <Switch bind:checked={isSuper} ariaLabel="Super mode" />
          </div>
          <div class="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <div>
              <p class="text-sm font-medium">Opinion segment</p>
              <p class="text-xs text-muted-foreground">Inject a personal-opinion segment into drafts.</p>
            </div>
            <Switch bind:checked={isOpinion} ariaLabel="Opinion segment" />
          </div>
        </div>

        {#if streamError}
          <p class="text-sm text-destructive" role="alert">Pipeline error: {streamError}</p>
        {/if}
      </CardContent>
      <CardFooter class="flex gap-2">
        <Button type="button" onclick={() => void handleRun()} disabled={running || !canStart}>
          {running ? "Running…" : "Run pipeline"}
        </Button>
        {#if running}
          <Button type="button" variant="destructive" onclick={handleAbort}>Abort</Button>
        {/if}
        {#if streamState === "error" || streamState === "aborted"}
          <Button type="button" variant="outline" onclick={() => void handleRun()}>Retry</Button>
        {/if}
      </CardFooter>
    </Card>

    <!-- Live stage list -->
    <Card class="lg:col-span-3">
      <CardHeader>
        <CardTitle>Pipeline stages</CardTitle>
        <CardDescription>
          {#if running}
            Streaming events live from the hiai-kit backend…
          {:else if stages.length === 0}
            No pipeline has been run yet.
          {:else}
            {stages.length} stage(s) recorded.
          {/if}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {#if stages.length === 0}
          <p class="py-8 text-center text-sm text-muted-foreground">
            Run the pipeline above to see live stages, generated topics and the final script.
          </p>
        {:else}
          <ol class="space-y-2">
            {#each stages as stage}
              <li class="flex items-center gap-3 rounded-md border border-border p-3">
                <span
                  class="flex h-5 w-5 shrink-0 items-center justify-center"
                  aria-hidden="true"
                >
                  {#if stage.status === "running"}
                    <span class="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
                  {:else if stage.status === "done"}
                    <span class="text-sm font-bold text-green-600">✓</span>
                  {:else}
                    <span class="text-sm font-bold text-destructive">✕</span>
                  {/if}
                </span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium capitalize">{stageLabel(stage.stage)}</p>
                  {#if stage.message}
                    <p class="truncate text-xs text-muted-foreground">{stage.message}</p>
                  {/if}
                </div>
                {#if stage.status === "running" && stage.progress > 0}
                  <Badge variant="secondary">{Math.round(stage.progress)}%</Badge>
                {:else}
                  <Badge variant={stage.status === "error" ? "destructive" : "secondary"}>
                    {stage.status}
                  </Badge>
                {/if}
              </li>
            {/each}
          </ol>
        {/if}
      </CardContent>
    </Card>
  </div>

  <!-- Manual topic selection -->
  {#if awaitingSelection}
    <Card>
      <CardHeader>
        <CardTitle>Choose topics</CardTitle>
        <CardDescription>
          Pick one or more generated topics and a hook variant each, then continue the pipeline.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-3">
        {#each topics as t (t.id)}
          <div class="rounded-md border border-border p-3">
            <label class="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={selectedTopicIds.includes(t.id)}
                onclick={() => toggleTopic(t.id)}
                class="mt-1 h-4 w-4 accent-primary"
              />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium">{t.title}</p>
                {#if t.description}
                  <p class="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
                {/if}
                {#if typeof t.viralPotential === "number"}
                  <p class="mt-0.5 text-xs text-muted-foreground">Viral potential: {t.viralPotential}/10</p>
                {/if}
              </div>
            </label>
            {#if selectedTopicIds.includes(t.id) && (t.hookVariants?.length ?? 0) > 0}
              <div class="mt-3 space-y-1.5">
                {#each t.hookVariants ?? [] as hook, hookIndex (hookIndex)}
                  <label
                    class="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2"
                    class:border-primary={selectedHooks[t.id] === hookIndex}
                  >
                    <input
                      type="radio"
                      name="hook-{t.id}"
                      checked={selectedHooks[t.id] === hookIndex}
                      onclick={() => (selectedHooks = { ...selectedHooks, [t.id]: hookIndex })}
                      class="mt-0.5 h-3.5 w-3.5 accent-primary"
                    />
                    <span class="text-xs text-muted-foreground">{hook}</span>
                  </label>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </CardContent>
      <CardFooter>
        <Button
          type="button"
          onclick={() => void handleContinue()}
          disabled={running || selectedTopicIds.length === 0}
        >
          {running ? "Continuing…" : "Continue with selection"}
        </Button>
      </CardFooter>
    </Card>
  {/if}

  <!-- Final result -->
  {#if displayScripts.length > 0}
    <Card>
      <CardHeader>
        <CardTitle>Final result</CardTitle>
        <CardDescription>{displayScripts.length} script(s) ready. Use “Re-polish” to iterate with AI feedback.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        {#each displayScripts as raw, index (index)}
          {@const script = asScript(raw)}
          <div class="rounded-md border border-border p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-semibold">{index + 1}. {script.title ?? "Untitled script"}</p>
                <p class="mt-1 text-sm italic text-muted-foreground">“{script.hook ?? ""}”</p>
              </div>
              <Button variant="outline" size="sm" onclick={() => openPolish(index)}>Re-polish</Button>
            </div>

            {#if typeof script.duration === "number" || typeof script.wordCount === "number" || typeof script.readingPace === "number"}
              <p class="mt-2 text-xs text-muted-foreground">
                {#if typeof script.duration === "number"}~{script.duration}s{/if}
                {#if typeof script.wordCount === "number"} · {script.wordCount} words{/if}
                {#if typeof script.readingPace === "number"} · {script.readingPace} wpm{/if}
              </p>
            {/if}

            {#if (script.segments?.length ?? 0) > 0}
              <ol class="mt-3 space-y-2 border-t border-border pt-3">
                {#each script.segments ?? [] as seg, segIndex (segIndex)}
                  <li class="text-sm">
                    <div class="flex items-center gap-2">
                      {#if seg.timestamp}
                        <span class="shrink-0 font-mono text-xs text-muted-foreground">[{seg.timestamp}]</span>
                      {/if}
                      {#if seg.isOpinion}
                        <Badge variant="secondary">opinion</Badge>
                      {/if}
                    </div>
                    {#if seg.text}
                      <p class="mt-0.5">{seg.text}</p>
                    {/if}
                    {#if seg.visual}
                      <p class="mt-0.5 text-xs text-muted-foreground"><span class="font-medium">Visual:</span> {seg.visual}</p>
                    {/if}
                    {#if seg.audio}
                      <p class="mt-0.5 text-xs text-muted-foreground"><span class="font-medium">Audio:</span> {seg.audio}</p>
                    {/if}
                  </li>
                {/each}
              </ol>
            {/if}

            {#if script.cta}
              <p class="mt-3 border-t border-border pt-3 text-sm font-medium">CTA: {script.cta}</p>
            {/if}
          </div>
        {/each}
      </CardContent>
    </Card>
  {/if}
</div>

<!-- Re-polish dialog -->
<Dialog bind:open={polishOpen}>
  <DialogHeader>
    <DialogTitle>Re-polish script {polishIndex + 1}</DialogTitle>
    <DialogDescription>
      Describe what to change — tone, structure, length, hooks — and the AI will produce an updated version.
    </DialogDescription>
  </DialogHeader>
  <div class="space-y-2">
    <Label for="polish-feedback">Feedback</Label>
    <Textarea
      id="polish-feedback"
      bind:value={polishFeedback}
      placeholder="Make the hook punchier and shorten the middle segments…"
      rows={4}
    />
  </div>
  {#if polishError}
    <p class="text-sm text-destructive" role="alert">Re-polish failed: {polishError}</p>
  {/if}
  {#if polishSuccess}
    <p class="text-sm text-green-600" role="status">{polishSuccess}</p>
  {/if}
  <DialogFooter>
    <Button variant="outline" onclick={() => (polishOpen = false)}>Close</Button>
    <Button type="button" onclick={() => void handlePolish()} disabled={polishing || polishFeedback.trim().length === 0}>
      {polishing ? "Polishing…" : "Re-polish"}
    </Button>
  </DialogFooter>
</Dialog>
