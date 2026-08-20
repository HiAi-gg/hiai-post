# hiai-post API Reference

Base URL: `http://localhost:50300` (development) / `https://your-domain.com` (production)

## Authentication

Two principal types are accepted:

**Interactive (session) principals** — the SvelteKit frontend / browser flows:
- `Authorization: Bearer <session_token>` header (Better Auth session)
- `X-Tenant-Id: <tenant_uuid>` header (except health)

**Machine principals** — automation, MCP and server-to-server flows:
- `Authorization: Bearer hpk_<api_key>` header (tenant-scoped API key, created via
  `POST /api/v1/api-keys`). The key's tenant is authoritative — an incoming
  `X-Tenant-Id` header is ignored for machine principals.
- `Authorization: Bearer <admin_jwt>` header (admin-minted HS256 JWT, when
  `HIAI_ADMIN_JWT_SECRET` is configured; tenant comes from the verified JWT claim).

`GET /api/v1/openapi.json` serves the canonical OpenAPI spec (real routes,
`securitySchemes`: `sessionBearer` / `adminJwt` / `machineApiKey`), and
`GET /.well-known/ai-plugin.json` serves the ChatGPT plugin manifest.

---

## Health

### GET /api/v1/health

Check API, database, and Redis connectivity.

**Auth:** None

**Response `200`:**
```json
{
  "status": "ok",
  "timestamp": "2026-06-14T10:00:00.000Z",
  "services": {
    "database": "connected",
    "redis": "connected"
  }
}
```

**Response `503` (degraded):**
```json
{
  "status": "degraded",
  "timestamp": "2026-06-14T10:00:00.000Z",
  "services": {
    "database": "disconnected",
    "redis": "connected"
  }
}
```

---

## Accounts

All account endpoints require `Authorization` and `X-Tenant-Id` headers.

### GET /api/v1/accounts

List connected social accounts for the current tenant.

**Query params:** None

**Response `200`:**
```json
{
  "accounts": [
    {
      "id": "uuid",
      "platform": "instagram",
      "accountId": "12345",
      "username": "mybrand",
      "displayName": "My Brand",
      "avatarUrl": "https://...",
      "status": "active",
      "connectedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

### GET /api/v1/accounts/:id

Get details for a single social account.

**Path params:** `id` (uuid) — account ID

**Response `200`:**
```json
{
  "account": {
    "id": "uuid",
    "platform": "instagram",
    "accountId": "12345",
    "username": "mybrand",
    "displayName": "My Brand",
    "avatarUrl": "https://...",
    "status": "active",
    "tokenExpiresAt": "2026-07-01T00:00:00.000Z",
    "scopes": ["instagram_basic", "instagram_content_publish"],
    "connectedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

**Response `404`:** `{ "error": "Account not found" }`

### DELETE /api/v1/accounts/:id

Disconnect (delete) a social account.

**Path params:** `id` (uuid) — account ID

**Response `200`:**
```json
{
  "success": true,
  "message": "Account disconnected"
}
```

**Response `404`:** `{ "error": "Account not found" }`

---

## Posts

### GET /api/v1/posts

List posts with pagination and filtering.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | int | 1 | Page number |
| `limit` | int | 20 | Items per page (max 100) |
| `sortBy` | string | `createdAt` | Sort field |
| `sortOrder` | `asc`/`desc` | `desc` | Sort direction |
| `status` | string | — | Filter by status (`draft`, `scheduled`, `publishing`, `published`, `failed`) |
| `platform` | string | — | Filter by platform |
| `search` | string | — | Search content text |

**Response `200`:**
```json
{
  "posts": [
    {
      "id": "uuid",
      "tenantId": "uuid",
      "socialAccountId": "uuid",
      "contentText": "Post content...",
      "contentJson": null,
      "mediaUrls": [],
      "platform": "instagram",
      "status": "draft",
      "scheduledAt": null,
      "publishedAt": null,
      "platformPostId": null,
      "errorMessage": null,
      "contentHash": "abc123def456",
      "createdAt": "2026-06-14T10:00:00.000Z",
      "updatedAt": "2026-06-14T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3
  }
}
```

### GET /api/v1/posts/:id

Get a single post.

**Path params:** `id` (uuid) — post ID

**Response `200`:** `{ "post": { ... } }`
**Response `404`:** `{ "error": "Post not found" }`

### POST /api/v1/posts

Create a new post.

**Request body:**
```json
{
  "socialAccountId": "uuid (optional)",
  "contentText": "Post content (required, 1-10000 chars)",
  "contentJson": "any (optional, rich text)",
  "mediaUrls": ["https://..."],
  "platform": "instagram (optional)",
  "scheduledAt": "2026-06-15T10:00:00.000Z (optional ISO datetime)"
}
```

**Response `201`:**
```json
{
  "post": { ... }
}
```

If `scheduledAt` is set, the post is also enqueued in the Redis publish queue.

### PUT /api/v1/posts/:id

Update an existing post. Cannot edit published posts.

**Path params:** `id` (uuid) — post ID

**Request body:** Same fields as create, all optional.

**Response `200`:** `{ "post": { ... } }`
**Response `404`:** `{ "error": "Post not found" }`
**Response `400`:** `{ "error": "Cannot edit published posts" }`

### DELETE /api/v1/posts/:id

Delete a post and remove it from the publish queue.

**Path params:** `id` (uuid) — post ID

**Response `200`:** `{ "success": true }`
**Response `404`:** `{ "error": "Post not found" }`

### POST /api/v1/posts/:id/schedule

Schedule a post for publishing at a specific time.

**Path params:** `id` (uuid) — post ID

**Request body:**
```json
{
  "scheduledAt": "2026-06-15T10:00:00.000Z (ISO datetime, required)"
}
```

**Response `200`:** `{ "post": { ... } }`
**Response `404`:** `{ "error": "Post not found" }`

### POST /api/v1/posts/:id/publish

Queue a post for immediate publishing.

**Path params:** `id` (uuid) — post ID

**Response `200`:**
```json
{
  "post": { ... },
  "message": "Post queued for immediate publishing"
}
```

**Response `404`:** `{ "error": "Post not found" }`
**Response `400`:** `{ "error": "Post already published" }`

### POST /api/v1/posts/generate

Generate content via AI Mastra workflow.

**Request body:**
```json
{
  "topic": "Summer sale promotion (required, 1-500 chars)",
  "language": "en (default, 2-5 chars)",
  "platforms": ["instagram", "tiktok", "x", "linkedin", "facebook", "telegram", "threads", "pinterest", "youtube"],
  "tone": "professional (default: professional|casual|humorous|inspirational)",
  "additionalContext": "Optional context (max 2000 chars)"
}
```

**Response `200`:**
```json
{
  "success": true,
  "posts": [ ... ],
  "count": 3
}
```

**Response `409`:** `{ "error": "Duplicate content detected", "message": "..." }`
**Response `500`:** `{ "error": "Content generation failed", "details": "..." }`

### POST /api/v1/posts/:id/optimize

Optimize a post's content for better engagement via AI.

**Path params:** `id` (uuid) — post ID

**Request body:**
```json
{
  "content": "Post content to optimize (required)",
  "platform": "instagram (required)"
}
```

**Response `200`:**
```json
{
  "id": "uuid",
  "optimizedContent": "Optimized content...",
  "hashtags": ["#sale", "#summer"],
  "improvements": ["Added engaging hook", "Optimized hashtag placement"]
}
```

**Response `400`:** `{ "error": "content and platform are required" }`

---

## Content Plans

### GET /api/v1/content-plans

List content plans with optional date range filtering.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | int | 1 | Page number |
| `limit` | int | 20 | Items per page |
| `from` | ISO datetime | — | Filter plans from this date |
| `to` | ISO datetime | — | Filter plans until this date |

**Response `200`:** `{ "plans": [...], "pagination": { ... } }`

### GET /api/v1/content-plans/:id

Get a single content plan.

**Path params:** `id` (uuid) — plan ID

**Response `200`:** `{ "plan": { ... } }`
**Response `404`:** `{ "error": "Content plan not found" }`

### POST /api/v1/content-plans

Create a content plan entry.

**Request body:**
```json
{
  "title": "Summer Sale Post (required, max 200 chars)",
  "description": "Optional description (max 1000 chars)",
  "date": "2026-06-20T00:00:00.000Z (ISO datetime, required)",
  "slotTime": "09:00 (optional HH:MM format)",
  "postId": "uuid (optional)",
  "campaignId": "uuid (optional)"
}
```

**Response `201`:** `{ "plan": { ... } }`

### PUT /api/v1/content-plans/:id

Update a content plan.

**Path params:** `id` (uuid) — plan ID

**Request body:** Same fields as create, all partial.

**Response `200`:** `{ "plan": { ... } }`
**Response `404`:** `{ "error": "Content plan not found" }`

### DELETE /api/v1/content-plans/:id

Delete a content plan.

**Path params:** `id` (uuid) — plan ID

**Response `200`:** `{ "success": true }`
**Response `404`:** `{ "error": "Content plan not found" }`

---

## Campaigns

### GET /api/v1/campaigns

List campaigns with pagination.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | int | 1 | Page number |
| `limit` | int | 20 | Items per page |

**Response `200`:** `{ "campaigns": [...], "pagination": { ... } }`

### GET /api/v1/campaigns/:id

Get a campaign with its associated content plans.

**Path params:** `id` (uuid) — campaign ID

**Response `200`:**
```json
{
  "campaign": { ... },
  "contentPlans": [ ... ]
}
```

**Response `404`:** `{ "error": "Campaign not found" }`

### POST /api/v1/campaigns

Create a campaign.

**Request body:**
```json
{
  "name": "Summer Sale (required, max 200 chars)",
  "description": "Optional (max 1000 chars)",
  "startDate": "2026-06-01T00:00:00.000Z (optional ISO datetime)",
  "endDate": "2026-06-30T00:00:00.000Z (optional ISO datetime)"
}
```

**Response `201`:** `{ "campaign": { ... } }`

### PUT /api/v1/campaigns/:id

Update a campaign.

**Path params:** `id` (uuid) — campaign ID

**Request body:** Same fields as create, all partial.

**Response `200`:** `{ "campaign": { ... } }`
**Response `404`:** `{ "error": "Campaign not found" }`

### DELETE /api/v1/campaigns/:id

Delete a campaign.

**Path params:** `id` (uuid) — campaign ID

**Response `200`:** `{ "success": true }`
**Response `404`:** `{ "error": "Campaign not found" }`

---

## Templates

### GET /api/v1/templates

List post templates with pagination and optional platform filter.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | int | 1 | Page number |
| `limit` | int | 20 | Items per page |
| `platform` | string | — | Filter by platform |

**Response `200`:** `{ "templates": [...], "pagination": { ... } }`

### GET /api/v1/templates/:id

Get a single template.

**Path params:** `id` (uuid) — template ID

**Response `200`:** `{ "template": { ... } }`
**Response `404`:** `{ "error": "Template not found" }`

### POST /api/v1/templates

Create a post template.

**Request body:**
```json
{
  "name": "Product Launch (required, max 200 chars)",
  "platform": "instagram (optional)",
  "contentText": "Template body text (optional, max 10000 chars)",
  "aiPrompt": "AI prompt for generation (optional, max 5000 chars)",
  "variables": ["product_name", "price"]
}
```

**Response `201`:** `{ "template": { ... } }`

### PUT /api/v1/templates/:id

Update a template.

**Path params:** `id` (uuid) — template ID

**Request body:** Same fields as create, all partial.

**Response `200`:** `{ "template": { ... } }`
**Response `404`:** `{ "error": "Template not found" }`

### DELETE /api/v1/templates/:id

Delete a template.

**Path params:** `id` (uuid) — template ID

**Response `200`:** `{ "success": true }`
**Response `404`:** `{ "error": "Template not found" }`

---

## Analytics

### GET /api/v1/analytics/overview

Aggregated analytics overview.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `tenantId` | string | **required** | Tenant ID |
| `from` | ISO datetime | — | Start date |
| `to` | ISO datetime | — | End date |

**Response `200`:** `{ "success": true, "metrics": { ... } }`

### GET /api/v1/analytics/platforms

Platform breakdown metrics.

**Query params:** Same as overview.

**Response `200`:** `{ "success": true, "platforms": { ... } }`

### GET /api/v1/analytics/posts/:postId

Per-post engagement metrics.

**Path params:** `postId` (string) — post ID

**Response `200`:**
```json
{
  "success": true,
  "analytics": [
    {
      "id": "uuid",
      "postId": "uuid",
      "platform": "instagram",
      "impressions": 1500,
      "reach": 1200,
      "engagementRate": 4.5,
      "likes": 200,
      "comments": 30,
      "shares": 15,
      "clicks": 100,
      "saves": 50,
      "fetchedAt": "2026-06-14T10:00:00.000Z"
    }
  ]
}
```

### GET /api/v1/analytics/top-posts

Top performing posts.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `tenantId` | string | **required** | Tenant ID |
| `limit` | string | `10` | Number of posts |
| `from` | ISO datetime | — | Start date |
| `to` | ISO datetime | — | End date |

**Response `200`:** `{ "success": true, "posts": [...] }`

### GET /api/v1/analytics/cross-platform

Cross-platform comparison metrics.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `tenantId` | string | **required** | Tenant ID |
| `from` | ISO datetime | — | Start date |
| `to` | ISO datetime | — | End date |

**Response `200`:** `{ "success": true, "metrics": { ... } }`

### GET /api/v1/analytics/best-times

Best posting-time slots derived from the last 90 days of historical engagement
data. Returns up to 3 slots per platform (top by average engagement rate). Slot
fields are useful for the Calendar UI to suggest optimal drop-in times.

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `tenantId` | string | **required** | Tenant ID |
| `platform` | string | — | Filter to one platform: `instagram`, `x`, `linkedin`, `tiktok`, `facebook`, `telegram`, `threads`, `pinterest`, `youtube` |

**Response `200`:**
```json
{
  "success": true,
  "slots": [
    {
      "platform": "instagram",
      "hour": 19,
      "dayOfWeek": 2,
      "avgEngagementRate": 6.42,
      "postCount": 14
    },
    {
      "platform": "instagram",
      "hour": 12,
      "dayOfWeek": 4,
      "avgEngagementRate": 5.81,
      "postCount": 9
    },
    {
      "platform": "instagram",
      "hour": 9,
      "dayOfWeek": 1,
      "avgEngagementRate": 4.97,
      "postCount": 11
    },
    {
      "platform": "x",
      "hour": 17,
      "dayOfWeek": 3,
      "avgEngagementRate": 3.55,
      "postCount": 7
    }
  ]
}
```

Field notes:
- `hour` is 0–23 in **UTC** (server storage timezone).
- `dayOfWeek` is 0–6, Sunday = 0 (PostgreSQL `extract(dow …)`).
- `avgEngagementRate` is a percentage (e.g. `6.42` = 6.42%).
- `postCount` is the number of historical posts that contributed to the slot.

**Response `400`:** `{ "error": "tenantId is required" }`

---

## Writer

AI content generation for the shared product foundation. Editor+ role required
(auth → tenant → RBAC). Generation rate-limit tier (`generate`, 1 hour / 50).

### POST /api/v1/writer/generate

Create a new content item (and its initial revision). `contentType` selects the
backend: `article` → hiai-kit `content.article` capability; `social_post` → the
temporary local writer adapter.

**Request body:**
```json
{
  "projectId": "uuid (optional, must belong to the tenant)",
  "brandId": "uuid (optional, must belong to the tenant)",
  "contentType": "article | social_post (required)",
  "topic": "string (required, 1-500 chars)",
  "language": "en (default, 2-10 chars)",
  "tone": "optional (article: neutral|executive|technical|creative)",
  "instruction": "optional (max 2000 chars)",
  "context": "optional (max 5000 chars)"
}
```

**Response `201`:**
```json
{
  "item": { "id": "uuid", "title": "...", "bodyText": "...", "status": "draft", "bodyJson": { "contentType": "article", "backend": "hiai-kit:content.article", "correlationId": "..." } },
  "revision": { "revisionNumber": 1 },
  "backend": "hiai-kit:content.article",
  "correlationId": "..."
}
```

**Response `502`:** hiai-kit unavailable / auth-blocked — normalized
`HIAI_KIT_ERROR` envelope carrying the correlation id (never a silent degrade).
**Response `400`:** `{ "error": "Validation failed", "code": "VALIDATION", "details": {...} }`

### POST /api/v1/writer/rewrite

Rewrite an existing content item — appends a NEW revision (history preserved).
Content type is derived from the item's stored `bodyJson.contentType`.

**Request body:**
```json
{
  "contentItemId": "uuid (required)",
  "topic": "optional (defaults to current title)",
  "instruction": "string (required, 1-2000 chars)",
  "language": "en (default)",
  "tone": "optional",
  "context": "optional"
}
```

**Response `200`:** `{ "item": {...}, "revision": {...}, "backend": "...", "correlationId": "..." }`
**Response `404`:** other tenants' items are indistinguishable from not found.

---

## Carousels

Product workspace over the hiai-kit carousel jobs pipeline. Viewer+ role to
read; editor+ for writes; admin+ to approve. Tenant scope comes exclusively
from `ctx.tenantId` — never from request input.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/carousels` | List carousels (paginated; only items persisted as `{kind:"carousel"}`) |
| GET | `/api/v1/carousels/:id` | Get a carousel (persisted bodyJson with actual slide data) |
| GET | `/api/v1/carousels/:id/revisions` | Immutable append-only revision history |
| GET | `/api/v1/carousels/:id/job` | Live hiai-kit job status (normalized errors, never fabricated) |
| GET | `/api/v1/carousels/:id/slides/:index/json` | Actual generated slide document (1-based index) |
| PUT | `/api/v1/carousels/:id/slides/:index/json` | Save a slide's actual hiai-kit document (validated shape; replaces only that slide's `doc` + appends a revision; editor+) |
| POST | `/api/v1/carousels` | Create: dispatch a hiai-kit job + snapshot revision #1 (editor+) |
| POST | `/api/v1/carousels/:id/regenerate` | Full-carousel regeneration (optional partial patch; appends revision) |
| POST | `/api/v1/carousels/:id/slides/:index/regenerate` | Regenerate one slide (persists the real regenerated document) |
| POST | `/api/v1/carousels/:id/submit-review` | draft/changes_requested → in_review (editor+) |
| POST | `/api/v1/carousels/:id/request-changes` | in_review → changes_requested with note (editor+) |
| POST | `/api/v1/carousels/:id/approve` | in_review → approved, terminal (admin+) |

**Create request body:**
```json
{
  "carouselTitle": "string (required, 1-500)",
  "slides": [{ "title": "max 500", "content": "max 5000" }],
  "designPreset": "string (required — one of the hiai-kit presets)",
  "slideWidth": 1024,
  "slideHeight": 1024,
  "styleDescription": "optional",
  "handle": "optional",
  "ctaText": "optional"
}
```

**Response `201`:** `{ "item": {...}, "job": { "jobId": "uuid", "slug": "..." } }`

**Save slide document (`PUT /api/v1/carousels/:id/slides/:index/json`, editor+):**

The request body IS the hiai-kit slide document (`{ "version": 1, "width": 1080,
"height": 1350, "background": {...}, "elements": [...] }`). The backend
validates the actual hiai-kit document shape (canvas `width`/`height`, element
`id`s, the known element `type` union — text/image/rect/circle/line/arrow/group
— and absolute `x`/`y` positions; unknown fields such as `shadow` pass through
unchanged so documents round-trip exactly). Only the selected slide's `doc` is
replaced — no other slide, deck metadata or job state is touched — and a new
immutable revision is appended (`changeNote: "Slide N document saved"`).
An invalid document or index → `400 VALIDATION` and nothing is persisted (no
fake success). Response `200`: `{ "item": {...}, "revision": {...}, "slide": {...} }`
where `item` is the normalized current content (cross-tenant → 404).

Adapter failures surface as normalized capability errors with the hiai-kit
status code (`HIAI_KIT_ERROR` / `CAPABILITY_UNAVAILABLE` / `TIMEOUT` /
`VALIDATION_ERROR`) — never a fabricated success.

---

## Projects / Brands

Shared product foundation for the brand context. Viewer+ to read; editor+ to
write. Tenant scope comes exclusively from `ctx.tenantId` — never from request
input (a `projectId`/`brandId` from another tenant is indistinguishable from
not found).

**Project brand context fields** (all optional): `description`,
`defaultLanguage` (BCP-47, e.g. `en-US`), `targetAudience`,
`tone` (project-level tone/voice), `contentGuidelines`,
`businessContext` (business/product context), `references` (array of
`{ type?, url?, title?, description? }`, max 20).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/projects` | List projects (paginated) |
| POST | `/api/v1/projects` | Create a project — `{ "name": "...", "defaultLanguage": "en", "tone": "...", "references": [...] }` → `201 { "project": {...} }` |
| GET | `/api/v1/projects/:id` | Get a project (cross-tenant → 404) |
| PUT | `/api/v1/projects/:id` | Partial update — omitted context fields are left intact; `null` clears, `[]` clears `references` |
| DELETE | `/api/v1/projects/:id` | Delete a project |
| GET | `/api/v1/projects/:id/context` | Project context: project + brands + content summary |
| GET | `/api/v1/projects/:id/brands` | List brands under the project (paginated) |
| POST | `/api/v1/projects/:id/brands` | Create a brand — `{ "name": "...", "voice": "...", "defaultLanguage": "de", ... }` → `201` (projectId is the path param, never the body) |
| GET | `/api/v1/projects/:id/brands/:brandId` | Get a brand |
| PUT | `/api/v1/projects/:id/brands/:brandId` | Partial update a brand |
| DELETE | `/api/v1/projects/:id/brands/:brandId` | Delete a brand |

Brands carry the same context columns (`voice` is the brand's tone/voice).

---

## Content

Shared content items with immutable revision history and an explicit approval
state machine (`draft → in_review → approved` terminal, `changes_requested ↔
in_review`). Viewer+ to read; editor+ to write; admin+ to approve.

Every item carries:

- `source` — truthful provenance derived from the acting surface and set at
  creation (never client input): `web` (interactive web UI / session
  principals), `api` (machine principals on the REST surface), `chatgpt`
  (MCP / ChatGPT Work API tools), plus `automation` / `webhook` / `import`
  reserved for future surfaces.
- `currentRevisionNumber` — pointer to the item's current (live) revision.
  Starts at 1 on creation and advances on every appended revision and every
  restore, in the same transaction. Revision history itself is immutable and
  append-only.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/content` | List items (paginated; `status` / `projectId` / `brandId` filters) |
| POST | `/api/v1/content` | Create an item (+ revision #1) — `{ "title": "...", "bodyText": "...", "bodyJson": {...} }` → `201` |
| GET | `/api/v1/content/:id` | Get an item (cross-tenant → 404) |
| GET | `/api/v1/content/:id/revisions` | Immutable revision history (newest first) |
| POST | `/api/v1/content/:id/revisions` | Create a revision (snapshot of the new state; advances `currentRevisionNumber`) |
| POST | `/api/v1/content/:id/revisions/:revisionId/restore` | Restore a snapshot — copies it onto the item AND appends a new revision (history preserved; pointer advances) |
| POST | `/api/v1/content/:id/submit-review` | draft/changes_requested → in_review (editor+) |
| POST | `/api/v1/content/:id/request-changes` | in_review → changes_requested with note (editor+) |
| POST | `/api/v1/content/:id/approve` | in_review → approved, terminal (admin+) |

All revision endpoints are tenant-scoped: an item in another tenant is a `404`
NOT_FOUND, never a leak.

---

## API Keys

Admin+ only. Machine credentials for the Work API surface (MCP + Bearer
routes). Keys are stored hash-only (SHA-256); the plaintext `hpk_<secret>` is
returned exactly once at creation and never logged.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/api-keys` | Create a key — `{ "name": "...", "scopes": ["writer:generate", ...] }` → `201 { "key": "hpk_...", "apiKey": {...} }` (full key once) |
| GET | `/api/v1/api-keys` | List keys (visible prefix + metadata only, no hash/plaintext) |
| POST | `/api/v1/api-keys/:id/revoke` | Revoke (tombstone; row + hash history retained for audit) |

---

## MCP (Machine Protocol)

`POST /api/v1/mcp` — JSON-RPC 2.0 transport exposing the Work API to ChatGPT
/ any MCP client. Requires a MACHINE principal (Bearer `hpk_<key>` or admin
JWT); browser session tokens are rejected (`401 MACHINE_AUTH_REQUIRED`). Tools
operate within the tenant that issued the key.

Implements: `initialize`, `tools/list`, `tools/call` (plus
`notifications/initialized` ping).

**Available tools** (`tools/list` is the source of truth): `writer_generate`,
`writer_rewrite`, `carousel_generate`, `carousel_get`, `carousel_regenerate`,
`carousel_regenerate_slide`, `carousel_submit_review`,
`carousel_request_changes`, `carousel_approve`, `content_get`, `content_list`,
`content_submit_review`, `content_request_changes`, `content_approve`,
`project_list`, `project_get`.
Each tool enforces a fine-grained scope (e.g. `writer:generate`,
`content:submit_review`, `content:request_changes`, `carousel:regenerate`;
carousel review tools reuse the `content:*` review scopes because a carousel IS
a content item and the approval state machine is shared) and
runtime-validates its arguments; failures return MCP tool results with
`isError: true` (never protocol errors). Every tool call carries a
`correlationId` in `_meta` / error data.

**Protocol conventions:**
- results → HTTP `200` `{ "jsonrpc": "2.0", "id", "result" }`
- protocol errors → HTTP `200` `{ "jsonrpc": "2.0", "id", "error": { "code", "message", "data" } }` (parse errors → HTTP `400`)
- notifications → HTTP `202` empty body

```bash
curl -X POST http://localhost:50300/api/v1/mcp \
  -H "Authorization: Bearer hpk_<key>" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## Observability (hiai-observe)

Structured Writer / Carousel / Content (incl. approval) / Postiz / API / MCP /
Webhook success/failure events are emitted to the hiai-observe plane (peer
service, default `http://localhost:8001`) via the OTLP `/v1/logs` endpoint
using the verified Bearer API-key contract
(`Authorization: Bearer <HIAI_OBSERVE_API_KEY>`).

Instrumented operations: `writer.generate`/`writer.rewrite`,
`carousel.*`, `content.create`, `content.submit_review`/`content.approve`/
`content.request_changes`, `postiz.submit`/`postiz.status_sync`,
`webhook.store_product` (delivery outcomes incl. signature/tenant/dedup
results), `hiai-kit.http`, `mcp.request`/`mcp.tools.call:<tool>`, and
`api.request` per `/api/*` request.

- Enabled only when `HIAI_OBSERVE_URL` + `HIAI_OBSERVE_API_KEY` +
  `HIAI_OBSERVE_PROJECT` are configured — otherwise the emitter is a no-op.
- Events carry `correlation.id` (mapped to the OTLP `traceId`), tenant/user
  ids, status, error code and duration; never content, prompts, bodies or
  secrets. Bounded by `HIAI_OBSERVE_TIMEOUT_MS` (default 2000). Telemetry can
  never fail or slow a product request.
- `SENTRY_DSN` remains a declared-only legacy value; hiai-post sends no
  `X-Sentry-Auth` traffic.

See `docs/ARCHITECTURE.md` → hiai-observe for the full boundary description.

---

## Postiz (integration boundary)

Typed publication-intent submission / status-sync boundary only — NOT wired
into publishing, NOT backed by a queue, and NOT a live adapter. Native
platform publishing adapters remain the current publishing owners (marked
deprecated/replaced — see `docs/ARCHITECTURE.md`).

Configured via `POSTIZ_API_URL` + `POSTIZ_API_KEY` (optional). When either is
unset the client reports `503 NOT_CONFIGURED` — it never fabricates a live
submission. Contract fields: `externalProvider`, `externalItemId`,
`scheduledAt`, `status` (`scheduled`/`published`/`failed`/`cancelled`), `url`,
`error`. Endpoint paths (`/api/v1/publications`, `/api/v1/publications/status`)
are this boundary's expectation — verify them against your Postiz deployment
before enabling live use.

---

## Webhooks

Webhook receivers are called by sibling hiai-kit services. All webhook
endpoints authenticate via a shared `X-Webhook-Secret` header (constant-time
comparison) — they do **not** use the user `Authorization` header. Secrets are
configured via environment variables (see `.env.example`).

### POST /api/v1/webhooks/store-product

Inbound webhook from **hiai-store**: a new product was created/updated. The
receiver creates a `draft` post so the merchant can review, edit, and schedule
without leaving hiai-post.

**Auth:** `X-Webhook-Secret` header (must equal `HIAI_STORE_WEBHOOK_SECRET`).

**Request body:**
```json
{
  "tenantId": "uuid (required)",
  "productId": "string (required, 1-200 chars)",
  "productName": "string (required, 1-500 chars)",
  "productUrl": "https://... (required, valid URL)",
  "productImage": "https://... (optional, valid URL)",
  "platform": "instagram (required, 1-50 chars)"
}
```

Validation: Zod schema enforces the shape above. `tenantId` must be a UUID.

**Response `201` (new draft created):**
```json
{
  "post": {
    "id": "uuid",
    "tenantId": "uuid",
    "socialAccountId": null,
    "contentText": "New: Acme Wireless Headphones\n\nShop now: https://store.example.com/p/acme-headphones",
    "contentJson": {
      "source": "hiai-store-webhook",
      "productId": "prod_abc123",
      "productUrl": "https://store.example.com/p/acme-headphones",
      "platform": "instagram"
    },
    "mediaUrls": ["https://cdn.example.com/p/acme-headphones.jpg"],
    "platform": "instagram",
    "status": "draft",
    "scheduledAt": null,
    "publishedAt": null,
    "platformPostId": null,
    "errorMessage": null,
    "contentHash": "f1e0d5b7a9c3...",
    "createdAt": "2026-06-20T10:00:00.000Z",
    "updatedAt": "2026-06-20T10:00:00.000Z"
  }
}
```

**Response `200` (idempotent — already processed):**
```json
{
  "post": { "id": "uuid" },
  "deduplicated": true
}
```

Idempotency: the handler hashes `(tenantId, productId, platform)` with SHA-256
and stores it in `posts.content_hash`. Re-deliveries for the same
`(tenant, product, platform)` tuple return the original post instead of
creating a duplicate. A different platform for the same product still produces
a fresh draft.

**Response `400`:** `{ "error": "Zod validation error message" }`
**Response `401`:** `{ "error": "Invalid webhook signature" }`
**Response `503`:** `{ "error": "Webhook receiver is not configured" }` (env var missing)

---

## OAuth

### GET /api/v1/oauth/:platform/connect

Start OAuth 2.0 authorization flow for a social platform.

**Path params:** `platform` — one of: `instagram`, `facebook`, `x`, `linkedin`, `tiktok`, `threads`, `pinterest`, `youtube`

**Response `200`:**
```json
{
  "authUrl": "https://platform.com/oauth/authorize?...",
  "state": "random-state-string"
}
```

**Response `400`:** `{ "error": "Unsupported platform: {platform}" }`
**Response `500`:** `{ "error": "Platform {platform} not configured" }`

### GET /api/v1/oauth/:platform/callback

Handle OAuth 2.0 callback, exchange code for tokens, and store account.

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `code` | string | Authorization code (required) |
| `state` | string | State parameter for CSRF validation |

**Response `200`:**
```json
{
  "success": true,
  "account": {
    "id": "uuid",
    "platform": "instagram",
    "username": "mybrand"
  }
}
```

**Response `400`:** Various error messages for invalid state, missing code, etc.
**Response `403`:** `{ "error": "Tenant mismatch" }`

---

## YouTube

### GET /api/v1/youtube/connect

Start YouTube OAuth flow.

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `state` | string | Optional custom state |

**Response `200`:**
```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "state": "optional-state"
}
```

### GET /api/v1/youtube/callback

Handle YouTube OAuth callback and store channel.

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `code` | string | Authorization code (required) |

**Response `200`:** `{ "success": true, "account": { ... } }`

### POST /api/v1/youtube/upload

Upload video to YouTube.

**Request body:**
```json
{
  "socialAccountId": "uuid (required)",
  "videoUrl": "https://... (required, URL to video file)",
  "title": "Video Title (required, max 100 chars)",
  "description": "Video description (optional, max 5000 chars)",
  "tags": ["tag1", "tag2"],
  "categoryId": "22 (optional)",
  "privacyStatus": "public (optional: public|unlisted|private)",
  "madeForKids": false,
  "defaultLanguage": "en (optional)",
  "thumbnailUrl": "https://... (optional)",
  "durationSeconds": 120,
  "kind": "short (optional: short|long)"
}
```

**Response `200`:**
```json
{
  "success": true,
  "videoId": "youtube-video-id",
  "status": "uploaded",
  "uploadStatus": "processed",
  "kind": "long",
  "videoUrl": "https://youtu.be/..."
}
```

### GET /api/v1/youtube/status

Check YouTube video processing status.

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `socialAccountId` | uuid | YouTube account ID (required) |
| `videoId` | string | YouTube video ID (required) |

**Response `200`:**
```json
{
  "videoId": "youtube-id",
  "title": "Video Title",
  "publishedAt": "2026-06-14T10:00:00.000Z",
  "uploadStatus": "processed",
  "privacyStatus": "public",
  "processingStatus": "succeeded",
  "failureReason": null,
  "videoUrl": "https://youtu.be/..."
}
```

### GET /api/v1/youtube/channel

Get YouTube channel information.

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `socialAccountId` | uuid | YouTube account ID (required) |

**Response `200`:** `{ "channel": { ... } }`

---

## Queue Management

### GET /api/v1/queue/status

Get publish queue status for a tenant.

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `tenantId` | string | **required** |

**Response `200`:**
```json
{
  "pending": 5,
  "deadLetter": 2
}
```

### GET /api/v1/queue/scheduled

Get scheduled items for a tenant.

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `tenantId` | string | **required** |

**Response `200`:** `{ "items": [...] }`

### GET /api/v1/queue/dead-letter

Get dead letter queue items for a tenant.

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `tenantId` | string | **required** |

**Response `200`:** `{ "items": [...] }`

### POST /api/v1/queue/retry/:postId

Retry a failed post from the dead letter queue.

**Path params:** `postId` (string) — post ID

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `tenantId` | string | **required** |

**Response `200`:** `{ "success": true, "message": "Post re-enqueued" }`
**Response `404`:** `{ "error": "Post not found in dead letter queue" }`

---

## Real-time Events

### GET /api/v1/events

SSE (Server-Sent Events) stream for real-time publish status updates.

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| `tenantId` | string | Optional — filter events by tenant |

**Response:** `text/event-stream`

```text
event: connected
data: {"clientId":"uuid","timestamp":"2026-06-14T10:00:00.000Z"}

event: publish_status
data: {"postId":"uuid","status":"published","platform":"instagram"}

: heartbeat
```

### GET /api/v1/events/stats

SSE connection statistics (debugging).

**Response `200`:**
```json
{
  "connectedClients": 3,
  "clients": [
    {
      "id": "uuid",
      "tenantId": "uuid",
      "connectedFor": "15s ago (last heartbeat)"
    }
  ]
}
```

---

## Common Error Responses

| Status | Meaning |
|--------|---------|
| `400` | Validation error / Bad request |
| `401` | Missing or invalid authentication |
| `403` | Forbidden (tenant mismatch) |
| `404` | Resource not found |
| `409` | Conflict (e.g., duplicate content) |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
| `503` | Service unavailable (degraded) |

## Rate Limiting

Rate limit headers are returned on all responses:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests in the window |
| `X-RateLimit-Remaining` | Remaining requests in the window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |
| `Retry-After` | Seconds to wait before retrying (on 429 only) |

Tiers:

| Tier | Window | Max Requests | Routes |
|------|--------|-------------|-------|
| `auth` | 15 min | 5 | Auth-related |
| `public` | 1 min | 100 | Health |
| `authenticated` | 1 min | 300 | Most CRUD endpoints |
| `publish` | 1 min | 20 | Publish actions |
| `generate` | 1 hour | 50 | AI content generation |
