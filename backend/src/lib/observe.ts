/**
 * hiai-observe telemetry emitter (structured events, Bearer API-key contract).
 *
 * Sends structured Writer / Carousel / Content (incl. approval) / Postiz /
 * API / MCP / Webhook success/failure events to the hiai-observe unified
 * observability plane (peer service, default `http://localhost:8001`) over
 * its OTLP `/v1/logs` endpoint, authenticated with the VERIFIED Bearer
 * API-key contract:
 *
 *   `Authorization: Bearer <HIAI_OBSERVE_API_KEY>`
 *
 * (hiai-observe's `src/middleware/auth.ts` resolves the `authorization`
 * header via `resolveApiKey()`; `X-Api-Key` is also accepted, but the
 * Bearer form is what hiai-kit's working OTLP clients use and what the
 * hiai-observe docs show. `X-Sentry-Auth` is deliberately NOT used — that
 * path is broken against hiai-observe and this module is not a Sentry SDK.)
 *
 * Hard guarantees (the reason this module exists):
 *   - **No-op when unconfigured.** No `HIAI_OBSERVE_API_KEY` (or no URL /
 *     project) → zero network, zero UUIDs, zero overhead.
 *   - **Never fails the product request.** Emits are fire-and-forget; every
 *     outbound error is swallowed. Instrumented code can `await` the wrapper
 *     and never observes a telemetry failure.
 *   - **Bounded timeout.** `HIAI_OBSERVE_TIMEOUT_MS` (default 2000) via
 *     `AbortSignal.timeout`.
 *   - **Correlation / run ids.** Every event carries a `correlationId` that
 *     is mapped to the OTLP `traceId` (32 hex) so hiai-kit run ids trace
 *     end-to-end through hiai-observe.
 *   - **No secrets / content leakage.** Only sanitized metadata (ids,
 *     statuses, durations, error codes) is sent; keys matching a sensitive
 *     pattern are dropped and strings are truncated.
 *   - **No telemetry database.** Events are forwarded outbound only; nothing
 *     is persisted locally.
 *
 * NOTE on config: the HIAI_OBSERVE_* values are mirrored in the canonical
 * zod schema (`backend/src/lib/config.ts`) and `.env.example`, but this
 * module reads `process.env` DIRECTLY instead of the cached config
 * singleton. Deliberate: telemetry must never be able to fail product
 * startup through the strict config validator, and the no-op path must be
 * testable by simply clearing the env (no singleton-cache reset needed).
 */
import { randomUUID } from "node:crypto";

export type ObserveEventKind =
  | "writer"
  | "carousel"
  | "api"
  | "mcp"
  | "hiai-kit"
  | "content"
  | "postiz"
  | "webhook";
export type ObserveEventOutcome = "start" | "success" | "failure";

/** Primitive-only metadata — callers cannot attach content bodies or objects. */
export type SanitizedMetadata = Record<string, string | number | boolean | null | undefined>;

export interface ObserveEvent {
  kind: ObserveEventKind;
  outcome: ObserveEventOutcome;
  /** Dot-path operation label, e.g. `writer.generate`, `carousel.create`. */
  operation: string;
  /** Short human-readable message (truncated at 500 chars). */
  message: string;
  /** Run/request id; mapped to the OTLP traceId. */
  correlationId?: string;
  tenantId?: string;
  userId?: string;
  /** HTTP status or upstream status code (success events only). */
  status?: number;
  /** Normalized error code (e.g. `VALIDATION`, `HIAI_KIT_ERROR`, `TIMEOUT`). */
  errorCode?: string;
  durationMs?: number;
  /** Sanitized metadata — NEVER content, prompts, bodies or secrets. */
  metadata?: SanitizedMetadata;
}

export interface ObserveCallOptions {
  kind: ObserveEventKind;
  operation: string;
  tenantId?: string;
  userId?: string;
  /** Fixed correlation id for the whole call; generated when omitted. */
  correlationId?: string;
  /** Static metadata attached to the start AND outcome events. */
  metadata?: SanitizedMetadata;
  /** Outcome-only metadata; returned values must be primitives only. */
  enrich?: {
    success?: (result: unknown) => SanitizedMetadata;
    failure?: (err: unknown) => SanitizedMetadata;
  };
}

export interface ObserveConfig {
  /** hiai-observe base URL, no trailing slash. */
  url: string;
  /** Project API key (Bearer). */
  apiKey: string;
  /** hiai-observe project id (informational attribute; auth is by key). */
  project: string;
  timeoutMs: number;
  enabled: boolean;
}

const DEFAULT_URL = "http://localhost:8001";
const DEFAULT_TIMEOUT_MS = 2000;

export function getObserveConfig(): ObserveConfig {
  const url = (process.env.HIAI_OBSERVE_URL || DEFAULT_URL).replace(/\/+$/, "");
  const apiKey = process.env.HIAI_OBSERVE_API_KEY || "";
  const project = process.env.HIAI_OBSERVE_PROJECT || "";
  const rawTimeout = Number(process.env.HIAI_OBSERVE_TIMEOUT_MS);
  const timeoutMs =
    Number.isInteger(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS;
  return {
    url,
    apiKey,
    project,
    timeoutMs,
    // No key (or no URL/project) → telemetry is fully disabled.
    enabled: Boolean(apiKey && url && project),
  };
}

export function isObserveEnabled(): boolean {
  return getObserveConfig().enabled;
}

/** Normalize a thrown value to a stable error code for telemetry. */
export function normalizeErrorCode(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "INTERNAL";
}

// ---------------------------------------------------------------------------
// Sensitive metadata filtering — nothing secret-shaped leaves the process.
// ---------------------------------------------------------------------------

const SENSITIVE_KEY_RE =
  /^(password|passwd|token|access_token|refresh_token|authorization|secret|api_key|apikey|private_key|signature|cookie|set-cookie|key)$/i;
const MAX_STRING_LENGTH = 500;

function sanitizeMetadata(metadata: SanitizedMetadata | undefined): SanitizedMetadata {
  if (!metadata) return {};
  const out: SanitizedMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY_RE.test(key)) continue; // drop secret-shaped keys entirely
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      out[key] =
        value.length > MAX_STRING_LENGTH
          ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]`
          : value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
    // Anything else (objects/arrays) is dropped — telemetry carries ids only.
  }
  return out;
}

// ---------------------------------------------------------------------------
// OTLP /v1/logs payload builder (JSON form, as hiai-observe documents)
// ---------------------------------------------------------------------------

const OTEL_ATTR_STRING = (key: string, value: string) => ({
  key,
  value: { stringValue: value },
});
const OTEL_ATTR_INT = (key: string, value: number) => ({
  key,
  value: { intValue: String(value) },
});

/** UUID/hex run id → 32-char OTLP traceId (hex only). */
function toTraceId(correlationId: string): string {
  const hex = correlationId.replace(/[^0-9a-fA-F]/g, "");
  return (hex || "0".repeat(32)).slice(0, 32).padEnd(32, "0").toLowerCase();
}

function buildLogRecord(event: ObserveEvent, config: ObserveConfig): unknown {
  const correlationId = event.correlationId ?? randomUUID();
  const attributes: unknown[] = [
    OTEL_ATTR_STRING("event.kind", event.kind),
    OTEL_ATTR_STRING("event.outcome", event.outcome),
    OTEL_ATTR_STRING("event.operation", event.operation),
    OTEL_ATTR_STRING("event.source", "hiai-post"),
    OTEL_ATTR_STRING("correlation.id", correlationId),
  ];
  if (config.project) attributes.push(OTEL_ATTR_STRING("observe.project", config.project));
  if (event.tenantId) attributes.push(OTEL_ATTR_STRING("tenant.id", event.tenantId));
  if (event.userId) attributes.push(OTEL_ATTR_STRING("user.id", event.userId));
  if (event.status !== undefined) attributes.push(OTEL_ATTR_INT("status.code", event.status));
  if (event.errorCode) attributes.push(OTEL_ATTR_STRING("error.code", event.errorCode));
  if (event.durationMs !== undefined)
    attributes.push(OTEL_ATTR_INT("duration.ms", event.durationMs));
  for (const [key, value] of Object.entries(sanitizeMetadata(event.metadata))) {
    attributes.push(
      typeof value === "number"
        ? OTEL_ATTR_INT(`metadata.${key}`, value)
        : OTEL_ATTR_STRING(`metadata.${key}`, String(value))
    );
  }

  const isFailure = event.outcome === "failure";
  return {
    timeUnixNano: String(Date.now() * 1_000_000),
    severityNumber: isFailure ? 17 : 9, // ERROR=17, INFO=9
    severityText: isFailure ? "ERROR" : "INFO",
    body: {
      stringValue:
        event.message.length > MAX_STRING_LENGTH
          ? `${event.message.slice(0, MAX_STRING_LENGTH)}…[truncated]`
          : event.message,
    },
    attributes,
    traceId: toTraceId(correlationId),
    spanId: randomUUID().replace(/-/g, "").slice(0, 16),
  };
}

function buildPayload(event: ObserveEvent, config: ObserveConfig): unknown {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            OTEL_ATTR_STRING("service.name", "hiai-post"),
            OTEL_ATTR_STRING("service.namespace", "hiai"),
          ],
        },
        scopeLogs: [
          {
            scope: { name: "hiai-post-observe", version: "0.1.0" },
            logRecords: [buildLogRecord(event, config)],
          },
        ],
      },
    ],
  };
}

async function sendEvent(config: ObserveConfig, event: ObserveEvent): Promise<void> {
  try {
    await fetch(`${config.url}/v1/logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(buildPayload(event, config)),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    // Telemetry must NEVER fail (or slow) the product request — swallow.
  }
}

/**
 * Emit a single telemetry event. Fire-and-forget: returns immediately and
 * never throws, even when telemetry is configured but hiai-observe is down.
 */
export function observeEvent(event: ObserveEvent): void {
  const config = getObserveConfig();
  if (!config.enabled) return;
  void sendEvent(config, event);
}

/**
 * Wrap an async operation with start/success/failure telemetry. Returns the
 * operation's result (or rethrows its error) unchanged — telemetry can never
 * alter product behavior. When telemetry is disabled this is a zero-overhead
 * passthrough that runs `fn` directly.
 */
export function observeCall<T>(opts: ObserveCallOptions, fn: () => Promise<T>): Promise<T> {
  if (!isObserveEnabled()) return fn();

  const correlationId = opts.correlationId ?? randomUUID();
  const base = {
    kind: opts.kind,
    operation: opts.operation,
    correlationId,
    tenantId: opts.tenantId,
    userId: opts.userId,
    metadata: opts.metadata,
  };
  const startedAt = Date.now();

  observeEvent({
    ...base,
    outcome: "start",
    message: `${opts.operation} started`,
  });

  return (async () => {
    try {
      const result = await fn();
      observeEvent({
        ...base,
        outcome: "success",
        message: `${opts.operation} succeeded`,
        durationMs: Date.now() - startedAt,
        metadata: opts.enrich?.success?.(result),
      });
      return result;
    } catch (err) {
      observeEvent({
        ...base,
        outcome: "failure",
        message: `${opts.operation} failed`,
        durationMs: Date.now() - startedAt,
        errorCode: normalizeErrorCode(err),
        metadata: opts.enrich?.failure?.(err),
      });
      throw err;
    }
  })();
}
