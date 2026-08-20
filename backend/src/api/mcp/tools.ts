/**
 * MCP tool registry — the product surface exposed to ChatGPT / any MCP
 * client over /api/v1/mcp.
 *
 * Each tool is a THIN wrapper over an existing application service
 * (services/writer.ts, services/carousels.ts, services/content.ts,
 * services/approval.ts, services/projects.ts). No agent internals are
 * exposed or duplicated:
 * hiai-kit is reached only through the existing adapters, LLM paths only
 * through the existing writer service, and tenant scope comes exclusively
 * from the machine principal's context (`ctx.tenantId`).
 *
 * Authorization model:
 *   - `requiredScope` gates the tool (fine-grained capability check against
 *     the key's scopes; admin-JWT principals pass all).
 *   - RBAC floors (editor/admin) are enforced via `ctx.tenantRole`, which
 *     tenantGuard derives from the key's scopes — the SAME RBAC context the
 *     Writer/Carousel HTTP routes consume.
 *
 * `inputSchema` is JSON Schema (draft-07) mirroring the service-level zod
 * contracts so MCP clients can validate before dispatch; the services still
 * runtime-validate on every call.
 */
import { z } from "zod";
import {
  CAROUSEL_PRESETS,
  type CarouselJob,
  type CreateCarouselResult,
  type RegenerateSlideResult,
} from "../../integrations/hiai-kit/index.js";
import { approveContent, requestChanges, submitForReview } from "../../services/approval.js";
import {
  createCarousel,
  getCarousel,
  regenerateCarousel,
  regenerateSlide,
} from "../../services/carousels.js";
import { getContentItem, listContentItems } from "../../services/content.js";
import { getProjectContext, listProjects } from "../../services/projects.js";
import type { ServiceContext } from "../../services/types.js";
import { generateWriterContent, rewriteWriterContent } from "../../services/writer.js";

/** JSON Schema (draft-07) for a tool's input object. */
export interface ToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  /** Runtime zod validation applied to `arguments` before dispatch. */
  argsSchema: ArgsValidator;
  /** Fine-grained scope required to invoke this tool. */
  requiredScope: string;
  /** Executes the tool against the existing application services. */
  run(ctx: ServiceContext, args: Record<string, unknown>): Promise<unknown>;
}

/** Structural subset of zod's ZodType so the registry needs no zod types. */
export interface ArgsValidator {
  safeParse(data: unknown): {
    success: boolean;
    data?: unknown;
    error?: { flatten: () => unknown };
  };
}

const uuid = { type: "string", format: "uuid" } as const;

const uuidOpt = { ...uuid, title: "Optional" } as const;

const contentListStatus = {
  type: "string",
  enum: ["draft", "in_review", "approved", "changes_requested"],
} as const;

const contentStatusZod = z.enum(["draft", "in_review", "approved", "changes_requested"]);
const idZod = z.string().uuid();

export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: "writer_generate",
    description:
      "Generate a new AI content item (article via the hiai-kit content.article capability, or a social_post via the local writer) and persist it with its initial revision. Returns the created item, the initial revision, the backend label and a correlation id.",
    requiredScope: "writer:generate",
    argsSchema: z.object({
      projectId: idZod.optional(),
      brandId: idZod.optional(),
      contentType: z.enum(["social_post", "article"]),
      topic: z.string().min(1).max(500),
      language: z.string().min(2).max(10).optional(),
      tone: z.string().max(100).optional(),
      instruction: z.string().max(2000).optional(),
      context: z.string().max(5000).optional(),
    }),
    inputSchema: {
      type: "object",
      properties: {
        projectId: uuidOpt,
        brandId: uuidOpt,
        contentType: { type: "string", enum: ["social_post", "article"] },
        topic: { type: "string", minLength: 1, maxLength: 500 },
        language: { type: "string", minLength: 2, maxLength: 10, default: "en" },
        tone: { type: "string", maxLength: 100 },
        instruction: { type: "string", maxLength: 2000 },
        context: { type: "string", maxLength: 5000 },
      },
      required: ["contentType", "topic"],
      additionalProperties: false,
    },
    run: (ctx, args) => generateWriterContent(ctx, args, { source: "chatgpt" }),
  },
  {
    name: "writer_rewrite",
    description:
      "Rewrite an existing content item: regenerates the copy via the content backend and appends a NEW revision (history is preserved, never rewritten). Returns the updated item, the appended revision, the backend label and a correlation id.",
    requiredScope: "writer:rewrite",
    argsSchema: z.object({
      contentItemId: idZod,
      topic: z.string().min(1).max(500).optional(),
      instruction: z.string().min(1).max(2000),
      language: z.string().min(2).max(10).optional(),
      tone: z.string().max(100).optional(),
      context: z.string().max(5000).optional(),
    }),
    inputSchema: {
      type: "object",
      properties: {
        contentItemId: uuid,
        topic: { type: "string", minLength: 1, maxLength: 500 },
        instruction: { type: "string", minLength: 1, maxLength: 2000 },
        language: { type: "string", minLength: 2, maxLength: 10, default: "en" },
        tone: { type: "string", maxLength: 100 },
        context: { type: "string", maxLength: 5000 },
      },
      required: ["contentItemId", "instruction"],
      additionalProperties: false,
    },
    run: (ctx, args) => rewriteWriterContent(ctx, args),
  },
  {
    name: "carousel_generate",
    description:
      "Create a carousel: dispatch a hiai-kit carousel job from a title, per-slide copy and design preset, and persist a content item with the job reference and an initial revision. Returns the persisted item and the hiai-kit job id/slug.",
    requiredScope: "carousel:generate",
    argsSchema: z.object({
      carouselTitle: z.string().min(1).max(500),
      slides: z
        .array(
          z.object({
            title: z.string().max(500),
            content: z.string().max(5000),
          })
        )
        .min(1)
        .max(10),
      designPreset: z.enum(CAROUSEL_PRESETS),
      slideWidth: z.number().int().positive().optional(),
      slideHeight: z.number().int().positive().optional(),
      styleDescription: z.string().max(2000).optional(),
      handle: z.string().max(200).optional(),
      ctaText: z.string().max(200).optional(),
    }),
    inputSchema: {
      type: "object",
      properties: {
        carouselTitle: { type: "string", minLength: 1, maxLength: 500 },
        slides: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              title: { type: "string", maxLength: 500 },
              content: { type: "string", maxLength: 5000 },
            },
            required: ["title", "content"],
            additionalProperties: false,
          },
        },
        designPreset: { type: "string", enum: [...CAROUSEL_PRESETS] },
        slideWidth: { type: "integer", minimum: 1 },
        slideHeight: { type: "integer", minimum: 1 },
        styleDescription: { type: "string", maxLength: 2000 },
        handle: { type: "string", maxLength: 200 },
        ctaText: { type: "string", maxLength: 200 },
      },
      required: ["carouselTitle", "slides", "designPreset"],
      additionalProperties: false,
    },
    run: (ctx, args) => createCarousel(ctx, args, { source: "chatgpt" }),
  },
  {
    name: "carousel_get",
    description:
      "Fetch a persisted carousel content item (includes the persisted bodyJson with the actual slide data, job id, slug and lifecycle status).",
    requiredScope: "carousel:read",
    argsSchema: z.object({ id: idZod }),
    inputSchema: {
      type: "object",
      properties: { id: uuid },
      required: ["id"],
      additionalProperties: false,
    },
    run: (ctx, args) => getCarousel(ctx, String(args.id)),
  },
  {
    name: "carousel_regenerate",
    description:
      "Regenerate a persisted carousel: apply an optional partial re-definition (edited copy / new design preset), dispatch a NEW hiai-kit job, and append a new revision — history is preserved, never rewritten. Returns the updated item, the appended revision and the new job id/slug.",
    requiredScope: "carousel:regenerate",
    argsSchema: z.object({
      id: idZod,
      carouselTitle: z.string().min(1).max(500).optional(),
      slides: z
        .array(
          z.object({
            title: z.string().max(500),
            content: z.string().max(5000),
          })
        )
        .min(1)
        .max(10)
        .optional(),
      designPreset: z.enum(CAROUSEL_PRESETS).optional(),
      slideWidth: z.number().int().positive().optional(),
      slideHeight: z.number().int().positive().optional(),
      styleDescription: z.string().max(2000).optional(),
      handle: z.string().max(200).optional(),
      ctaText: z.string().max(200).optional(),
    }),
    inputSchema: {
      type: "object",
      properties: {
        id: uuid,
        carouselTitle: { type: "string", minLength: 1, maxLength: 500 },
        slides: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              title: { type: "string", maxLength: 500 },
              content: { type: "string", maxLength: 5000 },
            },
            required: ["title", "content"],
            additionalProperties: false,
          },
        },
        designPreset: { type: "string", enum: [...CAROUSEL_PRESETS] },
        slideWidth: { type: "integer", minimum: 1 },
        slideHeight: { type: "integer", minimum: 1 },
        styleDescription: { type: "string", maxLength: 2000 },
        handle: { type: "string", maxLength: 200 },
        ctaText: { type: "string", maxLength: 200 },
      },
      required: ["id"],
      additionalProperties: false,
    },
    run: (ctx, args) => {
      const { id, ...patch } = args;
      return regenerateCarousel(ctx, String(id), patch);
    },
  },
  {
    name: "carousel_regenerate_slide",
    description:
      "Regenerate a single slide of a persisted carousel: calls hiai-kit with the job id and 1-based slide index, persists the ACTUAL regenerated slide document, and appends a new revision. Returns the updated item, revision and the regenerated slide.",
    requiredScope: "carousel:regenerate",
    argsSchema: z.object({
      id: idZod,
      index: z.number().int().min(1).max(10),
      description: z.string().max(2000).optional(),
    }),
    inputSchema: {
      type: "object",
      properties: {
        id: uuid,
        index: { type: "integer", minimum: 1, maximum: 10 },
        description: { type: "string", maxLength: 2000 },
      },
      required: ["id", "index"],
      additionalProperties: false,
    },
    run: (ctx, args) =>
      regenerateSlide(ctx, String(args.id), args.index, args.description ?? undefined),
  },
  {
    name: "carousel_submit_review",
    description:
      "Submit a persisted carousel for review (draft | changes_requested → in_review). The id must reference a carousel content item; other items are not found. Requires a key with the content:submit_review scope.",
    requiredScope: "content:submit_review",
    argsSchema: z.object({ id: idZod }),
    inputSchema: {
      type: "object",
      properties: { id: uuid },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (ctx, args) => {
      await getCarousel(ctx, String(args.id));
      return submitForReview(ctx, String(args.id));
    },
  },
  {
    name: "carousel_request_changes",
    description:
      "Request changes on a persisted carousel that is in review (in_review → changes_requested) with a reviewer note. The id must reference a carousel content item. Requires a key with the content:request_changes scope.",
    requiredScope: "content:request_changes",
    argsSchema: z.object({ id: idZod, note: z.string().min(1).max(2000) }),
    inputSchema: {
      type: "object",
      properties: {
        id: uuid,
        note: { type: "string", minLength: 1, maxLength: 2000 },
      },
      required: ["id", "note"],
      additionalProperties: false,
    },
    run: async (ctx, args) => {
      await getCarousel(ctx, String(args.id));
      return requestChanges(ctx, String(args.id), args.note);
    },
  },
  {
    name: "carousel_approve",
    description:
      "Approve a persisted carousel that is in review (in_review → approved, terminal). The id must reference a carousel content item. Requires a key with the content:approve scope.",
    requiredScope: "content:approve",
    argsSchema: z.object({ id: idZod }),
    inputSchema: {
      type: "object",
      properties: { id: uuid },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (ctx, args) => {
      await getCarousel(ctx, String(args.id));
      return approveContent(ctx, String(args.id));
    },
  },
  {
    name: "content_get",
    description: "Fetch a content item by id (tenant-scoped; other tenants' items are not found).",
    requiredScope: "content:read",
    argsSchema: z.object({ id: idZod }),
    inputSchema: {
      type: "object",
      properties: { id: uuid },
      required: ["id"],
      additionalProperties: false,
    },
    run: (ctx, args) => getContentItem(ctx, String(args.id)),
  },
  {
    name: "content_list",
    description:
      "List content items in the tenant with pagination and optional status / project / brand filters.",
    requiredScope: "content:read",
    argsSchema: z.object({
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      status: contentStatusZod.optional(),
      projectId: idZod.optional(),
      brandId: idZod.optional(),
    }),
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "integer", minimum: 1, default: 1 },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        status: contentListStatus,
        projectId: uuidOpt,
        brandId: uuidOpt,
      },
      additionalProperties: false,
    },
    run: async (ctx, args) => {
      const result = await listContentItems(ctx, {
        page: args.page === undefined ? 1 : Number(args.page),
        limit: args.limit === undefined ? 20 : Number(args.limit),
        status:
          (args.status as "draft" | "in_review" | "approved" | "changes_requested") ?? undefined,
        projectId: args.projectId === undefined ? undefined : String(args.projectId),
        brandId: args.brandId === undefined ? undefined : String(args.brandId),
      });
      return { items: result.data, pagination: result.pagination };
    },
  },
  {
    name: "content_submit_review",
    description:
      "Submit a content item for review (draft | changes_requested → in_review). Requires a key with the content:submit_review scope.",
    requiredScope: "content:submit_review",
    argsSchema: z.object({ id: idZod }),
    inputSchema: {
      type: "object",
      properties: { id: uuid },
      required: ["id"],
      additionalProperties: false,
    },
    run: (ctx, args) => submitForReview(ctx, String(args.id)),
  },
  {
    name: "content_request_changes",
    description:
      "Request changes on a content item that is in review (in_review → changes_requested) with a reviewer note. Requires a key with the content:request_changes scope.",
    requiredScope: "content:request_changes",
    argsSchema: z.object({ id: idZod, note: z.string().min(1).max(2000) }),
    inputSchema: {
      type: "object",
      properties: {
        id: uuid,
        note: { type: "string", minLength: 1, maxLength: 2000 },
      },
      required: ["id", "note"],
      additionalProperties: false,
    },
    run: (ctx, args) => requestChanges(ctx, String(args.id), args.note),
  },
  {
    name: "content_approve",
    description:
      "Approve a content item that is in review (in_review → approved, terminal). Requires a key with the content:approve scope.",
    requiredScope: "content:approve",
    argsSchema: z.object({ id: idZod }),
    inputSchema: {
      type: "object",
      properties: { id: uuid },
      required: ["id"],
      additionalProperties: false,
    },
    run: (ctx, args) => approveContent(ctx, String(args.id)),
  },
  {
    name: "project_list",
    description:
      "List the tenant's projects (paginated) so a client can resolve the projectId/brandId used by writer_generate / carousel_generate. Requires a key with the content:read scope.",
    requiredScope: "content:read",
    argsSchema: z.object({
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "integer", minimum: 1, default: 1 },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
    run: async (ctx, args) => {
      const result = await listProjects(ctx, {
        page: args.page === undefined ? 1 : Number(args.page),
        limit: args.limit === undefined ? 20 : Number(args.limit),
      });
      return { items: result.data, pagination: result.pagination };
    },
  },
  {
    name: "project_get",
    description:
      "Fetch a project with its brands and a content summary (tenant-scoped; other tenants' projects are not found). Use it to resolve the brandId passed to writer_generate / carousel_generate.",
    requiredScope: "content:read",
    argsSchema: z.object({ id: idZod }),
    inputSchema: {
      type: "object",
      properties: { id: uuid },
      required: ["id"],
      additionalProperties: false,
    },
    run: (ctx, args) => getProjectContext(ctx, String(args.id)),
  },
];

export function findTool(name: string): McpTool | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name);
}

// Re-exported types so the route layer can reference hiai-kit shapes without
// re-importing them (keeps the adapter boundary centralized).
export type { CarouselJob, CreateCarouselResult, RegenerateSlideResult };
