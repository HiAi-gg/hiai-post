/**
 * Same-origin client for the hiai-post Carousel product API
 * (`/api/v1/carousels`).
 *
 * Requests go through the SvelteKit proxy (`src/routes/api/v1/[...path]/+server.ts`),
 * which injects the session `Authorization` + `X-Tenant-Id` headers
 * server-side — the browser never talks to hiai-kit directly and never
 * builds hiai-kit URLs.
 */

export type CarouselItemStatus = "draft" | "in_review" | "approved" | "changes_requested";

export type CarouselJobStatus = "running" | "done" | "failed";

export interface CarouselSlideData {
  title: string;
  content: string;
  /** The actual generated slide document (persisted after slide regeneration). */
  doc?: unknown;
  regeneratedAt?: string;
  /** When the slide document was last saved via the document-save endpoint. */
  savedAt?: string;
}

export interface CarouselBodyJson {
  kind: "carousel";
  jobId: string;
  slug: string;
  carouselTitle: string;
  designPreset: string;
  slideWidth?: number;
  slideHeight?: number;
  styleDescription?: string | null;
  handle?: string | null;
  ctaText?: string | null;
  jobStatus: CarouselJobStatus;
  slides: CarouselSlideData[];
}

export interface CarouselItem {
  id: string;
  tenantId: string;
  projectId?: string | null;
  brandId?: string | null;
  title: string;
  status: CarouselItemStatus;
  bodyText?: string | null;
  bodyJson: CarouselBodyJson;
  reviewNote?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CarouselRevision {
  id: string;
  contentItemId: string;
  revisionNumber: number;
  title: string;
  bodyText?: string | null;
  bodyJson?: CarouselBodyJson | null;
  changeNote?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

export interface CarouselJobProgress {
  currentStep: string;
  stepDetail: string;
  slideProgress?: { current: number; total: number };
  estimatedRemaining?: number;
}

export interface CarouselJobResult {
  coverImagePath: string | null;
  slidePngPaths: string[];
  slideJsonPaths?: string[];
}

export interface CarouselJob {
  jobId: string;
  slug: string;
  carouselTitle: string;
  status: CarouselJobStatus;
  step: string;
  stepIndex: number;
  totalSteps: number;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  slideWidth: number;
  slideHeight: number;
  progress?: CarouselJobProgress;
  result: CarouselJobResult;
}

export interface CarouselSlideInput {
  title: string;
  content: string;
}

export const CAROUSEL_PRESETS = [
  "minimal",
  "bold",
  "gradient",
  "elegant",
  "playful",
  "corporate",
  "custom",
] as const;
export type CarouselDesignPreset = (typeof CAROUSEL_PRESETS)[number];

export const MAX_CAROUSEL_SLIDES = 10;

export interface CreateCarouselInput {
  carouselTitle: string;
  slides: CarouselSlideInput[];
  designPreset: CarouselDesignPreset;
  slideWidth?: number;
  slideHeight?: number;
  styleDescription?: string;
  handle?: string;
  ctaText?: string;
}

export interface RegenerateCarouselPatch {
  carouselTitle?: string;
  slides?: CarouselSlideInput[];
  designPreset?: CarouselDesignPreset;
  slideWidth?: number;
  slideHeight?: number;
  styleDescription?: string | null;
  handle?: string | null;
  ctaText?: string | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Error raised for non-2xx (or normalized hiai-kit capability) responses. */
export class CarouselApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly correlationId?: string;

  constructor(message: string, status: number, code?: string, correlationId?: string) {
    super(message);
    this.name = "CarouselApiError";
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`/api/v1/carousels${path}`, { ...init, headers });
  } catch (error) {
    throw new CarouselApiError(
      `Network error calling /api/v1/carousels${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      0
    );
  }

  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  const payload = isJson ? await response.json().catch(() => undefined) : undefined;

  if (!response.ok) {
    const body = payload as { message?: unknown; error?: unknown; code?: unknown } | undefined;
    const message = typeof body?.message === "string" ? body.message : `HTTP ${response.status}`;
    throw new CarouselApiError(
      message,
      response.status,
      typeof body?.code === "string" ? body.code : undefined,
      (payload as { correlationId?: string } | undefined)?.correlationId
    );
  }

  return payload as T;
}

export async function listCarousels(): Promise<{ items: CarouselItem[]; pagination: Pagination }> {
  return apiFetch("");
}

export async function createCarousel(
  input: CreateCarouselInput
): Promise<{ item: CarouselItem; job: { jobId: string; slug: string } }> {
  return apiFetch("", { method: "POST", body: JSON.stringify(input) });
}

export async function getCarousel(id: string): Promise<{ item: CarouselItem }> {
  return apiFetch(`/${encodeURIComponent(id)}`);
}

export async function getCarouselRevisions(id: string): Promise<{ revisions: CarouselRevision[] }> {
  return apiFetch(`/${encodeURIComponent(id)}/revisions`);
}

export async function getCarouselJob(id: string): Promise<{ job: CarouselJob }> {
  return apiFetch(`/${encodeURIComponent(id)}/job`);
}

export async function getCarouselSlideJson(
  id: string,
  slideNumber: number
): Promise<{ json: unknown }> {
  return apiFetch(`/${encodeURIComponent(id)}/slides/${slideNumber}/json`);
}

export async function regenerateCarousel(
  id: string,
  patch: RegenerateCarouselPatch = {}
): Promise<{
  item: CarouselItem;
  revision: CarouselRevision;
  job: { jobId: string; slug: string };
}> {
  return apiFetch(`/${encodeURIComponent(id)}/regenerate`, {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

export async function regenerateCarouselSlide(
  id: string,
  slideNumber: number,
  description?: string
): Promise<{ item: CarouselItem; revision: CarouselRevision; slide: CarouselSlideData }> {
  return apiFetch(`/${encodeURIComponent(id)}/slides/${slideNumber}/regenerate`, {
    method: "POST",
    body: JSON.stringify(description ? { description } : {}),
  });
}

/**
 * Persist a slide's actual hiai-kit document. The body IS the document
 * (`{ version, width, height, background?, elements? }`); the backend
 * validates the shape, replaces only the selected slide's `doc` and appends
 * an immutable revision. Resolves to the normalized current content (`item`),
 * the appended `revision` and the saved `slide`.
 */
export async function saveCarouselSlideDocument(
  id: string,
  slideNumber: number,
  doc: unknown
): Promise<{ item: CarouselItem; revision: CarouselRevision; slide: CarouselSlideData }> {
  return apiFetch(`/${encodeURIComponent(id)}/slides/${slideNumber}/json`, {
    method: "PUT",
    body: JSON.stringify(doc),
  });
}

export async function submitCarouselForReview(id: string): Promise<{ item: CarouselItem }> {
  return apiFetch(`/${encodeURIComponent(id)}/submit-review`, { method: "POST" });
}

export async function requestCarouselChanges(
  id: string,
  note: string
): Promise<{ item: CarouselItem }> {
  return apiFetch(`/${encodeURIComponent(id)}/request-changes`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export async function approveCarousel(id: string): Promise<{ item: CarouselItem }> {
  return apiFetch(`/${encodeURIComponent(id)}/approve`, { method: "POST" });
}
