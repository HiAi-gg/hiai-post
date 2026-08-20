<script lang="ts">
import { onMount } from "svelte";
import { LiveIndicator, PageHeader } from "@hiai/ui";
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
import { Switch } from "@hiai/ui/components/ui/switch/index.js";
import { Textarea } from "@hiai/ui/components/ui/textarea/index.js";
import CritiquePanel from "$lib/features/scriptforge/CritiquePanel.svelte";
import HistoryDrawer from "$lib/features/scriptforge/HistoryDrawer.svelte";
import PipelineStatus from "$lib/features/scriptforge/PipelineStatus.svelte";
import ScriptEditor from "$lib/features/scriptforge/ScriptEditor.svelte";
import TopicSelector from "$lib/features/scriptforge/TopicSelector.svelte";
import {
  continuePipeline,
  getScriptforgeRun,
  listScriptforgeRuns,
  rePolish,
  rePolishSaved,
  runPipeline,
  type ScriptforgeMode,
  type ScriptforgeRunSummary,
} from "$lib/features/scriptforge/api";
import { createInitialState, handleSSEEvent } from "$lib/features/scriptforge/pipeline-state";
import { FeatureApiError } from "$lib/features/shared/client";
import type { CritiqueResult, ScriptDraft, TopicIdea } from "$lib/features/scriptforge/types";

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

const VOICES = [
  { id: "default", label: "Narrator (default)" },
  { id: "maxim", label: "Maxim preset (opt-in)" },
];

let topic = $state("");
let language = $state("ru");
let duration = $state("45");
let mode = $state("auto");
let isSuper = $state(false);
let isOpinion = $state(false);
let voiceId = $state("default");
let showVideoAudio = $state(false);

let runId = $state("");
let pipeline = $state(createInitialState());
let streamError = $state<string | null>(null);
let activeController: AbortController | null = null;
let editLoadingMap = $state<Record<number, boolean>>({});

let showHistory = $state(false);
let historyRuns = $state<ScriptforgeRunSummary[]>([]);
let historyLoading = $state(false);
let historyError = $state<string | null>(null);
let selectedHistoryId = $state<string | null>(null);
let selectedTopics = $state<TopicIdea[]>([]);
let selectedDrafts = $state<ScriptDraft[]>([]);
let selectedFinals = $state<ScriptDraft[]>([]);
let selectedCritiques = $state<CritiqueResult[]>([]);

const running = $derived(pipeline.isRunning);
const canStart = $derived(topic.trim().length > 0);
const topics = $derived(pipeline.results.topics ?? []);
const finalScripts = $derived(pipeline.results.finalScripts ?? []);
const drafts = $derived(pipeline.results.scripts ?? []);
const awaitingSelection = $derived(
  mode === "manual" && topics.length > 0 && finalScripts.length === 0 && !running
);

function errorText(err: unknown): string {
  if (err instanceof FeatureApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

function resetRun() {
  streamError = null;
  pipeline = createInitialState(isOpinion);
  activeController?.abort();
}

function pushEvent(event: Parameters<typeof handleSSEEvent>[1]) {
  pipeline = handleSSEEvent(pipeline, event);
  if (event.type === "error") streamError = event.message ?? "Pipeline failed";
}

async function handleRun() {
  if (running || !canStart) return;
  resetRun();
  runId = crypto.randomUUID();
  pipeline = { ...createInitialState(isOpinion), isRunning: true, error: null };
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
        voiceId,
      },
      { signal: controller.signal, onEvent: pushEvent }
    );
    if (!controller.signal.aborted) {
      pipeline = { ...pipeline, isRunning: false };
    }
  } catch (err) {
    if (!controller.signal.aborted) {
      streamError = errorText(err);
      pipeline = { ...pipeline, isRunning: false, error: streamError };
    }
  } finally {
    activeController = null;
    void loadHistory();
  }
}

async function handleContinue(selected: TopicIdea[]) {
  if (running || selected.length === 0) return;
  streamError = null;
  pipeline = { ...pipeline, isRunning: true, error: null };
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
        voiceId,
        selectedTopicIds: selected.map((item) => item.id),
        selectedHookIndices: selected.map((item) => {
          const idx = (item.hookVariants ?? []).indexOf(item.selectedHook ?? "");
          return idx >= 0 ? idx : 0;
        }),
      },
      { signal: controller.signal, onEvent: pushEvent }
    );
    if (!controller.signal.aborted) pipeline = { ...pipeline, isRunning: false };
  } catch (err) {
    if (!controller.signal.aborted) {
      streamError = errorText(err);
      pipeline = { ...pipeline, isRunning: false, error: streamError };
    }
  } finally {
    activeController = null;
    void loadHistory();
  }
}

function handleAbort() {
  activeController?.abort();
  pipeline = { ...pipeline, isRunning: false };
}

async function handlePolish(index: number, feedback: string) {
  editLoadingMap = { ...editLoadingMap, [index]: true };
  try {
    const res = await rePolish({
      runId,
      scriptIndex: index,
      userFeedback: feedback,
      language,
      duration: Number(duration) || 45,
      isSuper,
    });
    const next = [...finalScripts];
    next[index] = res.finalScript as ScriptDraft;
    pipeline = { ...pipeline, results: { ...pipeline.results, finalScripts: next, finalScript: next[index] } };
  } catch (err) {
    streamError = errorText(err);
  } finally {
    editLoadingMap = { ...editLoadingMap, [index]: false };
  }
}

async function loadHistory() {
  historyLoading = true;
  historyError = null;
  try {
    const res = await listScriptforgeRuns();
    historyRuns = res.runs;
  } catch (err) {
    historyError = errorText(err);
  } finally {
    historyLoading = false;
  }
}

async function openHistory(id: string) {
  selectedHistoryId = id;
  try {
    const detail = await getScriptforgeRun(id);
    selectedTopics = (detail.run.topics ?? []) as TopicIdea[];
    selectedDrafts = (detail.run.scripts ?? []) as ScriptDraft[];
    selectedFinals = (detail.run.finalScripts ?? []) as ScriptDraft[];
    selectedCritiques = (detail.run.macroCritiques ?? []) as CritiqueResult[];
  } catch (err) {
    historyError = errorText(err);
  }
}

function useHistoryTopic(item: TopicIdea) {
  topic = item.title;
  showHistory = false;
  void handleRun();
}

async function polishSaved(script: ScriptDraft, critique: CritiqueResult | undefined, feedback: string) {
  const res = await rePolishSaved({
    finalScript: script,
    critique,
    userFeedback: feedback,
    language,
    duration: Number(duration) || 45,
    isSuper,
  });
  selectedFinals = selectedFinals.map((item) => (item === script ? (res.finalScript as ScriptDraft) : item));
}

onMount(() => {
  void loadHistory();
  const params = new URLSearchParams(window.location.search);
  const urlTopic = params.get("topic");
  if (urlTopic) {
    topic = urlTopic;
    if (params.get("start") === "true") {
      setTimeout(() => {
        void handleRun();
      }, 300);
    }
  }
});
</script>

<svelte:head>
  <title>Scripts — HiAi Post</title>
</svelte:head>

<HistoryDrawer
  open={showHistory}
  runs={historyRuns}
  loading={historyLoading}
  error={historyError}
  selectedRunId={selectedHistoryId}
  selectedTopics={selectedTopics}
  selectedDrafts={selectedDrafts}
  selectedFinals={selectedFinals}
  selectedCritiques={selectedCritiques}
  onClose={() => (showHistory = false)}
  onRefresh={() => void loadHistory()}
  onOpen={(id) => void openHistory(id)}
  onUseTopic={useHistoryTopic}
  onRePolishSaved={polishSaved}
/>

<div class="mx-auto max-w-7xl space-y-6">
  <PageHeader
    title="Scripts"
    description="Research a topic, generate viral script drafts with hooks and CTA, then refine them with AI feedback."
  >
    {#snippet actions()}
      <Button type="button" variant="outline" onclick={() => (showHistory = true)}>History</Button>
      <LiveIndicator connected={running} />
    {/snippet}
  </PageHeader>

  <div class="grid gap-6 lg:grid-cols-5">
    <Card class="self-start lg:col-span-2">
      <CardHeader>
        <CardTitle>New script</CardTitle>
        <CardDescription>
          Pipeline runs on hiai-kit. Provider keys stay in kit env — this page never sends OpenRouter or Firecrawl keys.
        </CardDescription>
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

        <div class="space-y-2">
          <Label for="script-voice">Voice</Label>
          <SelectRoot type="single" bind:value={voiceId}>
            <SelectTrigger id="script-voice" class="w-full">
              <SelectValue placeholder="Voice" />
            </SelectTrigger>
            <SelectContent>
              {#each VOICES as voice}
                <SelectItem value={voice.id}>{voice.label}</SelectItem>
              {/each}
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
              <p class="text-xs text-muted-foreground">Inject a first-person opinion beat in the selected voice.</p>
            </div>
            <Switch bind:checked={isOpinion} ariaLabel="Opinion segment" />
          </div>
          <div class="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <div>
              <p class="text-sm font-medium">Show visual / audio notes</p>
              <p class="text-xs text-muted-foreground">Reveal director notes on each segment.</p>
            </div>
            <Switch bind:checked={showVideoAudio} ariaLabel="Show visual and audio notes" />
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
        {#if pipeline.error && !running}
          <Button type="button" variant="outline" onclick={() => void handleRun()}>Retry</Button>
        {/if}
      </CardFooter>
    </Card>

    <div class="lg:col-span-3">
      <PipelineStatus
        stages={pipeline.stages}
        currentStage={pipeline.currentStage}
        progress={pipeline.progress}
        messages={pipeline.messages}
        running={running}
      />
    </div>
  </div>

  {#if awaitingSelection}
    <TopicSelector topics={topics} disabled={running} onSelect={(selected) => void handleContinue(selected)} />
  {/if}

  {#if drafts.length > 0 && finalScripts.length === 0}
    <Card>
      <CardHeader>
        <CardTitle>Drafts</CardTitle>
        <CardDescription>{drafts.length} draft(s) written. Critique and polish follow.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-6">
        {#each drafts as script, index (script.id ?? index)}
          <ScriptEditor {script} {showVideoAudio} />
        {/each}
      </CardContent>
    </Card>
  {/if}

  {#if pipeline.results.macroCritique}
    <CritiquePanel critique={pipeline.results.macroCritique} title="Macro critique" />
  {/if}
  {#if pipeline.results.microCritique}
    <CritiquePanel critique={pipeline.results.microCritique} title="Micro critique" />
  {/if}

  {#if finalScripts.length > 0}
    <Card>
      <CardHeader>
        <CardTitle>Final result</CardTitle>
        <CardDescription>{finalScripts.length} script(s) ready. Use Re-polish to iterate with AI feedback.</CardDescription>
      </CardHeader>
      <CardContent class="space-y-8">
        {#each finalScripts as script, index (script.id ?? index)}
          <div class="space-y-4">
            <p class="text-sm font-semibold">{index + 1}. {script.title ?? "Untitled script"}</p>
            <ScriptEditor
              {script}
              isFinal
              {showVideoAudio}
              editLoading={Boolean(editLoadingMap[index])}
              onEditRequest={(feedback) => void handlePolish(index, feedback)}
            />
            {#if pipeline.results.macroCritiques?.[index]}
              <CritiquePanel critique={pipeline.results.macroCritiques[index]!} title="Macro critique" />
            {/if}
          </div>
        {/each}
      </CardContent>
    </Card>
  {/if}
</div>
