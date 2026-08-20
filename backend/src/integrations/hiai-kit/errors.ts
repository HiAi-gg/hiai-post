/**
 * Normalized domain errors for the hiai-kit integration boundary.
 *
 * Every failure surfaced by the hiai-kit client is a `HiaiKitError` with a
 * stable machine-readable code, an HTTP-ish status, and two correlation ids:
 *
 *   - `correlationId` — generated per outgoing request and also sent to
 *     hiai-kit as the `x-trace-id` header (hiai-kit stores it as the run's
 *     trace id when dispatching capabilities);
 *   - `requestId` — hiai-kit's own correlation id, copied from its sanitized
 *     error body `{ error: true, code, message, requestId }` when present.
 *
 * Secrets (session cookie / bearer token) are never included in error
 * messages or details; only booleans like `hasCookie` appear in log-safe
 * summaries.
 */

export const HIAI_KIT_ERROR_CODES = [
  "CAPABILITY_UNAVAILABLE",
  "HIAI_KIT_ERROR",
  "TIMEOUT",
  "VALIDATION_ERROR",
] as const;

export type HiaiKitErrorCode = (typeof HIAI_KIT_ERROR_CODES)[number];

export interface HiaiKitErrorDetails {
  /** Correlation id of the outgoing request (also sent as `x-trace-id`). */
  correlationId?: string;
  /** hiai-kit's correlation id, copied from its error body when present. */
  requestId?: string;
  /** Request path that failed, e.g. `/api/v1/capabilities/research.general/run`. */
  path?: string;
  /** HTTP status returned by hiai-kit (or the mapped one, e.g. 504 for timeouts). */
  status?: number;
  /** Configured timeout in ms (only set for TIMEOUT errors). */
  timeoutMs?: number;
  [key: string]: unknown;
}

/**
 * Normalized domain error for the hiai-kit integration. Callers can match on
 * `code` without depending on hiai-kit's own error vocabulary.
 */
export class HiaiKitError extends Error {
  readonly code: HiaiKitErrorCode;
  readonly status: number;
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly details: HiaiKitErrorDetails;

  constructor(
    code: HiaiKitErrorCode,
    message: string,
    status: number,
    details: HiaiKitErrorDetails = {}
  ) {
    super(message);
    this.name = "HiaiKitError";
    this.code = code;
    this.status = status;
    this.correlationId = details.correlationId;
    this.requestId = details.requestId;
    this.details = details;
  }
}

export function isHiaiKitError(err: unknown): err is HiaiKitError {
  return err instanceof HiaiKitError;
}

/** Log-safe envelope; never contains secrets or stack traces. */
export interface HiaiKitErrorEnvelope {
  error: HiaiKitErrorCode;
  message: string;
  status: number;
  correlationId?: string;
  requestId?: string;
}

/**
 * Convert a thrown value into the normalized envelope, or `undefined` when
 * it is not a `HiaiKitError` (so callers can rethrow/500 unknown errors).
 */
export function toHiaiKitErrorEnvelope(err: unknown): HiaiKitErrorEnvelope | undefined {
  if (!(err instanceof HiaiKitError)) return undefined;
  const envelope: HiaiKitErrorEnvelope = {
    error: err.code,
    message: err.message,
    status: err.status,
  };
  if (err.correlationId) envelope.correlationId = err.correlationId;
  if (err.requestId) envelope.requestId = err.requestId;
  return envelope;
}
