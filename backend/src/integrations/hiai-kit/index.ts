/**
 * Centralized hiai-kit integration boundary (server-side).
 *
 * The ONLY module that talks to the hiai-kit backend. The frontend never
 * builds hiai-kit URLs; backend routes use `createHiaiKitClient()` and
 * re-expose typed data (or proxied binaries) to the frontend.
 *
 * Surfaces:
 *   - `capabilities` — generic capability client for `research.general`,
 *     `content.article` and `content.carousel` over the hiai-kit capability
 *     envelope (`POST /api/v1/capabilities/:id/run`);
 *   - `carousel` — job lifecycle methods (`/api/v1/carousel`).
 *
 * Errors are normalized `HiaiKitError`s with correlation ids; see errors.ts.
 */
import { type CapabilityClient, createCapabilityClient } from "./capabilities.js";
import { type CarouselClient, createCarouselClient } from "./carousel.js";
import { type HiaiKitClientConfig, hiaiKitConfig } from "./config.js";

export interface HiaiKitClient {
  capabilities: CapabilityClient;
  carousel: CarouselClient;
}

export function createHiaiKitClient(config: HiaiKitClientConfig = hiaiKitConfig()): HiaiKitClient {
  return {
    capabilities: createCapabilityClient(config),
    carousel: createCarouselClient(config),
  };
}

export type { CapabilityClient, CapabilityRunOptions } from "./capabilities.js";
export type { CarouselClient, CarouselCover } from "./carousel.js";
export type { HiaiKitClientConfig } from "./config.js";
export { hiaiKitConfig, hiaiKitConfigSummary } from "./config.js";
export type {
  HiaiKitErrorCode,
  HiaiKitErrorDetails,
  HiaiKitErrorEnvelope,
} from "./errors.js";
export {
  HIAI_KIT_ERROR_CODES,
  HiaiKitError,
  isHiaiKitError,
  toHiaiKitErrorEnvelope,
} from "./errors.js";
export type {
  AgentArtifact,
  ArticleInput,
  ArticleOutput,
  CapabilityError,
  CapabilityManifestStatus,
  CapabilityRunAccepted,
  CapabilityRunRecord,
  CapabilityRunResult,
  CapabilitySource,
  CarouselCapabilityInput,
  CarouselCapabilityOutput,
  CarouselDesignPreset,
  CarouselJob,
  CarouselJobStatus,
  CarouselJobStep,
  CarouselJobSummary,
  CreateCarouselInput,
  CreateCarouselResult,
  RegenerateSlideResult,
  ResearchGeneralInput,
  ResearchReport,
  SerializedCapabilityManifest,
  SlideBackgroundShape,
  SlideDocumentShape,
  SlideElementShape,
  SlideGradientShape,
} from "./schemas.js";
export {
  CAROUSEL_JOB_ID_PATTERN,
  CAROUSEL_PRESETS,
  MAX_CAROUSEL_SLIDES,
  slideBackgroundSchema,
  slideDocumentSchema,
  slideElementSchema,
  slideGradientSchema,
} from "./schemas.js";
