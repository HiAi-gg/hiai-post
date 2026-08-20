import { FeatureApiError, featureApiUrl, featureFetch } from "../shared/client";
import type { SSEMessage } from "../shared/sse";
import { readSSEStream } from "../shared/sse";

/**
 * Typed client for the hiai-kit `/api/v1/scriptforge` endpoints.
 * `runPipeline` / `continuePipeline` are SSE streams; `rePolish*` are JSON
 * POSTs that return a final script.
 */

export type ScriptforgeMode = "auto" | "manual";

export interface RunPipelineParams {
  runId: string;
  topic: string;
  language?: string;
  duration?: number;
  mode?: ScriptforgeMode;
  isSuper?: boolean;
  isOpinion?: boolean;
}

export interface ContinuePipelineParams extends RunPipelineParams {
  selectedTopicIds: string[];
  selectedHookIndices?: number[];
}

export type ScriptforgeEventType = "result" | "complete" | "error" | (string & {});

export interface ScriptforgeEvent<TData = unknown> {
  type: ScriptforgeEventType;
  message?: string;
  data?: TData;
  stage?: string;
}

export interface RePolishParams {
  runId: string;
  scriptIndex: number;
  userFeedback: string;
  language?: string;
  duration?: number;
  isSuper?: boolean;
}

export interface RePolishSavedParams {
  finalScript: unknown;
  critique?: unknown;
  userFeedback: string;
  language?: string;
  duration?: number;
  isSuper?: boolean;
}

export interface RePolishResult {
  finalScript: unknown;
}

export interface StreamOptions {
  signal?: AbortSignal;
  /** Called live for each parsed event as the stream progresses. */
  onEvent?: (event: ScriptforgeEvent) => void;
}

type QueryValue = string | number | boolean | string[] | number[] | undefined;

function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) search.set(key, value.join(","));
    } else {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function runPipelineUrl(params: RunPipelineParams): string {
  return featureApiUrl(
    `/api/v1/scriptforge/run-pipeline${buildQuery({
      runId: params.runId,
      topic: params.topic,
      language: params.language ?? "ru",
      duration: params.duration ?? 45,
      mode: params.mode ?? "auto",
      isSuper: params.isSuper,
      isOpinion: params.isOpinion,
    })}`
  );
}

export function continuePipelineUrl(params: ContinuePipelineParams): string {
  return featureApiUrl(
    `/api/v1/scriptforge/continue-pipeline${buildQuery({
      runId: params.runId,
      topic: params.topic,
      language: params.language ?? "ru",
      duration: params.duration ?? 45,
      mode: "manual",
      isSuper: params.isSuper,
      isOpinion: params.isOpinion,
      selectedTopicIds: params.selectedTopicIds,
      selectedHookIndices: params.selectedHookIndices,
    })}`
  );
}

function parseEvent(data: string): ScriptforgeEvent {
  try {
    return JSON.parse(data) as ScriptforgeEvent;
  } catch {
    // Non-JSON payloads degrade to a generic message event instead of failing
    // the whole stream.
    return { type: "message", message: data };
  }
}

/**
 * Consume an SSE endpoint, dispatching parsed events to `onEvent` and
 * resolving with every event collected. Throws `FeatureApiError` for
 * non-SSE responses (hiai-kit returns JSON errors for invalid params).
 */
export async function streamScriptforge(
  path: string,
  options: StreamOptions = {}
): Promise<ScriptforgeEvent[]> {
  const response = await fetch(featureApiUrl(path), {
    credentials: "include",
    signal: options.signal,
  });
  if (!response.ok) {
    throw new FeatureApiError(`HTTP ${response.status}`, response.status);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const payload = await response.json().catch(() => undefined);
    if (
      typeof payload === "object" &&
      payload !== null &&
      (payload as { error?: unknown }).error === true
    ) {
      throw new FeatureApiError(
        String((payload as { message?: unknown }).message ?? "SSE request failed"),
        Number((payload as { code?: unknown }).code ?? 500),
        payload
      );
    }
    throw new FeatureApiError("Expected text/event-stream response", response.status);
  }

  const events: ScriptforgeEvent[] = [];
  await readSSEStream(response, (message: SSEMessage) => {
    const event = parseEvent(message.data);
    events.push(event);
    options.onEvent?.(event);
  });
  return events;
}

/** Stream `/run-pipeline`; resolves with the full event log. */
export function runPipeline(
  params: RunPipelineParams,
  options: StreamOptions = {}
): Promise<ScriptforgeEvent[]> {
  return streamScriptforge(runPipelineUrl(params), options);
}

/** Stream `/continue-pipeline`; resolves with the full event log. */
export function continuePipeline(
  params: ContinuePipelineParams,
  options: StreamOptions = {}
): Promise<ScriptforgeEvent[]> {
  return streamScriptforge(continuePipelineUrl(params), options);
}

export async function rePolish(params: RePolishParams): Promise<RePolishResult> {
  return featureFetch<RePolishResult>("/api/v1/scriptforge/re-polish", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function rePolishSaved(params: RePolishSavedParams): Promise<RePolishResult> {
  return featureFetch<RePolishResult>("/api/v1/scriptforge/re-polish-saved", {
    method: "POST",
    body: JSON.stringify(params),
  });
}
