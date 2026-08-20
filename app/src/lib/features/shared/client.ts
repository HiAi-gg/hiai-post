import { config } from "../../config";

/**
 * Shared API foundation for hiai-kit feature endpoints.
 *
 * The hiai-post backend does not host `/api/v1/carousel` or
 * `/api/v1/scriptforge` — those live on the hiai-kit backend
 * (`config.hiaiKitApiUrl`, default `http://localhost:3000`), so feature
 * clients call it directly instead of going through the SvelteKit proxy.
 */

/**
 * Error raised when a feature request fails. `code` is the HTTP status or
 * the `code` field from a hiai-kit `{ error: true, message, code }` payload
 * (those are returned with HTTP 200, so the body is inspected too).
 */
export class FeatureApiError extends Error {
  readonly code: number;
  readonly payload: unknown;

  constructor(message: string, code: number, payload?: unknown) {
    super(message);
    this.name = "FeatureApiError";
    this.code = code;
    this.payload = payload;
  }
}

/** Build an absolute URL for a `/api/v1/...` path on the hiai-kit backend. */
export function featureApiUrl(path: string): string {
  const base = config.hiaiKitApiUrl.replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function isErrorPayload(
  payload: unknown
): payload is { error: boolean; message?: unknown; code?: unknown } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { error?: unknown }).error === true
  );
}

function errorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null && "message" in payload) {
    return String((payload as { message: unknown }).message);
  }
  return fallback;
}

/**
 * Typed JSON fetch against the hiai-kit feature API. Sends credentials and
 * normalizes both non-2xx responses and hiai-kit `{ error: true }` bodies
 * into `FeatureApiError`.
 */
export async function featureFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(featureApiUrl(path), {
      ...init,
      headers,
      credentials: "include",
    });
  } catch (error) {
    throw new FeatureApiError(
      `Network error calling ${path}: ${error instanceof Error ? error.message : String(error)}`,
      0
    );
  }

  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  const payload = isJson ? await response.json().catch(() => undefined) : undefined;

  if (!response.ok) {
    throw new FeatureApiError(
      errorMessage(payload, `HTTP ${response.status}`),
      response.status,
      payload
    );
  }

  if (isErrorPayload(payload)) {
    throw new FeatureApiError(
      errorMessage(payload, "Feature request failed"),
      Number(payload.code ?? 500),
      payload
    );
  }

  return payload as T;
}
