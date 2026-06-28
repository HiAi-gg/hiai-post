# hiai-post API Reference

Base URL: `http://localhost:50300` (development) / `https://your-domain.com` (production)

All authenticated endpoints require:
- `Authorization: Bearer <session_token>` header
- `X-Tenant-Id: <tenant_uuid>` header (except health)

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
