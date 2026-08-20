/**
 * hiai-kit carousel job client — `/api/v1/carousel` (job-based pipeline).
 *
 * Endpoints mirror the verified hiai-kit routes (7 endpoints, MAX_SLIDES = 10,
 * 7 presets). Write routes (`createJob`, `regenerateSlide`) are gated by
 * hiai-kit's `requireAuth` + `agents:write` RBAC — without a configured
 * server-side session they fail with 401 mapped to `HIAI_KIT_ERROR` (see
 * config.ts); this boundary does not claim authentication works otherwise.
 *
 * Slide JSON documents and cover PNGs are fetched through this server-side
 * client so hiai-kit URLs never reach the frontend.
 */
import type { HiaiKitClientConfig } from "./config.js";
import { HiaiKitError } from "./errors.js";
import { hiaiKitBinary, hiaiKitJson, parseResponse } from "./http.js";
import {
  CAROUSEL_JOB_ID_PATTERN,
  type CarouselJob,
  type CarouselJobSummary,
  type CreateCarouselInput,
  type CreateCarouselResult,
  carouselJobSchema,
  carouselJobSummarySchema,
  carouselJobsEnvelopeSchema,
  createCarouselInputSchema,
  createCarouselResultSchema,
  jsonValueSchema,
  MAX_CAROUSEL_SLIDES,
  type RegenerateSlideResult,
  regenerateSlideResultSchema,
} from "./schemas.js";

const CAROUSEL_PREFIX = "/api/v1/carousel";

export interface CarouselCover {
  contentType: string;
  data: ArrayBuffer;
}

export interface CarouselClient {
  /** `GET /api/v1/carousel/list` — public job index. */
  listJobs(): Promise<CarouselJobSummary[]>;
  /** `GET /api/v1/carousel/by-slug/:slug` — public. */
  getJobBySlug(slug: string): Promise<CarouselJob>;
  /** `GET /api/v1/carousel/:id` — requires a session on hiai-kit. */
  getJob(jobId: string): Promise<CarouselJob>;
  /** `POST /api/v1/carousel` — requires auth + `agents:write`. */
  createJob(input: CreateCarouselInput): Promise<CreateCarouselResult>;
  /** `GET /api/v1/carousel/:id/slide/:n/json` — raw generated slide document. */
  getSlideJson(jobId: string, slideNumber: number): Promise<unknown>;
  /** `POST /api/v1/carousel/:id/slide/:n/regenerate` — requires agents:write. */
  regenerateSlide(
    jobId: string,
    slideNumber: number,
    description?: string
  ): Promise<RegenerateSlideResult>;
  /** `GET /api/v1/carousel/:id/cover.png` — binary cover image. */
  getCover(jobId: string): Promise<CarouselCover>;
}

function assertJobId(jobId: string, path: string): void {
  if (!CAROUSEL_JOB_ID_PATTERN.test(jobId)) {
    throw new HiaiKitError("VALIDATION_ERROR", `Invalid carousel job id: ${jobId}`, 400, { path });
  }
}

function assertSlideNumber(slideNumber: number, path: string): void {
  if (!Number.isInteger(slideNumber) || slideNumber < 1 || slideNumber > MAX_CAROUSEL_SLIDES) {
    throw new HiaiKitError(
      "VALIDATION_ERROR",
      `Slide number must be an integer between 1 and ${MAX_CAROUSEL_SLIDES}`,
      400,
      { path }
    );
  }
}

export function createCarouselClient(config: HiaiKitClientConfig): CarouselClient {
  return {
    async listJobs(): Promise<CarouselJobSummary[]> {
      const path = `${CAROUSEL_PREFIX}/list`;
      const { data, correlationId } = await hiaiKitJson(config, { path });
      const envelope = parseResponse(carouselJobsEnvelopeSchema, data, correlationId, path);
      return parseResponse(
        carouselJobSummarySchema.array(),
        envelope.jobs,
        correlationId,
        path
      ) as CarouselJobSummary[];
    },

    async getJobBySlug(slug: string): Promise<CarouselJob> {
      const path = `${CAROUSEL_PREFIX}/by-slug/${encodeURIComponent(slug)}`;
      const { data, correlationId } = await hiaiKitJson(config, { path });
      return parseResponse(carouselJobSchema, data, correlationId, path);
    },

    async getJob(jobId: string): Promise<CarouselJob> {
      const path = `${CAROUSEL_PREFIX}/${jobId}`;
      assertJobId(jobId, path);
      const { data, correlationId } = await hiaiKitJson(config, { path });
      return parseResponse(carouselJobSchema, data, correlationId, path);
    },

    async createJob(input: CreateCarouselInput): Promise<CreateCarouselResult> {
      const path = CAROUSEL_PREFIX;
      const inputParse = createCarouselInputSchema.safeParse(input);
      if (!inputParse.success) {
        throw new HiaiKitError("VALIDATION_ERROR", "Invalid carousel creation payload", 400, {
          path,
        });
      }
      const { data, correlationId } = await hiaiKitJson(config, {
        method: "POST",
        path,
        body: input,
      });
      return parseResponse(createCarouselResultSchema, data, correlationId, path);
    },

    async getSlideJson(jobId: string, slideNumber: number): Promise<unknown> {
      const path = `${CAROUSEL_PREFIX}/${jobId}/slide/${slideNumber}/json`;
      assertJobId(jobId, path);
      assertSlideNumber(slideNumber, path);
      const { data, correlationId } = await hiaiKitJson(config, { path });
      return parseResponse(jsonValueSchema, data, correlationId, path);
    },

    async regenerateSlide(
      jobId: string,
      slideNumber: number,
      description?: string
    ): Promise<RegenerateSlideResult> {
      const path = `${CAROUSEL_PREFIX}/${jobId}/slide/${slideNumber}/regenerate`;
      assertJobId(jobId, path);
      assertSlideNumber(slideNumber, path);
      const { data, correlationId } = await hiaiKitJson(config, {
        method: "POST",
        path,
        body: description ? { description } : {},
      });
      return parseResponse(regenerateSlideResultSchema, data, correlationId, path);
    },

    async getCover(jobId: string): Promise<CarouselCover> {
      const path = `${CAROUSEL_PREFIX}/${jobId}/cover.png`;
      assertJobId(jobId, path);
      const result = await hiaiKitBinary(config, { path });
      return { contentType: result.contentType, data: result.data };
    },
  };
}
