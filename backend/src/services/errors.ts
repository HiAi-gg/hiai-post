/**
 * Domain error types + response envelopes for the shared product
 * foundation services (backend/src/services/*).
 *
 * Services throw these typed errors instead of returning ad-hoc status
 * payloads; route handlers catch them and map to an HTTP response via
 * `toErrorEnvelope` + `err.status`. Zod validation failures are normalized
 * to a `ValidationError` (400) so the envelope is uniform across the API.
 */

/** Envelope codes mirror the middleware codes (e.g. TENANT_ACCESS_DENIED). */
export type DomainErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_TRANSITION"
  | "VALIDATION"
  | "INTERNAL";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: DomainErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "Not found") {
    super("NOT_FOUND", message, 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, code: DomainErrorCode = "CONFLICT") {
    super(code, message, 409);
    this.name = "ConflictError";
  }
}

export class ValidationError extends DomainError {
  constructor(message = "Validation failed", details?: unknown) {
    super("VALIDATION", message, 400, details);
    this.name = "ValidationError";
  }
}

export interface ErrorEnvelope {
  error: string;
  code: string;
  message?: string;
  details?: unknown;
}

/**
 * Normalize an unknown thrown value into a response envelope. Unknown/non
 * domain errors are rethrown so the global `handleError` maps them to 500 —
 * services should only ever surface DomainErrors for expected conditions.
 */
export function toErrorEnvelope(err: unknown): ErrorEnvelope {
  if (err instanceof DomainError) {
    const envelope: ErrorEnvelope = { error: err.message, code: err.code };
    if (err.details !== undefined) envelope.details = err.details;
    return envelope;
  }
  throw err;
}

/**
 * Route-handler helper: set the HTTP status for a DomainError and return the
 * envelope, or rethrow (global handler → 500) for anything unexpected.
 */
export function handleServiceError(set: { status?: number }, err: unknown): ErrorEnvelope {
  if (err instanceof DomainError) {
    set.status = err.status;
    return toErrorEnvelope(err);
  }
  throw err;
}
