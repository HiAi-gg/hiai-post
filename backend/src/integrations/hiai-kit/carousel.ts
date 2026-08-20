/**
 * hiai-kit carousel job client — `/api/v1/carousel` (job-based pipeline).
 *
 * Endpoints mirror the verified hiai-kit routes (MAX_SLIDES = 10,
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
  type AddBlankSlideResult,
  addBlankSlideResultSchema,
  type EditCoverResult,
  editCoverResultSchema,
  type SaveSlideJsonResult,
  type SaveSlidePngResult,
  saveSlideJsonResultSchema,
  saveSlidePngResultSchema,
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
  /** `PUT /api/v1/carousel/:id/slide/:n/json` — persist edited slide JSON. */
  saveSlideJson(jobId: string, slideNumber: number, doc: unknown): Promise<SaveSlideJsonResult>;
  /** `PUT /api/v1/carousel/:id/slide/:n/png` — persist a client Konva export. */
  uploadSlidePng(
    jobId: string,
    slideNumber: number,
    bytes: Uint8Array
  ): Promise<SaveSlidePngResult>;
  /** `GET /api/v1/carousel/:id/slide/:n/png` — only exists after upload. */
  getSlidePng(jobId: string, slideNumber: number): Promise<CarouselCover>;
  /** `POST /api/v1/carousel/:id/slide/add` — append a blank slide JSON. */
  addBlankSlide(jobId: string): Promise<AddBlankSlideResult>;
  /** `POST /api/v1/carousel/:id/cover/edit` — AI-edit the existing cover.png. */
  editCover(jobId: string, description: string): Promise<EditCoverResult>;
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

    async saveSlideJson(
      jobId: string,
      slideNumber: number,
      doc: unknown
    ): Promise<SaveSlideJsonResult> {
      const path = `${CAROUSEL_PREFIX}/${jobId}/slide/${slideNumber}/json`;
      assertJobId(jobId, path);
      assertSlideNumber(slideNumber, path);
      const { data, correlationId } = await hiaiKitJson(config, {
        method: "PUT",
        path,
        body: doc,
      });
      return parseResponse(saveSlideJsonResultSchema, data, correlationId, path);
    },

    async uploadSlidePng(
      jobId: string,
      slideNumber: number,
      bytes: Uint8Array
    ): Promise<SaveSlidePngResult> {
      const path = `${CAROUSEL_PREFIX}/${jobId}/slide/${slideNumber}/png`;
      assertJobId(jobId, path);
      assertSlideNumber(slideNumber, path);
      const { data, correlationId } = await hiaiKitJson(config, {
        method: "PUT",
        path,
        binaryBody: bytes,
        contentType: "image/png",
      });
      return parseResponse(saveSlidePngResultSchema, data, correlationId, path);
    },

    async getSlidePng(jobId: string, slideNumber: number): Promise<CarouselCover> {
      const path = `${CAROUSEL_PREFIX}/${jobId}/slide/${slideNumber}/png`;
      assertJobId(jobId, path);
      assertSlideNumber(slideNumber, path);
      const result = await hiaiKitBinary(config, { path });
      return { contentType: result.contentType, data: result.data };
    },

    async addBlankSlide(jobId: string): Promise<AddBlankSlideResult> {
      const path = `${CAROUSEL_PREFIX}/${jobId}/slide/add`;
      assertJobId(jobId, path);
      const { data, correlationId } = await hiaiKitJson(config, {
        method: "POST",
        path,
        body: {},
      });
      return parseResponse(addBlankSlideResultSchema, data, correlationId, path);
    },

    async editCover(jobId: string, description: string): Promise<EditCoverResult> {
      const path = `${CAROUSEL_PREFIX}/${jobId}/cover/edit`;
      assertJobId(jobId, path);
      if (typeof description !== "string" || description.trim().length === 0) {
        throw new HiaiKitError("VALIDATION_ERROR", "Cover edit description is required", 400, {
          path,
        });
      }
      const { data, correlationId } = await hiaiKitJson(config, {
        method: "POST",
        path,
        body: { description: description.trim() },
      });
      return parseResponse(editCoverResultSchema, data, correlationId, path);
    },
  };
}
