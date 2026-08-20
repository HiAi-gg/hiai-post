/**
 * Typed, runtime-validated request/response schemas for the hiai-kit
 * integration boundary.
 *
 * These mirror the verified hiai-kit contracts (peer repo, read-only):
 *   - capability envelope: `hiai-kit/src/api/routes/capabilities.ts` +
 *     `hiai-kit/src/api/validation/capabilities.ts` +
 *     `hiai-kit/src/capabilities/{types,registry}.ts`;
 *   - carousel jobs: `hiai-kit/src/api/routes/carousel.ts` +
 *     `hiai-kit/src/modules/carousel/job-store.ts`;
 *   - error envelope: `hiai-kit/src/lib/sanitize.ts` (`safeError` /
 *     `toApiErrorBody`).
 *
 * No fields beyond those contracts are invented here.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** Any JSON value — the capability run input is free-form per capability. */
export const jsonValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

/** hiai-kit sanitized error body (`{ error: true, code, message, requestId }`). */
export const hiaiKitErrorBodySchema = z.object({
  error: z.literal(true),
  code: z.union([z.string(), z.number()]),
  message: z.string(),
  requestId: z.string().optional(),
});
export type HiaiKitErrorBody = z.infer<typeof hiaiKitErrorBodySchema>;

// ---------------------------------------------------------------------------
// Capability envelope (/api/v1/capabilities)
// ---------------------------------------------------------------------------

export const capabilityRunBodySchema = z.object({
  input: jsonValueSchema,
  options: z
    .object({
      responseMode: z.enum(["sync", "async"]).optional(),
    })
    .optional(),
});
export type CapabilityRunBody = z.infer<typeof capabilityRunBodySchema>;

export const agentArtifactSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string().optional(),
  content: z.string().optional(),
  mimeType: z.string().optional(),
  storageUrl: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type AgentArtifact = z.infer<typeof agentArtifactSchema>;

export const capabilitySourceSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  score: z.number().optional(),
  sourceType: z.string().optional(),
});
export type CapabilitySource = z.infer<typeof capabilitySourceSchema>;

export const capabilityErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type CapabilityError = z.infer<typeof capabilityErrorSchema>;

/** Synchronous run result — HTTP 200 body of `POST /capabilities/:id/run`. */
export const capabilityRunResultSchema = z.object({
  runId: z.string(),
  capabilityId: z.string(),
  status: z.enum(["completed", "failed"]),
  output: jsonValueSchema,
  artifacts: z.array(agentArtifactSchema),
  sources: z.array(capabilitySourceSchema),
  warnings: z.array(z.string()),
  errors: z.array(capabilityErrorSchema),
});
export type CapabilityRunResultShape = z.infer<typeof capabilityRunResultSchema>;

/** Typed capability run result; `output` is `T` when completed, else null. */
export interface CapabilityRunResult<T = unknown> {
  runId: string;
  capabilityId: string;
  status: "completed" | "failed";
  output: T | null;
  artifacts: AgentArtifact[];
  sources: CapabilitySource[];
  warnings: string[];
  errors: CapabilityError[];
}

/** Async submission — HTTP 202 body of `POST /capabilities/:id/run`. */
export const capabilityRunAcceptedSchema = z.object({
  runId: z.string(),
  status: z.literal("accepted"),
});
export type CapabilityRunAccepted = z.infer<typeof capabilityRunAcceptedSchema>;

/** Run record returned by `GET /runs/:runId`. */
export const capabilityRunRecordSchema = z.object({
  runId: z.string(),
  capabilityId: z.string(),
  status: z.enum(["accepted", "completed", "failed"]),
  output: jsonValueSchema,
  artifacts: z.array(agentArtifactSchema),
  sources: z.array(capabilitySourceSchema),
  warnings: z.array(z.string()),
  errors: z.array(capabilityErrorSchema),
  createdAt: z.string(),
  completedAt: z.string().optional(),
});
export type CapabilityRunRecord = z.infer<typeof capabilityRunRecordSchema>;

/** Serialized manifest (`GET /capabilities` / `GET /capabilities/:id`). */
export const serializedCapabilityManifestSchema = z.object({
  id: z.string(),
  version: z.string(),
  type: z.enum(["agent", "workflow", "tool"]),
  description: z.string(),
  inputSchema: z.object({
    name: z.string(),
    fields: z.array(z.object({ name: z.string(), required: z.boolean() })),
  }),
  outputSchema: z.object({
    name: z.string(),
    fields: z.array(z.object({ name: z.string(), required: z.boolean() })),
  }),
  status: z.enum(["experimental", "active", "deprecated"]),
  supportsStreaming: z.boolean(),
  supportsAsync: z.boolean(),
  requiredProviders: z.array(z.string()),
  requiredTools: z.array(z.string()),
  tests: z.array(z.string()),
});
export type SerializedCapabilityManifest = z.infer<typeof serializedCapabilityManifestSchema>;
export type CapabilityManifestStatus = "experimental" | "active" | "deprecated";

/** Response envelope of `GET /runs/:runId`. */
export const capabilityRunEnvelopeSchema = z.object({
  run: capabilityRunRecordSchema,
});

/** Response envelope of `GET /capabilities/:id`. */
export const capabilityManifestEnvelopeSchema = z.object({
  capability: serializedCapabilityManifestSchema,
});

/** Response envelope of `GET /capabilities`. */
export const capabilitiesListEnvelopeSchema = z.object({
  capabilities: z.array(serializedCapabilityManifestSchema),
});

// ---------------------------------------------------------------------------
// Capability input/output schemas (hiai-kit/src/capabilities/registry.ts)
// ---------------------------------------------------------------------------

/** `research.general` — input + runner output shape. */
export const researchGeneralInputSchema = z.object({
  topic: z.string().min(1),
  language: z.string().optional(),
  duration: z.number().int().positive().optional(),
  mode: z.enum(["auto", "manual"]).optional(),
});
export type ResearchGeneralInput = z.infer<typeof researchGeneralInputSchema>;

export const researchReportSchema = z.object({
  query: z.string(),
  sources: z.array(z.object({ url: z.string(), title: z.string().optional() })),
  summary: z.string(),
  keyInsights: z.array(z.string()),
  trendingAngles: z.array(z.string()),
});
export type ResearchReport = z.infer<typeof researchReportSchema>;

/** `content.article` — input + runner output shape. */
export const articleInputSchema = z.object({
  topic: z.string().min(1),
  lengthHint: z.enum(["short", "medium", "long"]).optional(),
  outcome: z.enum(["draft", "outline"]).optional(),
  tone: z.enum(["neutral", "executive", "technical", "creative"]).optional(),
});
export type ArticleInput = z.infer<typeof articleInputSchema>;

export const articleOutputSchema = z.object({
  intent: z.literal("article"),
  artifact: jsonValueSchema,
  formatted: z.string(),
  generatedAt: z.string(),
});
export type ArticleOutput = z.infer<typeof articleOutputSchema>;

/** `content.carousel` capability — input + runner output shape. */
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

export const carouselCapabilityInputSchema = z.object({
  carouselTitle: z.string().min(1),
  slides: z
    .array(z.object({ title: z.string(), content: z.string() }))
    .min(1)
    .max(MAX_CAROUSEL_SLIDES),
  designPreset: z.enum(CAROUSEL_PRESETS),
  slideWidth: z.number().int().positive().optional(),
  slideHeight: z.number().int().positive().optional(),
  styleDescription: z.string().optional(),
  handle: z.string().optional(),
  ctaText: z.string().optional(),
});
export type CarouselCapabilityInput = z.infer<typeof carouselCapabilityInputSchema>;

export const carouselCapabilityOutputSchema = z.object({
  jobId: z.string(),
  slug: z.string(),
  status: z.string().optional(),
});
export type CarouselCapabilityOutput = z.infer<typeof carouselCapabilityOutputSchema>;

// ---------------------------------------------------------------------------
// Carousel job API (/api/v1/carousel)
// ---------------------------------------------------------------------------

export const carouselJobStatusSchema = z.enum(["running", "done", "failed"]);
export type CarouselJobStatus = z.infer<typeof carouselJobStatusSchema>;

export const carouselJobStepSchema = z.enum(["marketing", "assets", "done"]);
export type CarouselJobStep = z.infer<typeof carouselJobStepSchema>;

export const carouselJobSchema = z.object({
  jobId: z.string(),
  slug: z.string(),
  carouselTitle: z.string(),
  status: carouselJobStatusSchema,
  step: carouselJobStepSchema,
  stepIndex: z.number(),
  totalSteps: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().nullable(),
  slideWidth: z.number(),
  slideHeight: z.number(),
  progress: z
    .object({
      currentStep: z.string(),
      stepDetail: z.string(),
      slideProgress: z.object({ current: z.number(), total: z.number() }).optional(),
      estimatedRemaining: z.number().optional(),
    })
    .optional(),
  result: z.object({
    coverImagePath: z.string().nullable(),
    slidePngPaths: z.array(z.string()),
    slideJsonPaths: z.array(z.string()).optional(),
  }),
});
export type CarouselJob = z.infer<typeof carouselJobSchema>;

export const carouselJobSummarySchema = z.object({
  jobId: z.string(),
  slug: z.string(),
  carouselTitle: z.string(),
  createdAt: z.string(),
  status: carouselJobStatusSchema,
});
export type CarouselJobSummary = z.infer<typeof carouselJobSummarySchema>;

/** Response envelope of `GET /api/v1/carousel/list`. */
export const carouselJobsEnvelopeSchema = z.object({
  jobs: z.array(carouselJobSummarySchema),
});

export const createCarouselInputSchema = carouselCapabilityInputSchema;
export type CreateCarouselInput = CarouselCapabilityInput;

export const createCarouselResultSchema = z.object({
  jobId: z.string(),
  slug: z.string(),
});
export type CreateCarouselResult = z.infer<typeof createCarouselResultSchema>;

export const regenerateSlideBodySchema = z.object({
  description: z.string().optional(),
});

export const regenerateSlideResultSchema = z.object({
  json: jsonValueSchema,
});
export type RegenerateSlideResult = z.infer<typeof regenerateSlideResultSchema>;

/** hiai-kit requires job ids to be UUIDs on the `/:id` routes. */
export const CAROUSEL_JOB_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Slide document schema (`hiai-kit/src/modules/carousel/generate-slide-json.ts`)
// ---------------------------------------------------------------------------
//
// The actual generated slide document persisted as `slides[i].doc` and served
// by `GET /carousels/:id/slides/:index/json`. Mirrors the verified hiai-kit
// interfaces 1:1 (SlideDocument / BackgroundConfig / GradientConfig /
// TextElement / RectElement / CircleElement / LineElement / ImageElement /
// ArrowElement / GroupElement). `passthrough()` keeps every field that
// hiai-kit emits (shadow, dash, future additions…) intact on a round-trip so
// a saved document is persisted exactly as received. Only the structural
// invariants the renderer depends on are enforced: canvas width/height,
// element ids, the known element `type` union and absolute x/y positions.

export const slideGradientSchema = z
  .object({
    type: z.enum(["linear", "radial"]).optional(),
    stops: z.array(z.object({ offset: z.number(), color: z.string() })).optional(),
    angle: z.number().optional(),
  })
  .passthrough();
export type SlideGradientShape = z.infer<typeof slideGradientSchema>;

export const slideBackgroundSchema = z
  .object({
    type: z.enum(["solid", "gradient", "image", "dots", "stripes", "grid"]),
    color: z.string().optional(),
    gradient: slideGradientSchema.optional(),
    imageUrl: z.string().optional(),
    patternColor: z.string().optional(),
    patternGap: z.number().optional(),
    patternSize: z.number().optional(),
  })
  .passthrough();
export type SlideBackgroundShape = z.infer<typeof slideBackgroundSchema>;

const slideElementBaseSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  x: z.number(),
  y: z.number(),
  rotation: z.number().optional(),
  opacity: z.number().optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
});

const slideTextElementSchema = slideElementBaseSchema
  .extend({
    type: z.literal("text"),
    text: z.string().optional(),
    fontSize: z.number().optional(),
    fontFamily: z.string().optional(),
    fontWeight: z.string().optional(),
    fontStyle: z.string().optional(),
    textDecoration: z.string().optional(),
    fill: z.union([z.string(), slideGradientSchema]).optional(),
    align: z.string().optional(),
    verticalAlign: z.string().optional(),
    lineHeight: z.number().optional(),
    letterSpacing: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    padding: z.number().optional(),
  })
  .passthrough();

const slideImageElementSchema = slideElementBaseSchema
  .extend({
    type: z.literal("image"),
    src: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    cornerRadius: z.number().optional(),
    fill: z.union([z.string(), slideGradientSchema]).optional(),
  })
  .passthrough();

const slideRectElementSchema = slideElementBaseSchema
  .extend({
    type: z.literal("rect"),
    width: z.number().optional(),
    height: z.number().optional(),
    fill: z.union([z.string(), slideGradientSchema]).optional(),
    cornerRadius: z.number().optional(),
    stroke: z.string().optional(),
    strokeWidth: z.number().optional(),
  })
  .passthrough();

const slideCircleElementSchema = slideElementBaseSchema
  .extend({
    type: z.literal("circle"),
    radius: z.number().optional(),
    fill: z.union([z.string(), slideGradientSchema]).optional(),
  })
  .passthrough();

const slideLineElementSchema = slideElementBaseSchema
  .extend({
    type: z.literal("line"),
    points: z.array(z.number()).optional(),
    stroke: z.string().optional(),
    strokeWidth: z.number().optional(),
  })
  .passthrough();

const slideArrowElementSchema = slideElementBaseSchema
  .extend({
    type: z.literal("arrow"),
    points: z.array(z.number()).optional(),
    stroke: z.string().optional(),
    strokeWidth: z.number().optional(),
    pointerLength: z.number().optional(),
    pointerWidth: z.number().optional(),
    pointerAtBeginning: z.boolean().optional(),
    tension: z.number().optional(),
    dash: z.array(z.number()).optional(),
  })
  .passthrough();

// Recursive element union: groups can nest any element (including groups).
// Declared as an explicit type so the self-referential schemas below avoid
// TS7022/7024 (implicit `any` from circular initializer inference).
type SlideGroupShape = Omit<z.infer<typeof slideElementBaseSchema>, "type"> & {
  type: "group";
  children?: Array<
    | z.infer<typeof slideTextElementSchema>
    | z.infer<typeof slideImageElementSchema>
    | z.infer<typeof slideRectElementSchema>
    | z.infer<typeof slideCircleElementSchema>
    | z.infer<typeof slideLineElementSchema>
    | z.infer<typeof slideArrowElementSchema>
    | SlideGroupShape
  >;
} & { [key: string]: unknown };

const slideGroupElementSchema: z.ZodType<SlideGroupShape> = slideElementBaseSchema
  .extend({
    type: z.literal("group"),
    children: z.lazy(() => slideElementSchema.array().optional()),
  })
  .passthrough();

export const slideElementSchema = z.union([
  slideTextElementSchema,
  slideImageElementSchema,
  slideRectElementSchema,
  slideCircleElementSchema,
  slideLineElementSchema,
  slideArrowElementSchema,
  slideGroupElementSchema,
]);
export type SlideElementShape = z.infer<typeof slideElementSchema>;

export const slideDocumentSchema = z
  .object({
    version: z.literal(1).optional(),
    width: z.number().positive(),
    height: z.number().positive(),
    background: slideBackgroundSchema.optional(),
    elements: z.array(slideElementSchema).optional(),
  })
  .passthrough();
export type SlideDocumentShape = z.infer<typeof slideDocumentSchema>;
