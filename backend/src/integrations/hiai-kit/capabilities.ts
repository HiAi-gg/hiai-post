/**
 * Generic hiai-kit capability client — `/api/v1/capabilities/:id/run` with the
 * hiai-kit capability envelope (`{ input, options: { responseMode } }`).
 *
 * Covers the `research.general`, `content.article` and `content.carousel`
 * capabilities with typed input/output validation on top of the generic
 * `runCapability` dispatch.
 *
 * Honesty contract (mirrors hiai-kit): a failed run is NOT an HTTP error —
 * hiai-kit returns 200 with `status: "failed"` and sanitized `errors` (e.g.
 * `provider_config_missing` when the peer has no model keys configured). The
 * typed wrappers therefore resolve with `output: null` for failed runs and
 * leave the `errors` array for the caller to surface.
 */
import type { HiaiKitClientConfig } from "./config.js";
import { HiaiKitError } from "./errors.js";
import { hiaiKitJson, parseResponse } from "./http.js";
import {
  type ArticleInput,
  type ArticleOutput,
  articleInputSchema,
  articleOutputSchema,
  type CapabilityRunAccepted,
  type CapabilityRunRecord,
  type CapabilityRunResult,
  type CarouselCapabilityInput,
  type CarouselCapabilityOutput,
  capabilitiesListEnvelopeSchema,
  capabilityManifestEnvelopeSchema,
  capabilityRunAcceptedSchema,
  capabilityRunEnvelopeSchema,
  capabilityRunResultSchema,
  carouselCapabilityInputSchema,
  carouselCapabilityOutputSchema,
  jsonValueSchema,
  type ResearchGeneralInput,
  type ResearchReport,
  researchGeneralInputSchema,
  researchReportSchema,
  type SerializedCapabilityManifest,
  serializedCapabilityManifestSchema,
} from "./schemas.js";

export interface CapabilityRunOptions {
  /** hiai-kit envelope option; `async` returns 202 `{ runId, status: "accepted" }`. */
  responseMode?: "sync" | "async";
}

export interface CapabilityClient {
  /**
   * Dispatch any registered capability. Resolves with the run result
   * (`status: "completed" | "failed"`) or the accepted record when
   * `options.responseMode === "async"`.
   */
  runCapability(
    capabilityId: string,
    input: unknown,
    options?: CapabilityRunOptions
  ): Promise<CapabilityRunResult | CapabilityRunAccepted>;
  /** Poll an async run: `GET /api/v1/runs/:runId`. */
  getRun(runId: string): Promise<CapabilityRunRecord>;
  /** `GET /api/v1/capabilities/:id` — public manifest. */
  getCapabilityManifest(capabilityId: string): Promise<SerializedCapabilityManifest>;
  /** `GET /api/v1/capabilities?status=…` — public manifest list. */
  listCapabilities(
    status?: "experimental" | "active" | "deprecated"
  ): Promise<SerializedCapabilityManifest[]>;
  /** `research.general` — typed wrapper. */
  researchGeneral(input: ResearchGeneralInput): Promise<CapabilityRunResult<ResearchReport>>;
  /** `content.article` — typed wrapper. */
  contentArticle(input: ArticleInput): Promise<CapabilityRunResult<ArticleOutput>>;
  /** `content.carousel` — typed wrapper (creates a job; poll via carousel client). */
  contentCarousel(
    input: CarouselCapabilityInput
  ): Promise<CapabilityRunResult<CarouselCapabilityOutput>>;
}

const CAPABILITY_PREFIX = "/api/v1";

export function createCapabilityClient(config: HiaiKitClientConfig): CapabilityClient {
  async function runCapability(
    capabilityId: string,
    input: unknown,
    options: CapabilityRunOptions = {}
  ): Promise<CapabilityRunResult | CapabilityRunAccepted> {
    const path = `${CAPABILITY_PREFIX}/capabilities/${capabilityId}/run`;
    if (!jsonValueSchema.safeParse(input).success) {
      throw new HiaiKitError("VALIDATION_ERROR", "Capability input must be a JSON value", 400, {
        path,
      });
    }
    const body = {
      input,
      options: options.responseMode ? { responseMode: options.responseMode } : undefined,
    };
    const { data, correlationId } = await hiaiKitJson(config, { method: "POST", path, body });
    if (options.responseMode === "async") {
      return parseResponse(capabilityRunAcceptedSchema, data, correlationId, path);
    }
    return parseResponse(
      capabilityRunResultSchema,
      data,
      correlationId,
      path
    ) as CapabilityRunResult;
  }

  async function getRun(runId: string): Promise<CapabilityRunRecord> {
    const path = `${CAPABILITY_PREFIX}/runs/${runId}`;
    const { data, correlationId } = await hiaiKitJson(config, { path });
    const envelope = parseResponse(capabilityRunEnvelopeSchema, data, correlationId, path);
    return envelope.run;
  }

  async function getCapabilityManifest(
    capabilityId: string
  ): Promise<SerializedCapabilityManifest> {
    const path = `${CAPABILITY_PREFIX}/capabilities/${capabilityId}`;
    const { data, correlationId } = await hiaiKitJson(config, { path });
    const envelope = parseResponse(capabilityManifestEnvelopeSchema, data, correlationId, path);
    return parseResponse(
      serializedCapabilityManifestSchema,
      envelope.capability,
      correlationId,
      path
    );
  }

  async function listCapabilities(
    status?: "experimental" | "active" | "deprecated"
  ): Promise<SerializedCapabilityManifest[]> {
    const query = status ? `?status=${status}` : "";
    const path = `${CAPABILITY_PREFIX}/capabilities${query}`;
    const { data, correlationId } = await hiaiKitJson(config, { path });
    const envelope = parseResponse(capabilitiesListEnvelopeSchema, data, correlationId, path);
    return envelope.capabilities;
  }

  /** Shared tail for typed wrappers: validate output only on completed runs. */
  function parseTypedOutput<TOutput>(
    result: CapabilityRunResult,
    outputSchema: { safeParse: (data: unknown) => { success: boolean } },
    capabilityId: string,
    path: string
  ): CapabilityRunResult<TOutput> {
    if (result.status === "failed") {
      // Sanitized run failure (e.g. provider_config_missing) — surface errors,
      // do not attempt output validation.
      return result as CapabilityRunResult<TOutput>;
    }
    if (!outputSchema.safeParse(result.output).success) {
      throw new HiaiKitError(
        "HIAI_KIT_ERROR",
        `hiai-kit output for ${capabilityId} violated the expected contract`,
        502,
        { path }
      );
    }
    return result as CapabilityRunResult<TOutput>;
  }

  async function researchGeneral(
    input: ResearchGeneralInput
  ): Promise<CapabilityRunResult<ResearchReport>> {
    const path = `${CAPABILITY_PREFIX}/capabilities/research.general/run`;
    const inputParse = researchGeneralInputSchema.safeParse(input);
    if (!inputParse.success) {
      throw new HiaiKitError(
        "VALIDATION_ERROR",
        "Invalid input for capability research.general",
        400,
        {
          path,
        }
      );
    }
    const result = (await runCapability("research.general", input)) as CapabilityRunResult;
    return parseTypedOutput<ResearchReport>(result, researchReportSchema, "research.general", path);
  }

  async function contentArticle(input: ArticleInput): Promise<CapabilityRunResult<ArticleOutput>> {
    const path = `${CAPABILITY_PREFIX}/capabilities/content.article/run`;
    const inputParse = articleInputSchema.safeParse(input);
    if (!inputParse.success) {
      throw new HiaiKitError(
        "VALIDATION_ERROR",
        "Invalid input for capability content.article",
        400,
        {
          path,
        }
      );
    }
    const result = (await runCapability("content.article", input)) as CapabilityRunResult;
    return parseTypedOutput<ArticleOutput>(result, articleOutputSchema, "content.article", path);
  }

  async function contentCarousel(
    input: CarouselCapabilityInput
  ): Promise<CapabilityRunResult<CarouselCapabilityOutput>> {
    const path = `${CAPABILITY_PREFIX}/capabilities/content.carousel/run`;
    const inputParse = carouselCapabilityInputSchema.safeParse(input);
    if (!inputParse.success) {
      throw new HiaiKitError(
        "VALIDATION_ERROR",
        "Invalid input for capability content.carousel",
        400,
        {
          path,
        }
      );
    }
    const result = (await runCapability("content.carousel", input)) as CapabilityRunResult;
    return parseTypedOutput<CarouselCapabilityOutput>(
      result,
      carouselCapabilityOutputSchema,
      "content.carousel",
      path
    );
  }

  return {
    runCapability,
    getRun,
    getCapabilityManifest,
    listCapabilities,
    researchGeneral,
    contentArticle,
    contentCarousel,
  };
}
