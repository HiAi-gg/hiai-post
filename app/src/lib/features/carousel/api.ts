import { featureApiUrl, featureFetch } from "../shared/client";

/**
 * Typed client for the hiai-kit `/api/v1/carousel` endpoints (job-based,
 * poll `getCarouselJob` until `status` is `"done"` or `"failed"`).
 */

export type CarouselJobStatus = "running" | "done" | "failed";
export type CarouselJobStep = "marketing" | "assets" | "done";

export interface CarouselJobProgress {
  currentStep: string;
  stepDetail: string;
  slideProgress?: { current: number; total: number };
  estimatedRemaining?: number; // seconds
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
  step: CarouselJobStep;
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

export interface CarouselJobSummary {
  jobId: string;
  slug: string;
  carouselTitle: string;
  createdAt: string;
  status: CarouselJobStatus;
}

export interface CarouselSlide {
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
  slides: CarouselSlide[];
  designPreset: CarouselDesignPreset;
  slideWidth?: number;
  slideHeight?: number;
  styleDescription?: string;
  handle?: string;
  ctaText?: string;
}

export interface CreateCarouselResult {
  jobId: string;
  slug: string;
}

function carouselUrl(path: string): string {
  return featureApiUrl(`/api/v1/carousel${path}`);
}

/** Absolute URL of a job's cover image (usable directly in `<img src>`). */
export function carouselCoverUrl(jobId: string): string {
  return carouselUrl(`/${jobId}/cover.png`);
}

/** Absolute URL of a job's slide JSON document. */
export function carouselSlideJsonUrl(jobId: string, slideNumber: number): string {
  return carouselUrl(`/${jobId}/slide/${slideNumber}/json`);
}

export async function listCarouselJobs(): Promise<CarouselJobSummary[]> {
  const { jobs } = await featureFetch<{ jobs: CarouselJobSummary[] }>("/api/v1/carousel/list");
  return jobs;
}

export async function getCarouselJob(jobId: string): Promise<CarouselJob> {
  return featureFetch<CarouselJob>(`/api/v1/carousel/${jobId}`);
}

export async function getCarouselJobBySlug(slug: string): Promise<CarouselJob> {
  return featureFetch<CarouselJob>(`/api/v1/carousel/by-slug/${slug}`);
}

export async function createCarousel(input: CreateCarouselInput): Promise<CreateCarouselResult> {
  return featureFetch<CreateCarouselResult>("/api/v1/carousel", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Read a generated slide document (raw JSON, rendered client-side). */
export async function fetchCarouselSlideJson(jobId: string, slideNumber: number): Promise<unknown> {
  return featureFetch<unknown>(`/api/v1/carousel/${jobId}/slide/${slideNumber}/json`);
}

/** Regenerate a single slide via the LLM. Resolves to `{ json: <doc> }`. */
export async function regenerateCarouselSlide(
  jobId: string,
  slideNumber: number,
  description?: string
): Promise<{ json: unknown }> {
  return featureFetch<{ json: unknown }>(
    `/api/v1/carousel/${jobId}/slide/${slideNumber}/regenerate`,
    {
      method: "POST",
      body: JSON.stringify(description ? { description } : {}),
    }
  );
}
