import type { ScriptforgeEvent } from "./api";
import type { CritiqueResult, PipelineStage, PipelineState, ScriptDraft, TopicIdea } from "./types";

export function createInitialState(isOpinion = false): PipelineState {
  const stages: PipelineStage[] = [
    { id: "research", label: "Research", status: "pending", progress: 0, message: "Search the web for fresh data" },
    {
      id: "generate_topics",
      label: "Generate Topics",
      status: "pending",
      progress: 0,
      message: "Brainstorm viral angles",
    },
    { id: "select_topics", label: "Select Topic", status: "pending", progress: 0, message: "Pick the best angle and hook" },
    {
      id: "narrative_facts",
      label: "Narrative Facts",
      status: "pending",
      progress: 0,
      message: "Rewrite facts into spoken sentences",
    },
    { id: "outline", label: "Outline", status: "pending", progress: 0, message: "Build a structural blueprint" },
    { id: "generate_script", label: "Write Script", status: "pending", progress: 0, message: "Draft the script" },
    { id: "macro_critique", label: "Macro Critique", status: "pending", progress: 0, message: "Structure, flow, facts" },
    { id: "micro_critique", label: "Micro Critique", status: "pending", progress: 0, message: "Language, voice, rhythm" },
  ];

  if (isOpinion) {
    stages.push({
      id: "opinion",
      label: "Author Opinion",
      status: "pending",
      progress: 0,
      message: "Write a first-person opinion segment",
    });
  }

  stages.push(
    { id: "polish", label: "Polish", status: "pending", progress: 0, message: "Final refinement" },
    { id: "cold_read", label: "Cold Read", status: "pending", progress: 0, message: "Read-aloud check" }
  );

  return {
    isRunning: false,
    currentStage: null,
    stages,
    progress: {},
    messages: {},
    error: null,
    results: {},
  };
}

function pushUnique<T>(existing: T[] | undefined, item: T, same: (a: T, b: T) => boolean): T[] {
  const list = existing ?? [];
  if (list.some((entry) => same(entry, item))) return list;
  return [...list, item];
}

export function handleSSEEvent(state: PipelineState, event: ScriptforgeEvent): PipelineState {
  const next: PipelineState = { ...state, stages: [...state.stages] };

  if (event.stage) {
    next.currentStage = event.stage as PipelineState["currentStage"];
    next.messages = { ...next.messages, [event.stage]: event.message ?? "" };
    const progress = typeof event.progress === "number" ? event.progress : undefined;
    if (progress !== undefined) {
      next.progress = { ...next.progress, [event.stage]: progress };
    }

    const stageIndex = next.stages.findIndex((stage) => stage.id === event.stage);
    if (stageIndex >= 0) {
      const current = next.stages[stageIndex];
      next.stages[stageIndex] = {
        ...current,
        status:
          event.type === "stage_start" || event.type === "stage_progress"
            ? "active"
            : event.type === "stage_complete"
              ? "completed"
              : event.type === "stage_error" || event.type === "error"
                ? "error"
                : current.status,
        progress: progress ?? current.progress,
        message: event.message ?? current.message,
      };
    }
  }

  if (event.type === "result" && event.data && typeof event.data === "object") {
    const data = event.data as Record<string, unknown>;
    if (Array.isArray(data.topics)) {
      next.results = { ...next.results, topics: data.topics as TopicIdea[] };
    }
    if (data.script) {
      const script = data.script as ScriptDraft;
      const scripts = next.results.scripts ?? [];
      const updated = scripts.some((item) => item.id && item.id === script.id)
        ? scripts.map((item) => (item.id === script.id ? script : item))
        : [...scripts, script];
      next.results = { ...next.results, script, scripts: updated };
    }
    if (data.macroCritique) {
      const critique = data.macroCritique as CritiqueResult;
      next.results = {
        ...next.results,
        macroCritique: critique,
        macroCritiques: pushUnique(next.results.macroCritiques, critique, (a, b) => a.summary === b.summary),
      };
    }
    if (data.microCritique) {
      const critique = data.microCritique as CritiqueResult;
      next.results = {
        ...next.results,
        microCritique: critique,
        microCritiques: pushUnique(next.results.microCritiques, critique, (a, b) => a.summary === b.summary),
      };
    }
    if (data.finalScript) {
      const finalScript = data.finalScript as ScriptDraft;
      const existing = next.results.finalScripts ?? [];
      const updated = existing.some((item) => item.id && item.id === finalScript.id)
        ? existing.map((item) => (item.id === finalScript.id ? finalScript : item))
        : [...existing, finalScript];
      next.results = { ...next.results, finalScript, finalScripts: updated };
    }
    if (Array.isArray(data.finalScripts)) {
      next.results = { ...next.results, finalScripts: data.finalScripts as ScriptDraft[] };
    }
    if (Array.isArray(data.scripts) && !data.script) {
      next.results = { ...next.results, scripts: data.scripts as ScriptDraft[] };
    }
    if (Array.isArray(data.selectedTopics)) {
      next.results = { ...next.results, selectedTopics: data.selectedTopics as TopicIdea[] };
    }
    if (data.coldRead && typeof data.coldRead === "object") {
      next.results = { ...next.results, coldRead: data.coldRead as PipelineState["results"]["coldRead"] };
    }
  }

  if (event.type === "complete") {
    next.isRunning = false;
  }

  if (event.type === "error") {
    next.error = event.message ?? "Pipeline failed";
    next.isRunning = false;
  }

  return next;
}
