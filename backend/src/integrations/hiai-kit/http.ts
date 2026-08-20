/**
 * Internal HTTP boundary for the hiai-kit integration — the ONLY place that
 * talks to the hiai-kit backend. Everything above (capabilities, carousel)
 * goes through `hiaiKitJson` / `hiaiKitBinary` and never touches hiai-kit
 * URLs directly; nothing in the frontend uses these URLs at all.
 *
 * Responsibilities:
 *   - build the request (path, headers, timeout) with an optional server-side
 *     `Cookie` / `Authorization: Bearer` credential;
 *   - correlate: every request gets a `correlationId` (sent as `x-trace-id`,
 *     which hiai-kit stores on capability runs) and hiai-kit's `requestId`
 *     is captured from error bodies;
 *   - normalize failures into `HiaiKitError` (TIMEOUT / VALIDATION_ERROR /
 *     CAPABILITY_UNAVAILABLE / HIAI_KIT_ERROR);
 *   - never log secrets: only the path, status, ids and duration.
 */
import { randomUUID } from "node:crypto";
import type { ZodType } from "zod";
import { logger } from "../../lib/logger.js";
import { observeEvent } from "../../lib/observe.js";
import type { HiaiKitClientConfig } from "./config.js";
import { HiaiKitError, type HiaiKitErrorDetails } from "./errors.js";
import { hiaiKitErrorBodySchema } from "./schemas.js";

export interface HiaiKitRequestOptions {
  method?: "GET" | "POST" | "PUT";
  path: string;
  body?: unknown;
  /** Return raw bytes (e.g. carousel cover PNG) instead of JSON. */
  binary?: boolean;
  /** Raw request body (PNG upload). Skips JSON.stringify. */
  binaryBody?: Uint8Array | ArrayBuffer;
  contentType?: string;
}

export interface HiaiKitJsonResult<T = unknown> {
  data: T;
  correlationId: string;
}

export interface HiaiKitBinaryResult {
  contentType: string;
  data: ArrayBuffer;
  correlationId: string;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isErrorEnvelope(raw: unknown): raw is { error: true } {
  return typeof raw === "object" && raw !== null && (raw as { error?: unknown }).error === true;
}

function parseErrorBody(
  raw: unknown
): { message: string; requestId?: string; hiaiKitCode?: string } | undefined {
  const parsed = hiaiKitErrorBodySchema.safeParse(raw);
  if (!parsed.success) return undefined;
  return {
    message: parsed.data.message,
    requestId: parsed.data.requestId,
    hiaiKitCode: String(parsed.data.code),
  };
}

function mapErrorStatus(
  status: number,
  hiaiKitCode: string | undefined,
  message: string,
  details: HiaiKitErrorDetails
): HiaiKitError {
  if (status === 400 || hiaiKitCode === "validation_error") {
    return new HiaiKitError("VALIDATION_ERROR", message, 400, details);
  }
  if (
    status === 404 &&
    (hiaiKitCode === "capability_not_found" || hiaiKitCode === "run_not_found")
  ) {
    return new HiaiKitError("CAPABILITY_UNAVAILABLE", message, 404, details);
  }
  return new HiaiKitError("HIAI_KIT_ERROR", message, status, details);
}

interface CoreResult {
  raw: unknown;
  binary?: { contentType: string; data: ArrayBuffer };
  correlationId: string;
  status: number;
}

async function requestCore(
  config: HiaiKitClientConfig,
  options: HiaiKitRequestOptions
): Promise<CoreResult> {
  const correlationId = randomUUID();
  const url = `${config.url}${options.path}`;
  const method = options.method ?? "GET";

  const headers = new Headers();
  headers.set("Accept", options.binary ? "*/*" : "application/json");
  headers.set("x-trace-id", correlationId);
  if (config.cookie) headers.set("Cookie", config.cookie);
  if (config.token) headers.set("Authorization", `Bearer ${config.token}`);
  if (options.binaryBody !== undefined) {
    headers.set("Content-Type", options.contentType ?? "application/octet-stream");
  } else if (options.body !== undefined) {
    headers.set("Content-Type", options.contentType ?? "application/json");
  }

  const startedAt = Date.now();
  const observeBase = {
    kind: "hiai-kit",
    operation: "hiai-kit.http",
    correlationId,
    metadata: { method, path: options.path },
  } as const;
  observeEvent({
    ...observeBase,
    outcome: "start",
    message: `hiai-kit ${method} ${options.path} started`,
  });

  try {
    let response: Response;
    try {
      const requestBody =
        options.binaryBody !== undefined
          ? options.binaryBody
          : options.body !== undefined
            ? JSON.stringify(options.body)
            : undefined;
      response = await fetch(url, {
        method,
        headers,
        body: requestBody as BodyInit | undefined,
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new HiaiKitError(
          "TIMEOUT",
          `hiai-kit request timed out after ${config.timeoutMs}ms`,
          504,
          { correlationId, path: options.path, timeoutMs: config.timeoutMs }
        );
      }
      throw new HiaiKitError(
        "HIAI_KIT_ERROR",
        `hiai-kit request failed: ${errorMessage(error)}`,
        502,
        { correlationId, path: options.path }
      );
    }
    const durationMs = Date.now() - startedAt;

    let raw: unknown;
    let binary: { contentType: string; data: ArrayBuffer } | undefined;
    if (options.binary) {
      const data = await response.arrayBuffer();
      const text = new TextDecoder().decode(data);
      binary = {
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
        data,
      };
      raw = parseJson(text);
    } else {
      raw = parseJson(await response.text());
    }

    if (!response.ok || isErrorEnvelope(raw)) {
      const errInfo = parseErrorBody(raw);
      const details: HiaiKitErrorDetails = {
        correlationId,
        path: options.path,
        status: response.status,
      };
      if (errInfo?.requestId) details.requestId = errInfo.requestId;
      const message = errInfo?.message ?? `hiai-kit returned HTTP ${response.status}`;
      logger.warn(
        {
          correlationId,
          requestId: errInfo?.requestId,
          method,
          path: options.path,
          status: response.status,
          durationMs,
        },
        "hiai-kit request failed"
      );
      throw mapErrorStatus(response.status, errInfo?.hiaiKitCode, message, details);
    }

    logger.debug(
      { correlationId, method, path: options.path, status: response.status, durationMs },
      "hiai-kit request"
    );
    observeEvent({
      ...observeBase,
      outcome: "success",
      status: response.status,
      durationMs,
      message: `hiai-kit ${method} ${options.path} succeeded`,
    });
    return { raw, binary, correlationId, status: response.status };
  } catch (err) {
    // Telemetry only — the normalized error still propagates untouched.
    observeEvent({
      ...observeBase,
      outcome: "failure",
      status: err instanceof HiaiKitError ? err.status : undefined,
      errorCode: err instanceof HiaiKitError ? err.code : "INTERNAL",
      durationMs: Date.now() - startedAt,
      message: `hiai-kit ${method} ${options.path} failed`,
    });
    throw err;
  }
}

/** JSON GET/POST against the hiai-kit API. */
export async function hiaiKitJson<T = unknown>(
  config: HiaiKitClientConfig,
  options: HiaiKitRequestOptions
): Promise<HiaiKitJsonResult<T>> {
  const result = await requestCore(config, options);
  return { data: result.raw as T, correlationId: result.correlationId };
}

/** Binary GET (e.g. carousel cover PNG) against the hiai-kit API. */
export async function hiaiKitBinary(
  config: HiaiKitClientConfig,
  options: HiaiKitRequestOptions
): Promise<HiaiKitBinaryResult> {
  const result = await requestCore(config, { ...options, binary: true });
  if (!result.binary) {
    throw new HiaiKitError(
      "HIAI_KIT_ERROR",
      `hiai-kit binary response for ${options.path} was empty`,
      502,
      { correlationId: result.correlationId, path: options.path }
    );
  }
  return { ...result.binary, correlationId: result.correlationId };
}

/**
 * Validate a response payload against a contract schema. A mismatch means the
 * peer violated its contract — surfaced as HIAI_KIT_ERROR (502), keeping the
 * correlation id so the failure can be traced.
 */
export function parseResponse<T>(
  schema: ZodType<T>,
  data: unknown,
  correlationId: string,
  path: string
): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new HiaiKitError(
      "HIAI_KIT_ERROR",
      `hiai-kit response for ${path} violated the expected contract`,
      502,
      { correlationId, path, issues: parsed.error.issues }
    );
  }
  return parsed.data;
}
