/**
 * Postiz integration boundary — normalized errors.
 *
 * The boundary NEVER fabricates a live result: when Postiz is not configured
 * the client throws `NOT_CONFIGURED` (503); every other failure is normalized
 * to a typed `PostizError` carrying a correlation id so failures trace end-to-
 * end. Error bodies from Postiz are sanitized (message only — no raw bodies,
 * no secrets).
 */
export type PostizErrorCode = "NOT_CONFIGURED" | "TIMEOUT" | "VALIDATION_ERROR" | "POSTIZ_ERROR";

export class PostizError extends Error {
  readonly code: PostizErrorCode;
  readonly status: number;
  readonly correlationId: string;
  readonly details?: unknown;

  constructor(
    code: PostizErrorCode,
    message: string,
    status: number,
    details?: { correlationId?: string; path?: string; timeoutMs?: number; status?: number }
  ) {
    super(message);
    this.name = "PostizError";
    this.code = code;
    this.status = status;
    this.correlationId = details?.correlationId ?? "";
    this.details = details;
  }
}

export interface PostizErrorEnvelope {
  error: string;
  code: string;
  message?: string;
  status?: number;
  correlationId?: string;
}

export function toPostizErrorEnvelope(err: unknown): PostizErrorEnvelope | undefined {
  if (err instanceof PostizError) {
    const envelope: PostizErrorEnvelope = {
      error: err.code,
      code: err.code,
      message: err.message,
      status: err.status,
    };
    if (err.correlationId) envelope.correlationId = err.correlationId;
    return envelope;
  }
  return undefined;
}
