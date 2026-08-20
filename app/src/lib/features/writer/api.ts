/**
 * Typed same-origin client for the Writer feature.
 *
 * Every request goes through the SvelteKit proxy (`/api/v1/*`), which
 * injects the existing Better Auth session (`Authorization: Bearer`) and the
 * resolved workspace (`X-Tenant-Id`) server-side — the backend protected
 * routes are never called directly from the browser and hiai-kit is never
 * called from the frontend.
 *
 * The backend normalizes failures into `{ error, code, message?, details?,
 * correlationId? }` envelopes (DomainError) or hiai-kit envelopes
 * (`{ error: "HIAI_KIT_ERROR", message, status, correlationId }`); this
 * client surfaces them as `WriterApiError` so the UI can show the code and
 * the correlation id (for hiai-kit failures).
 */

export type WriterContentType = "social_post" | "article";

export type ContentItemStatus = "draft" | "in_review" | "approved" | "changes_requested";

export interface ContentItem {
  id: string;
  tenantId: string;
  projectId: string | null;
  brandId: string | null;
  title: string;
  status: ContentItemStatus;
  bodyText: string | null;
  bodyJson: Record<string, unknown> | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContentRevision {
  id: string;
  contentItemId: string;
  revisionNumber: number;
  title: string;
  bodyText: string | null;
  bodyJson: Record<string, unknown> | null;
  changeNote: string | null;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
}

export interface WriterGenerateInput {
  projectId?: string;
  contentType: WriterContentType;
  topic: string;
  language?: string;
  tone?: string;
  instruction?: string;
  context?: string;
}

export interface WriterRewriteInput {
  contentItemId: string;
  topic?: string;
  instruction: string;
  language?: string;
  tone?: string;
  context?: string;
}

export interface WriterResult {
  item: ContentItem;
  revision: ContentRevision;
  /** "hiai-kit:content.article" | "local:content-generate" (temporary fallback). */
  backend: string;
  correlationId?: string;
}

/** Backend error envelope shape (shared + hiai-kit normalized). */
interface ErrorEnvelope {
  error?: string;
  message?: string;
  code?: string;
  details?: unknown;
  correlationId?: string;
}

export class WriterApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly correlationId: string | undefined;
  readonly details: unknown;

  constructor(message: string, status: number, envelope?: ErrorEnvelope) {
    super(message);
    this.name = "WriterApiError";
    this.status = status;
    this.code = envelope?.code;
    this.correlationId = envelope?.correlationId;
    this.details = envelope?.details;
  }
}

function envelopeMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null) {
    const p = payload as ErrorEnvelope;
    if (typeof p.message === "string" && p.message.length > 0) return p.message;
    if (typeof p.error === "string" && p.error.length > 0) return p.error;
  }
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: "include" });
  } catch (error) {
    throw new WriterApiError(
      `Network error calling ${path}: ${error instanceof Error ? error.message : String(error)}`,
      0
    );
  }

  const payload = (await response.json().catch(() => undefined)) as unknown;

  if (!response.ok) {
    const envelope =
      typeof payload === "object" && payload !== null ? (payload as ErrorEnvelope) : undefined;
    throw new WriterApiError(
      envelopeMessage(payload, `HTTP ${response.status}`),
      response.status,
      envelope
    );
  }

  return payload as T;
}

// ─── Writer endpoints (backend/src/api/routes/writer.ts) ──────────────────

/** POST /api/v1/writer/generate — create a content item + revision #1. */
export function generateWriter(input: WriterGenerateInput): Promise<WriterResult> {
  return request<WriterResult>("/api/v1/writer/generate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** POST /api/v1/writer/rewrite — rewrite an item (append-only revision). */
export function rewriteWriter(input: WriterRewriteInput): Promise<WriterResult> {
  return request<WriterResult>("/api/v1/writer/rewrite", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ─── Content routes (existing /api/v1/content — reused for reads + review) ─

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** GET /api/v1/content — recent items for the workspace. */
export async function listContentItems(
  options: { limit?: number; status?: string } = {}
): Promise<{ items: ContentItem[]; pagination: Pagination }> {
  const query = new URLSearchParams();
  if (options.limit != null) query.set("limit", String(options.limit));
  if (options.status) query.set("status", options.status);
  const qs = query.toString();
  return request<{ items: ContentItem[]; pagination: Pagination }>(
    `/api/v1/content${qs ? `?${qs}` : ""}`
  );
}

/** GET /api/v1/content/:id — single item. */
export function getContentItem(id: string): Promise<{ item: ContentItem }> {
  return request<{ item: ContentItem }>(`/api/v1/content/${id}`);
}

/** GET /api/v1/content/:id/revisions — immutable history (newest first). */
export function listRevisions(id: string): Promise<{ revisions: ContentRevision[] }> {
  return request<{ revisions: ContentRevision[] }>(`/api/v1/content/${id}/revisions`);
}

/** POST /api/v1/content/:id/revisions — save the working copy as a new revision. */
export function createRevision(
  id: string,
  input: { title: string; bodyText: string; changeNote?: string }
): Promise<{ revision: ContentRevision }> {
  return request<{ revision: ContentRevision }>(`/api/v1/content/${id}/revisions`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** POST /api/v1/content/:id/revisions/:revisionId/restore — restore + append. */
export function restoreRevision(
  id: string,
  revisionId: string
): Promise<{ item: ContentItem; revision: ContentRevision }> {
  return request<{ item: ContentItem; revision: ContentRevision }>(
    `/api/v1/content/${id}/revisions/${revisionId}/restore`,
    { method: "POST" }
  );
}

/** POST /api/v1/content/:id/submit-review — draft → in_review (editor+). */
export function submitForReview(id: string): Promise<{ item: ContentItem }> {
  return request<{ item: ContentItem }>(`/api/v1/content/${id}/submit-review`, { method: "POST" });
}

/** POST /api/v1/content/:id/request-changes — in_review → changes_requested (editor+, with reviewer note). */
export function requestContentChanges(id: string, note: string): Promise<{ item: ContentItem }> {
  return request<{ item: ContentItem }>(`/api/v1/content/${id}/request-changes`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

/** POST /api/v1/content/:id/approve — in_review → approved (admin+). */
export function approveContent(id: string): Promise<{ item: ContentItem }> {
  return request<{ item: ContentItem }>(`/api/v1/content/${id}/approve`, { method: "POST" });
}

// ─── Projects (existing /api/v1/projects — context for generation) ─────────

/** GET /api/v1/projects — workspace projects for the project picker. */
export async function listProjects(): Promise<{ projects: Project[] }> {
  const result = await request<{ projects: Project[]; pagination: Pagination }>(
    "/api/v1/projects?limit=100"
  );
  return { projects: result.projects };
}
