/**
 * Canonical OpenAPI 3.0 spec for the hiai-post API.
 *
 * Documents ONLY routes that actually exist in the production composition
 * (backend/src/api/app.ts). Served at GET /api/v1/openapi.json and referenced
 * by the ChatGPT plugin manifest (/.well-known/ai-plugin.json).
 *
 * Auth model:
 *   - `sessionBearer` — Better Auth session token (`Authorization: Bearer
 *     <session>` + `X-Tenant-Id` header; membership validated).
 *   - `adminJwt` — HS256 machine token minted by hiai-admin
 *     (`HIAI_ADMIN_JWT_SECRET`; tenant from verified claims).
 *   - `machineApiKey` — `hpk_<secret>` machine credential resolved by hash to
 *     a tenant-scoped api_keys row (scopes gate the MCP tools).
 */
import type { CreateCarouselResult } from "../integrations/hiai-kit/index.js";

export const openApiSpec = {
  openapi: "3.0.0",
  info: {
    title: "hiai-post API",
    version: "1.0.0",
    description:
      "Social media content planning and publishing platform API. Machine clients (MCP / ChatGPT) authenticate with `hpk_<key>` bearer credentials managed under /api/v1/api-keys.",
  },
  servers: [{ url: "http://localhost:50300", description: "Development" }],
  tags: [
    { name: "System" },
    { name: "API Keys" },
    { name: "Writer" },
    { name: "Carousels" },
    { name: "Content" },
    { name: "Projects" },
    { name: "Revisions" },
    { name: "Approval" },
    { name: "MCP" },
    { name: "Accounts" },
    { name: "Posts" },
    { name: "Content Plans" },
    { name: "Campaigns" },
    { name: "Templates" },
    { name: "Analytics" },
    { name: "Queue" },
    { name: "OAuth" },
    { name: "Events" },
  ],
  paths: {
    "/api/v1/health": {
      get: {
        summary: "Health check",
        tags: ["System"],
        responses: { "200": { description: "OK" } },
      },
    },
    // ── API keys (admin-only machine credential management) ─────────────
    "/api/v1/api-keys": {
      get: {
        summary: "List API keys (prefix + metadata only; hash and key are never exposed)",
        tags: ["API Keys"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }],
        responses: {
          "200": {
            description: "API key list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/ApiKeyListItem" },
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
      post: {
        summary: "Create an API key — returns the FULL key exactly once",
        tags: ["API Keys"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateApiKeyInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "Created — full credential returned once",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    key: { type: "string", example: "hpk_ab12cd34…" },
                    apiKey: { $ref: "#/components/schemas/ApiKeyListItem" },
                  },
                  required: ["key", "apiKey"],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/api/v1/api-keys/{id}/revoke": {
      post: {
        summary: "Revoke an API key (tombstone; row + hash history retained)",
        tags: ["API Keys"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        responses: {
          "200": {
            description: "Revoked",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { apiKey: { $ref: "#/components/schemas/ApiKeyListItem" } },
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    // ── Writer ──────────────────────────────────────────────────────────
    "/api/v1/writer/generate": {
      post: {
        summary: "Generate a new content item (+ revision #1) from a topic/instruction",
        tags: ["Writer"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  projectId: { type: "string", format: "uuid" },
                  brandId: { type: "string", format: "uuid" },
                  contentType: { type: "string", enum: ["social_post", "article"] },
                  topic: { type: "string", minLength: 1, maxLength: 500 },
                  language: { type: "string", default: "en" },
                  tone: { type: "string" },
                  instruction: { type: "string" },
                  context: { type: "string" },
                },
                required: ["contentType", "topic"],
              },
            },
          },
        },
        responses: {
          "201": { description: "Generated content item + initial revision" },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "502": { description: "Generation backend failed (hiai-kit capability)" },
        },
      },
    },
    "/api/v1/writer/rewrite": {
      post: {
        summary: "Rewrite an existing item — appends a NEW revision (history preserved)",
        tags: ["Writer"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  contentItemId: { type: "string", format: "uuid" },
                  topic: { type: "string" },
                  instruction: { type: "string", minLength: 1, maxLength: 2000 },
                  language: { type: "string", default: "en" },
                  tone: { type: "string" },
                  context: { type: "string" },
                },
                required: ["contentItemId", "instruction"],
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated item + appended revision" },
          "400": { $ref: "#/components/responses/ValidationError" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    // ── Carousels ───────────────────────────────────────────────────────
    "/api/v1/carousels": {
      get: {
        summary: 'List carousels (content items persisted as { kind: "carousel" })',
        tags: ["Carousels"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [
          { $ref: "#/components/parameters/PageParam" },
          { $ref: "#/components/parameters/LimitParam" },
        ],
        responses: { "200": { description: "Paginated carousel list" } },
      },
      post: {
        summary: "Create a carousel (dispatches a hiai-kit job + revision #1)",
        tags: ["Carousels"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateCarouselInput" },
            },
          },
        },
        responses: {
          "201": { description: "Created carousel + job" },
          "400": { $ref: "#/components/responses/ValidationError" },
          "502": { description: "hiai-kit job dispatch failed" },
        },
      },
    },
    "/api/v1/carousels/{id}": {
      get: {
        summary: "Get a carousel (includes persisted bodyJson with slide data)",
        tags: ["Carousels"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        responses: {
          "200": { description: "Carousel item" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/v1/carousels/{id}/revisions": {
      get: {
        summary: "Carousel revision history (immutable append-only)",
        tags: ["Carousels", "Revisions"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        responses: { "200": { description: "Revision list" } },
      },
    },
    "/api/v1/carousels/{id}/job": {
      get: {
        summary: "Live hiai-kit job status",
        tags: ["Carousels"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        responses: { "200": { description: "Carousel job" } },
      },
    },
    "/api/v1/carousels/{id}/slides/{index}/json": {
      get: {
        summary: "Actual generated slide document (1-based index)",
        tags: ["Carousels"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [
          { $ref: "#/components/parameters/IdParam" },
          {
            name: "index",
            in: "path",
            required: true,
            schema: { type: "integer", minimum: 1, maximum: 10 },
          },
        ],
        responses: { "200": { description: "Slide document" } },
      },
      put: {
        summary:
          "Save a slide's actual hiai-kit document (validated shape; replaces only the selected slide's doc and appends an immutable revision)",
        description:
          "The request body IS the hiai-kit slide document (`{ version, width, height, background?, elements? }`). Invalid documents/indexes → 400 and nothing is persisted (no fake success). Returns the normalized current content (`item`) + appended revision + saved slide.",
        tags: ["Carousels"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [
          { $ref: "#/components/parameters/IdParam" },
          {
            name: "index",
            in: "path",
            required: true,
            schema: { type: "integer", minimum: 1, maximum: 10 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["width", "height"],
                properties: {
                  version: { type: "integer", enum: [1] },
                  width: { type: "number", exclusiveMinimum: 0 },
                  height: { type: "number", exclusiveMinimum: 0 },
                  background: {
                    type: "object",
                    properties: {
                      type: {
                        type: "string",
                        enum: ["solid", "gradient", "image", "dots", "stripes", "grid"],
                      },
                      color: { type: "string" },
                      imageUrl: { type: "string" },
                    },
                  },
                  elements: {
                    type: "array",
                    description:
                      "hiai-kit slide elements (text/image/rect/circle/line/arrow/group); each requires id, type, x, y",
                    items: {
                      type: "object",
                      required: ["id", "type", "x", "y"],
                      properties: {
                        id: { type: "string" },
                        type: {
                          type: "string",
                          enum: ["text", "image", "rect", "circle", "line", "arrow", "group"],
                        },
                        x: { type: "number" },
                        y: { type: "number" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated item (normalized current content) + revision + slide",
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/v1/carousels/{id}/regenerate": {
      post: {
        summary: "Regenerate a full carousel (optional partial re-definition; appends a revision)",
        tags: ["Carousels"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        responses: { "200": { description: "Regenerated carousel + revision + job" } },
      },
    },
    "/api/v1/carousels/{id}/slides/{index}/regenerate": {
      post: {
        summary:
          "Regenerate a single slide (persists the actual slide document; appends a revision)",
        tags: ["Carousels"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [
          { $ref: "#/components/parameters/IdParam" },
          {
            name: "index",
            in: "path",
            required: true,
            schema: { type: "integer", minimum: 1, maximum: 10 },
          },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { description: { type: "string", maxLength: 2000 } },
              },
            },
          },
        },
        responses: { "200": { description: "Updated item + revision + slide" } },
      },
    },
    "/api/v1/carousels/{id}/submit-review": {
      post: {
        summary: "Submit carousel for review (draft | changes_requested → in_review)",
        tags: ["Carousels", "Approval"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        responses: { "200": { description: "Updated item" } },
      },
    },
    "/api/v1/carousels/{id}/request-changes": {
      post: {
        summary: "Request changes (in_review → changes_requested, with reviewer note)",
        tags: ["Carousels", "Approval"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { note: { type: "string", minLength: 1, maxLength: 2000 } },
              },
            },
          },
        },
        responses: { "200": { description: "Updated item" } },
      },
    },
    "/api/v1/carousels/{id}/approve": {
      post: {
        summary: "Approve carousel (in_review → approved, terminal; admin+)",
        tags: ["Carousels", "Approval"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        responses: { "200": { description: "Updated item" } },
      },
    },
    // ── Content ─────────────────────────────────────────────────────────
    "/api/v1/content": {
      get: {
        summary: "List content items (status / projectId / brandId filters)",
        tags: ["Content"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [
          { $ref: "#/components/parameters/PageParam" },
          { $ref: "#/components/parameters/LimitParam" },
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: ["draft", "in_review", "approved", "changes_requested"],
            },
          },
          { name: "projectId", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "brandId", in: "query", schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "Paginated content list" } },
      },
      post: {
        summary:
          "Create a content item (always snapshots revision #1; `source` is server-derived from the acting principal, never client input)",
        tags: ["Content"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  projectId: { type: "string", format: "uuid" },
                  brandId: { type: "string", format: "uuid" },
                  title: { type: "string", minLength: 1, maxLength: 500 },
                  bodyText: { type: "string", maxLength: 50000 },
                  bodyJson: {},
                  source: {
                    type: "string",
                    enum: ["web", "api", "chatgpt", "automation", "webhook", "import"],
                    description:
                      "Read-only provenance hint. Derived from the acting principal (session → web, machine → api, MCP → chatgpt); a client-provided value is ignored.",
                  },
                },
                required: ["title"],
              },
            },
          },
        },
        responses: {
          "201": {
            description:
              "Created content item, including `source` and `currentRevisionNumber` (always 1 at creation)",
          },
        },
      },
    },
    "/api/v1/content/{id}": {
      get: {
        summary:
          "Get a content item (tenant-scoped; cross-tenant = 404). Includes `source` and the `currentRevisionNumber` pointer.",
        tags: ["Content"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        responses: {
          "200": { description: "Content item" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/v1/content/{id}/revisions": {
      get: {
        summary: "List revisions (immutable append-only history)",
        tags: ["Content", "Revisions"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        responses: { "200": { description: "Revision list" } },
      },
      post: {
        summary: "Create a revision (snapshot of the item's current state)",
        tags: ["Content", "Revisions"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        responses: { "201": { description: "Created revision" } },
      },
    },
    "/api/v1/content/{id}/revisions/{revisionId}/restore": {
      post: {
        summary: "Restore a revision (copies snapshot + appends a new revision; history preserved)",
        tags: ["Content", "Revisions"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [
          { $ref: "#/components/parameters/IdParam" },
          {
            name: "revisionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": { description: "Restored item + new revision" } },
      },
    },
    "/api/v1/content/{id}/submit-review": {
      post: {
        summary: "Submit for review (draft | changes_requested → in_review)",
        tags: ["Content", "Approval"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        responses: { "200": { description: "Updated item" } },
      },
    },
    "/api/v1/content/{id}/request-changes": {
      post: {
        summary: "Request changes (in_review → changes_requested, with reviewer note)",
        tags: ["Content", "Approval"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { note: { type: "string", minLength: 1, maxLength: 2000 } },
              },
            },
          },
        },
        responses: { "200": { description: "Updated item" } },
      },
    },
    "/api/v1/content/{id}/approve": {
      post: {
        summary: "Approve content (in_review → approved, terminal; admin+)",
        tags: ["Content", "Approval"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        responses: { "200": { description: "Updated item" } },
      },
    },
    // ── Projects / Brands ───────────────────────────────────────────────
    "/api/v1/projects": {
      get: {
        summary: "List projects",
        tags: ["Projects"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        responses: { "200": { description: "Paginated project list" } },
      },
      post: {
        summary:
          "Create a project (brand context: language, audience, tone, guidelines, business context, references)",
        tags: ["Projects"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 200 },
                  description: { type: "string", maxLength: 2000 },
                  defaultLanguage: { type: "string", minLength: 2, maxLength: 10 },
                  targetAudience: { type: "string", maxLength: 2000 },
                  tone: { type: "string", maxLength: 500 },
                  contentGuidelines: { type: "string", maxLength: 5000 },
                  businessContext: { type: "string", maxLength: 5000 },
                  references: {
                    type: "array",
                    maxItems: 20,
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string", maxLength: 50 },
                        url: { type: "string", format: "uri", maxLength: 2000 },
                        title: { type: "string", maxLength: 200 },
                        description: { type: "string", maxLength: 500 },
                      },
                    },
                  },
                  status: { type: "string", enum: ["active", "archived"] },
                  settings: { type: "object" },
                },
                required: ["name"],
              },
            },
          },
        },
        responses: { "201": { description: "Created project" } },
      },
    },
    "/api/v1/projects/{id}": {
      get: {
        summary: "Get a project",
        tags: ["Projects"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        responses: {
          "200": { description: "Project" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      put: {
        summary: "Update a project",
        tags: ["Projects"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        responses: { "200": { description: "Updated project" } },
      },
      delete: {
        summary: "Delete a project",
        tags: ["Projects"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        responses: { "200": { description: "Deleted" } },
      },
    },
    "/api/v1/projects/{id}/context": {
      get: {
        summary: "Project context: project + brands + content summary",
        tags: ["Projects"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        responses: { "200": { description: "Project context" } },
      },
    },
    "/api/v1/projects/{id}/brands": {
      get: {
        summary: "List brands (scoped to the project)",
        tags: ["Projects"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        responses: { "200": { description: "Paginated brand list" } },
      },
      post: {
        summary: "Create a brand (projectId is the path param, never the body)",
        tags: ["Projects"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [{ $ref: "#/components/parameters/IdParam" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 200 },
                  description: { type: "string", maxLength: 2000 },
                  voice: { type: "string", maxLength: 500 },
                  defaultLanguage: { type: "string", minLength: 2, maxLength: 10 },
                  targetAudience: { type: "string", maxLength: 2000 },
                  contentGuidelines: { type: "string", maxLength: 5000 },
                  businessContext: { type: "string", maxLength: 5000 },
                  references: {
                    type: "array",
                    maxItems: 20,
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string", maxLength: 50 },
                        url: { type: "string", format: "uri", maxLength: 2000 },
                        title: { type: "string", maxLength: 200 },
                        description: { type: "string", maxLength: 500 },
                      },
                    },
                  },
                  avatarUrl: { type: "string", format: "uri", maxLength: 2000 },
                  settings: { type: "object" },
                },
                required: ["name"],
              },
            },
          },
        },
        responses: { "201": { description: "Created brand" } },
      },
    },
    "/api/v1/projects/{id}/brands/{brandId}": {
      get: {
        summary: "Get a brand",
        tags: ["Projects"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [
          { $ref: "#/components/parameters/IdParam" },
          {
            name: "brandId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": { description: "Brand" } },
      },
      put: {
        summary: "Update a brand",
        tags: ["Projects"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [
          { $ref: "#/components/parameters/IdParam" },
          {
            name: "brandId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": { description: "Updated brand" } },
      },
      delete: {
        summary: "Delete a brand",
        tags: ["Projects"],
        security: [{ sessionBearer: [] }, { adminJwt: [] }, { machineApiKey: [] }],
        parameters: [
          { $ref: "#/components/parameters/IdParam" },
          {
            name: "brandId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": { description: "Deleted" } },
      },
    },
    // ── MCP ─────────────────────────────────────────────────────────────
    "/api/v1/mcp": {
      post: {
        summary:
          "MCP JSON-RPC 2.0 endpoint (initialize / tools/list / tools/call) — requires a machine credential (hpk_ API key or admin JWT)",
        tags: ["MCP"],
        security: [{ machineApiKey: [] }, { adminJwt: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  jsonrpc: { type: "string", const: "2.0" },
                  id: { oneOf: [{ type: "string" }, { type: "integer" }] },
                  method: { type: "string", enum: ["initialize", "tools/list", "tools/call"] },
                  params: { type: "object" },
                },
                required: ["jsonrpc", "method"],
              },
            },
          },
        },
        responses: {
          "200": { description: "JSON-RPC result or error envelope" },
          "202": { description: "Notification acknowledged (empty body)" },
          "401": {
            description: "Machine credential required (MACHINE_AUTH_REQUIRED) or invalid",
          },
        },
      },
    },
    // ── Legacy product routes (unchanged, documented as-is) ─────────────
    "/api/v1/accounts": {
      get: { summary: "List connected social accounts", tags: ["Accounts"] },
      post: { summary: "Connect social account", tags: ["Accounts"] },
    },
    "/api/v1/accounts/{id}": {
      delete: { summary: "Disconnect account", tags: ["Accounts"] },
    },
    "/api/v1/posts": {
      get: {
        summary: "List posts",
        tags: ["Posts"],
        parameters: [
          { name: "status", in: "query" },
          { name: "platform", in: "query" },
          { name: "from", in: "query" },
          { name: "to", in: "query" },
        ],
      },
      post: { summary: "Create post", tags: ["Posts"] },
    },
    "/api/v1/posts/{id}": {
      get: { summary: "Get post", tags: ["Posts"] },
      put: { summary: "Update post", tags: ["Posts"] },
      delete: { summary: "Delete post", tags: ["Posts"] },
    },
    "/api/v1/posts/{id}/publish": { post: { summary: "Publish post now", tags: ["Posts"] } },
    "/api/v1/posts/{id}/schedule": { post: { summary: "Schedule post", tags: ["Posts"] } },
    "/api/v1/posts/generate": { post: { summary: "Generate content via AI", tags: ["Posts"] } },
    "/api/v1/posts/{id}/optimize": { post: { summary: "Optimize post copy", tags: ["Posts"] } },
    "/api/v1/content-plans": {
      get: { summary: "List content plans", tags: ["Content Plans"] },
      post: { summary: "Create content plan", tags: ["Content Plans"] },
    },
    "/api/v1/campaigns": {
      get: { summary: "List campaigns", tags: ["Campaigns"] },
      post: { summary: "Create campaign", tags: ["Campaigns"] },
    },
    "/api/v1/templates": {
      get: { summary: "List templates", tags: ["Templates"] },
      post: { summary: "Create template", tags: ["Templates"] },
    },
    "/api/v1/templates/{id}/generate": {
      post: { summary: "Generate post from template", tags: ["Templates"] },
    },
    "/api/v1/analytics/overview": {
      get: { summary: "Analytics overview", tags: ["Analytics"] },
    },
    "/api/v1/analytics/posts/{id}": {
      get: { summary: "Post engagement metrics", tags: ["Analytics"] },
    },
    "/api/v1/analytics/best-times": {
      get: { summary: "Best posting times", tags: ["Analytics"] },
    },
    "/api/v1/queue/status": { get: { summary: "Queue status", tags: ["Queue"] } },
    "/api/v1/queue/dead-letter": { get: { summary: "Dead letter queue", tags: ["Queue"] } },
    "/api/v1/oauth/{platform}/connect": {
      post: {
        summary: "Start OAuth flow",
        tags: ["OAuth"],
        parameters: [{ name: "platform", in: "path", required: true }],
      },
    },
    "/api/v1/oauth/{platform}/callback": {
      get: { summary: "OAuth callback", tags: ["OAuth"] },
    },
    "/api/v1/events": {
      get: { summary: "SSE real-time events", tags: ["Events"] },
    },
  },
  components: {
    securitySchemes: {
      sessionBearer: {
        type: "http",
        scheme: "bearer",
        description: "Better Auth session token. Also send X-Tenant-Id with the target tenant id.",
      },
      adminJwt: {
        type: "http",
        scheme: "bearer",
        description:
          "HS256 admin JWT minted by hiai-admin (HIAI_ADMIN_JWT_SECRET); tenant from verified claims.",
      },
      machineApiKey: {
        type: "http",
        scheme: "bearer",
        description:
          "Machine credential `hpk_<secret>`, created under /api/v1/api-keys. Tenant comes from the key's own row — tenant headers are ignored.",
      },
    },
    parameters: {
      IdParam: {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      PageParam: { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
      LimitParam: {
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
    },
    responses: {
      Unauthorized: { description: "Missing or invalid credentials (401)" },
      Forbidden: { description: "Not a member / insufficient role (403)" },
      NotFound: { description: "Not found (404)" },
      ValidationError: { description: "Validation failed (400)" },
    },
    schemas: {
      ApiKeyListItem: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          prefix: { type: "string", example: "hpk_ab12cd34" },
          scopes: { type: "array", items: { type: "string" } },
          createdBy: { type: "string" },
          expiresAt: { type: "string", format: "date-time", nullable: true },
          lastUsedAt: { type: "string", format: "date-time", nullable: true },
          revokedAt: { type: "string", format: "date-time", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
        description: "Key metadata. The SHA-256 hash and the full key are never returned.",
      },
      CreateApiKeyInput: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          scopes: {
            type: "array",
            minItems: 1,
            maxItems: 16,
            items: {
              type: "string",
              enum: [
                "writer:generate",
                "writer:rewrite",
                "carousel:generate",
                "carousel:read",
                "carousel:regenerate",
                "content:read",
                "content:approve",
                "api-keys:admin",
                "*",
              ],
            },
          },
          expiresAt: { type: "string", format: "date-time" },
        },
        required: ["name", "scopes"],
      },
      CreateCarouselInput: {
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
            },
          },
          designPreset: {
            type: "string",
            enum: ["minimal", "bold", "gradient", "elegant", "playful", "corporate", "custom"],
          },
          slideWidth: { type: "integer", minimum: 1 },
          slideHeight: { type: "integer", minimum: 1 },
          styleDescription: { type: "string", maxLength: 2000 },
          handle: { type: "string", maxLength: 200 },
          ctaText: { type: "string", maxLength: 200 },
        },
        required: ["carouselTitle", "slides", "designPreset"],
      },
    },
  },
};

// Re-export the hiai-kit type so tool-level OpenAPI consumers can reference
// the same job shape (imported above for documentation symmetry).
export type { CreateCarouselResult };
