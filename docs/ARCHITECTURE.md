# hiai-post Architecture

## System Overview

hiai-post is a multi-tenant social media content planning and publishing platform. It provides AI-powered content generation, multi-platform scheduling, and analytics for merchant stores.

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        External Users                            │
│          Merchants · Social Media Managers · Admins              │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    hiai-post-frontend (SvelteKit)                 │
│                         Port 50301                                │
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌─────────────────────┐ │
│  │ Post     │ │ Content  │ │ Calendar  │ │ Analytics           │ │
│  │ Editor   │ │ Plans    │ │ View      │ │ Dashboard           │ │
│  └────┬─────┘ └────┬─────┘ └─────┬─────┘ └──────────┬──────────┘ │
│       │            │             │                  │            │
│  ┌────▼────────────▼─────────────▼──────────────────▼──────────┐ │
│  │              API Client (src/lib/api.ts)                     │ │
│  │              TanStack Svelte Query + fetch                   │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
└─────────────────────────────┬────────────────────────────────────┘
                              │ HTTP REST + SSE
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│  hiai-store ─── POST /api/v1/webhooks/store-product ──┐          │
│  (product.created/updated, X-Webhook-Secret header)   │          │
│  auto-publish flow ───────────────────────────────────┤          │
└───────────────────────────────────────────────────────┼──────────┘
                                                        │
   ┌────────────────────────────────────────────────────▼───────────┐
   │                    hiai-post-api (Elysia)                      │
   │                         Port 50300                             │
   │                                                                │
   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐│ │
   │  │ Accounts │ │  Posts   │ │Content   │ │Campaigns │ │Templa-││ │
   │  │ Route    │ │  Route   │ │Plans R.  │ │ Route    │ │tes R. ││ │
   │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬───┘│ │
   │       │            │            │            │           │     │ │
   │  ┌────▼────────────▼────────────▼────────────▼───────────▼─┐  │ │
   │  │                  Middleware Stack                        │  │ │
   │  │  auth.ts → tenant.ts → rateLimiter.ts (per-tenant,       │  │ │
   │  │    Redis ZSET rl:<tier>:<tenant_id>:<ip>)                │  │ │
   │  │  → secureHeaders.ts → audit.ts (POST/PUT/PATCH/DELETE →  │  │ │
   │  │    audit_logs on success, redacts secrets, fails open)   │  │ │
   │  └────────────────────────────┬─────────────────────────────┘  │ │
   │                               │                                │ │
   │  ┌────────────────────────────▼───────────────────────────────┐ │ │
   │  │                  Core Business Logic                       │ │ │
   │  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐   │ │ │
   │  │  │  Publisher   │  │  Scheduler   │  │  Analytics      │   │ │ │
   │  │  │  (platform   │  │  (Redis      │  │  Aggregator     │   │ │ │
   │  │  │   adapters)  │  │   sorted     │  │  (platform APIs)│   │ │ │
   │  │  └──────┬──────┘  │   sets)      │  └────────┬────────┘   │ │ │
   │  │         │         └──────────────┘           │            │ │ │
   │  │  ┌──────▼──────┐                  ┌──────────▼─────────┐  │ │ │
   │  │  │ Mastra AI   │                  │  Error Reporter    │  │ │ │
   │  │  │ Workflows   │                  │  (pino → DSN)      │  │ │ │
   │  │  └─────────────┘                  └──────────┬─────────┘  │ │ │
   │  └─────────────────────────────────────────────┼────────────┘ │ │
   │                                                │              │ │
   │  ┌─────────────────────────────────────────────▼──────────────┐ │ │
   │  │                     Data Access Layer                       │ │ │
   │  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐ │ │ │
   │  │  │  Drizzle  │  │  Redis   │  │    Integration Clients    │ │ │
   │  │  │  ORM      │  │  Client  │  │   (platform SDKs, etc.)  │ │ │
   │  │  └────┬─────┘  └────┬─────┘  └───────────┬──────────────┘ │ │ │
   │  └───────┼─────────────┼────────────────────┼─────────────────┘ │ │
   └──────────┼─────────────┼────────────────────┼───────────────────┘
              │             │                    │
              ▼             ▼                    ▼
       ┌──────────┐  ┌──────────┐  ┌──────────────────────────────────┐
       │PostgreSQL│  │  Redis   │  │          Platform APIs            │
       │+pgvector │  │ 8.6+     │  │  IG · TikTok · X · LI · FB · TG  │
       │  18.4    │  │          │  │  YT · Threads · Pinterest · Blog  │
       │+audit_log│  │          │  │                                    │
       └──────────┘  └──────────┘  └──────────────────────────────────┘

                         ▲ OTLP /v1/logs — Bearer API key
                         │  Authorization: Bearer <HIAI_OBSERVE_API_KEY>
                         │  structured Writer/Carousel/API/MCP events
                         │  (correlation.id → traceId; no secrets/content)
                         │
                  ┌──────┴──────────────────────────┐
                  │         hiai-observe            │
                  │   Unified observability plane   │
                  │  (errors · uptime · metrics ·   │
                  │   logs · AI cost · alerts)      │
                  └─────────────────────────────────┘
```

---

## Module Boundaries

### Backend Modules (`backend/src/`)

| Module | Directory | Responsibility |
|--------|-----------|----------------|
| **API Routes** | `api/routes/` | HTTP request handlers, validation, response formatting |
| **Middleware** | `api/middleware/` | Auth, rate limiting, tenant scoping, security headers, audit logging (`audit.ts`), access logging (`apiLogger.ts`) |
| **Shared services** | `services/` | Runtime-validated application services (writer, carousels, content, projects, approval, api-keys, revisions) — tenant-scoped via `ctx.tenantId` only. Content items carry a `source` provenance column (web/api/chatgpt/automation/webhook/import — derived from the acting principal, never client input) and a `currentRevisionNumber` pointer advanced by `createRevision`/`restoreRevision` in the same transaction. Projects/brands carry the brand context (defaultLanguage, targetAudience, tone/voice, contentGuidelines, businessContext, references) which the Writer folds into generation prompts |
| **MCP** | `api/mcp/` | JSON-RPC tool registry (`/api/v1/mcp`): thin wrappers over the shared services with per-tool scope checks |
| **Publisher** | `core/publisher/` | Platform-specific publishing adapters — **DEPRECATED / REPLACED** by the Postiz boundary (see below); retained for compatibility |
| **Scheduler** | `core/scheduler/` | Redis queue, cron-based poller, retry logic |
| **Analytics** | `core/analytics/` | Engagement metrics aggregation from platform APIs |
| **DB** | `db/` | Drizzle ORM schema definitions, migrations, client |
| **Integrations** | `integrations/` | Peer-service clients: `hiai-kit/` (capability API + carousel jobs), `postiz/` (publication-intent boundary), plus legacy social platform clients |
| **Mastra** | `mastra/` | AI workflows, agents, tools |
| **Lib** | `lib/` | Shared utilities (config, encryption, platform rules, `observe.ts` telemetry, etc.) |
| **Workers** | `workers/` | Background workers (OAuth refresh, dead letter processing) |

### Frontend Modules (`app/src/`)

| Module | Directory | Responsibility |
|--------|-----------|----------------|
| **Pages** | `routes/` | SvelteKit page components |
| **Components** | `lib/components/` | Reusable UI components |
| **Stores** | `lib/stores/` | Svelte 5 rune-based state management |
| **API Client** | `lib/api.ts` | Frontend HTTP client for backend API |

### Dependency Rules

```
api/routes/     → api/middleware/, lib/, db/, core/*, integrations/*
api/middleware/  → lib/
core/*          → lib/, db/, integrations/
integrations/*  → lib/ (only)
mastra/         → lib/, db/, integrations/
lib/            → (no project-internal imports)
workers/        → lib/, db/, integrations/, core/
app/            → (backend via REST API only)
```

**Key constraint:** `integrations/` must not import from `mastra/`. `core/scheduler/` must not import from `integrations/` directly. `core/publisher/` MAY import from `integrations/` to post content.

---

## Data Flow

### Post Creation & Publishing Flow

```
User (Frontend)
    │
    │ POST /api/v1/posts/generate
    ▼
Generate Route
    │
    │ Mastra Workflow: content-generate
    ▼
┌────────────────────────────────────────────────────┐
│ 1. extract-params   — LLM extracts topic, lang,    │
│                       platform, format              │
│ 2. content-write    — Unified writer with Zod      │
│                       schemas, retry (2 attempts)   │
│ 3. duplicate-check  — Title overlap + pgvector      │
│                       semantic similarity (0.85)    │
│ 4. platform-format  — Parallel adaptation per       │
│                       platform via platform-rules   │
│ 5. polish-output    — LLM cleanup + regex safety    │
└──────────────────────┬─────────────────────────────┘
                       │
                       ▼
              Posts created as 'draft'
                       │
                       │ PUT /api/v1/posts/:id/schedule
                       ▼
              Status → 'scheduled'
              Enqueue in Redis sorted set
                       │
                       │ Publisher Cron (every minute)
                       ▼
              ┌─────────────────┐
              │ Redis Sorted Set │
              │ score = unix ts  │
              │ member = postId  │
              └────────┬────────┘
                       │ pop posts where score <= now()
                       ▼
              ┌─────────────────┐
              │ Publish Adapter  │
              │ (per platform)   │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │ Status check     │
              │                  │
              │ Success ────→ 'published' + SSE event
              │ Failure ───→ retry (3 attempts)
              │              1min → 5min → 15min
              │              ───→ dead letter
              └─────────────────┘
```

### OAuth Token Flow

```
User clicks "Connect [Platform]"
    │
    │ GET /api/v1/oauth/:platform/connect
    ▼
Route generates state (CSRF token), stores in Redis
    │
    │ Returns platform auth URL
    ▼
User authorizes on platform
    │
    │ Redirect to /api/v1/oauth/:platform/callback?code=...&state=...
    ▼
Callback validates state, exchanges code for tokens
    │
    │ Fetch user profile from platform
    ▼
Encrypt tokens with AES-256-GCM
    │
    │ INSERT social_accounts with encrypted tokens
    ▼
Done — account active
```

---

## Multi-Tenant Isolation Strategy

### Database Level

Every table includes a `tenant_id` column (UUID) referencing `tenants.id`:

```sql
-- Example: posts table
CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    content_text TEXT,
    ...
);
CREATE INDEX posts_tenant_idx ON posts(tenant_id);
```

### Query Level

All queries filter by `tenant_id`:

```typescript
// Every route includes AND tenant_id = ?
const [post] = await db
  .select()
  .from(posts)
  .where(and(
    eq(posts.id, params.id),
    eq(posts.tenantId, tenantId) // <-- enforced by middleware
  ))
  .limit(1);
```

### Middleware Level

The `tenant.ts` middleware extracts `X-Tenant-Id` header and validates UUID format. The `auth.ts` middleware verifies the session. Combined, they ensure:

1. User is authenticated (valid Bearer token)
2. Request includes a valid tenant UUID
3. User's JWT claims match the requested tenant

### Redis Level

Redis keys are namespaced by tenant:

```
publish_queue:{tenant_id}       (sorted set)
rl:auth:{tenant_id}:{ip}       (rate limit counters)
oauth_state:{tenant_id}:{hash}  (OAuth state store)
```

### Cross-Tenant Verification

Tests must verify that tenant A cannot access tenant B's data:
```typescript
// Integration test pattern
const tenantAId = '...';
const tenantBId = '...';
const postA = await createPost(tenantAId);
const result = await getPost(tenantBId, postA.id);
expect(result.status).toBe(404);
```

---

## OAuth Token Storage Strategy

### Encryption

- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Key source:** `TOKEN_ENCRYPTION_KEY` environment variable (64 hex chars = 32 bytes)
- **Library:** Node.js `crypto` module (built-in, no extra deps)

### Storage

Tokens are stored in `social_accounts` table:

| Column | Type | Description |
|--------|------|-------------|
| `access_token_encrypted` | text | AES-256-GCM encrypted access token |
| `refresh_token_encrypted` | text? | AES-256-GCM encrypted refresh token |
| `token_expires_at` | timestamptz? | Token expiry timestamp |
| `scopes` | jsonb | Granted OAuth scopes |

### Refresh

- Background worker (`workers/oauth-refresh.ts`) polls for tokens expiring within 5 minutes
- Refreshed tokens are re-encrypted and stored
- If refresh fails, account status is set to `expired`
- Frontend displays "Reconnect" prompt for expired accounts

### Key Rotation

The encryption key can be rotated by re-encrypting all stored tokens. This is a manual operation:
1. Decrypt all tokens with old key
2. Re-encrypt with new key
3. Update `TOKEN_ENCRYPTION_KEY` env var
4. Rotate old key out

---

## Publish Queue Architecture

### Data Structure

Redis sorted set with:
- **Key:** `publish_queue:{tenant_id}`
- **Score:** Unix timestamp (milliseconds) of scheduled publish time
- **Member:** Post ID (UUID)

### Operations

| Operation | Redis Command | Description |
|-----------|--------------|-------------|
| Enqueue | `ZADD` | Add post ID with score = publish timestamp |
| Dequeue | `ZRANGEBYSCORE` + `ZREM` | Pop posts where score <= now() |
| Remove | `ZREM` | Remove post from queue (on delete/unschedule) |
| Count | `ZCARD` | Count pending items |
| Peek | `ZRANGE` | View scheduled items |

### Publisher Cron

Runs every 60 seconds:
1. For each active tenant, pop posts where `score <= now()`
2. For each post:
   - Check post status is `scheduled`
   - Call platform-specific publish adapter
   - On success: update post status to `published`, emit SSE event
   - On failure: increment retry count, re-enqueue with backoff

### Retry Logic

| Attempt | Backoff | Total Retry Window |
|---------|---------|--------------------|
| 1 | 1 minute | 1 minute |
| 2 | 5 minutes | 6 minutes |
| 3 | 15 minutes | 21 minutes |

After 3 failures, post moves to dead letter queue.

### Dead Letter Queue

- **Key:** `dead_letter:{tenant_id}`
- Structure: Redis list
- Each entry contains: `{ postId, errorMessage, failedAt, retryCount }`
- Manual retry via `POST /api/v1/queue/retry/:postId` re-enqueues the post
- Monitoring alert on dead letter queue size > threshold

### Idempotency

Publish operations use `(social_account_id, content_hash)` as dedup key to prevent double-publishing.

---

## Integration Patterns

### Social Platform Integration

Each platform has a dedicated directory in `integrations/`:

```
integrations/
  instagram/    → Graph API (posts, stories, reels, carousels)
  tiktok/       → Login Kit + Content Posting API
  x/            → API v2 (tweets, threads, media)
  linkedin/     → Marketing API (posts, articles)
  facebook/     → Graph API (posts, stories)
  telegram/     → Bot API (messages, media)
  youtube/      → Data API v3 (upload, channel, status)
```

Each integration exposes a standard interface:
```typescript
interface PlatformIntegration {
  publish(post: Post): Promise<PublishResult>;
  validateCredentials(): Promise<boolean>;
  refreshToken?(): Promise<TokenResult>;
}
```

### hiai-kit Integration

hiai-kit runs as a **peer service** (default `http://localhost:3000`) hosting the
shared capability API (`/api/v1/capabilities`) and carousel jobs
(`/api/v1/carousel`). All access is centralized in
`backend/src/integrations/hiai-kit/` — the only module that builds hiai-kit
URLs; the frontend never uses them directly.

```
backend/src/integrations/hiai-kit/
  index.ts        → createHiaiKitClient() (capabilities + carousel clients)
  config.ts       → HIAI_KIT_URL / HIAI_KIT_TIMEOUT_MS / HIAI_KIT_COOKIE / HIAI_KIT_TOKEN
  errors.ts       → normalized HiaiKitError (CAPABILITY_UNAVAILABLE, HIAI_KIT_ERROR, TIMEOUT, VALIDATION_ERROR)
  schemas.ts      → runtime-validated request/response contracts (mirrors hiai-kit)
  http.ts         → the single HTTP boundary (timeout, correlation ids, sanitized errors)
  capabilities.ts → research.general / content.article / content.carousel via the capability envelope
  carousel.ts     → carousel job create/get/slide JSON/regenerate/cover methods
```

Auth is only as good as what hiai-kit accepts: writes are gated by a Better
Auth session (`requireAuth` + `agents:write`). Without `HIAI_KIT_COOKIE` /
`HIAI_KIT_TOKEN` configured (server-side credentials forwarded as `Cookie` /
`Authorization: Bearer`), protected calls fail with 401 mapped to
`HIAI_KIT_ERROR` — the boundary never claims authentication works without
configured credentials, and never logs secrets.

### hiai-observe Integration (telemetry)

`backend/src/lib/observe.ts` is the single telemetry emitter. It sends
structured **Writer / Carousel / Content (incl. approval) / Postiz / API /
MCP / Webhook** start/success/failure events to the hiai-observe plane (peer
service, default `http://localhost:8001`) over the OTLP `/v1/logs` endpoint,
authenticated with the **verified Bearer API-key contract**
(`Authorization: Bearer <HIAI_OBSERVE_API_KEY>` — the same contract
hiai-observe's auth middleware and hiai-kit's working OTLP clients use;
`X-Sentry-Auth` is never sent).

```
hiai-post (lib/observe.ts) ──POST /v1/logs──▶ hiai-observe
   Authorization: Bearer <key>   resourceLogs[].logRecords[]
   correlation.id → traceId      severityText: INFO | ERROR
   tenant.id / user.id / status.code / error.code / duration.ms
```

- **Config:** `HIAI_OBSERVE_URL`, `HIAI_OBSERVE_API_KEY`, `HIAI_OBSERVE_PROJECT`
  (all optional), `HIAI_OBSERVE_TIMEOUT_MS` (default 2000). Unconfigured →
  **no-op**: zero network, zero overhead.
- **Never fails the product request:** emits are fire-and-forget and bounded by
  a timeout; every outbound error is swallowed. `observeCall(...)` wraps async
  operations (start/success/failure) and returns/rethrows the operation's own
  result — telemetry can never alter behavior.
- **No secrets / content leakage:** only sanitized metadata (ids, statuses,
  durations, error codes) is sent; secret-shaped keys are dropped, strings are
  truncated, and content bodies/prompts are never attached.
- **No telemetry database:** events are forwarded outbound only.
- **Instrumented points:** Writer service (`writer.generate`/`writer.rewrite`),
  Carousel service (`carousel.create`/`carousel.regenerate`/
  `carousel.regenerateSlide`/`carousel.job.status`), Content service
  (`content.create`), the approval state machine (`content.submit_review`/
  `content.approve`/`content.request_changes`), the Postiz boundary
  (`postiz.submit`/`postiz.status_sync`), the hiai-store webhook receiver
  (`webhook.store_product` outcomes incl. signature/tenant/dedup results), the
  hiai-kit adapter HTTP boundary (`hiai-kit.http`, every outbound call), the
  MCP route (`mcp.request` + `mcp.tools.call:<tool>`), and the API entry point
  (`api.request` for every `/api/*` request except health/CORS).
- `SENTRY_DSN` remains a declared-only legacy value; hiai-post sends no
  `X-Sentry-Auth` traffic.

### Writer & Carousel Product Layer

`backend/src/services/writer.ts` and `backend/src/services/carousels.ts` are
runtime-validated application services composing the hiai-kit boundary with the
shared persistence services:

- **Writer:** `article` → hiai-kit `content.article` capability; `social_post`
  → a TEMPORARY local adapter over the pre-existing mastra
  `content-generate` workflow (hiai-kit `content.post` does not exist yet —
  the fallback is explicit and documented). Generate persists a content item +
  revision #1; rewrite appends a revision (append-only history).
- **Carousels:** create / regenerate / per-slide regenerate / live job status /
  slide JSON, each proxying hiai-kit through the centralized adapter and
  persisting `{ kind: "carousel", ... }` bodyJson with immutable revisions.
- Both emit hiai-observe events (see above) and never fabricate success when
  hiai-kit is unavailable or auth-blocked (normalized `HiaiKitError` envelopes).

### MCP (Work API)

`POST /api/v1/mcp` (routes `api/routes/mcp.ts`, registry `api/mcp/tools.ts`)
exposes the Work API to ChatGPT / any MCP client as JSON-RPC 2.0. Tools are
thin wrappers over the shared services (writer, carousels, content, approval)
with per-tool scope checks (`requiredScope`) and runtime argument validation —
no agent internals are reachable. Only machine principals (Bearer `hpk_<key>`
API keys or admin JWTs) are accepted; tenant scope comes exclusively from the
machine principal. Every call carries a correlation id; failures return MCP
tool results with `isError: true` (never protocol errors).

### Postiz Integration (publication boundary)

`backend/src/integrations/postiz/` is a **typed integration boundary only**:

```
postiz/
  config.ts   → POSTIZ_API_URL / POSTIZ_API_KEY / POSTIZ_TIMEOUT_MS (optional; summary never logs the key)
  schemas.ts  → runtime contracts: externalProvider / externalItemId /
                scheduledAt / status (scheduled|published|failed|cancelled) /
                url / error
  errors.ts   → normalized PostizError (NOT_CONFIGURED / TIMEOUT /
                VALIDATION_ERROR / POSTIZ_ERROR)
  client.ts   → createPostizClient(): submitPublication(intent) +
                syncStatus(record) — Bearer auth, bounded timeout,
                correlation ids, sanitized failures
```

- **Explicitly NOT wired into publishing.** There is no queue, no scheduler
  consumer, and no service calls this client yet — it exists so future
  publication work has a single typed, sanitized, tested path.
- **Does NOT repair or replace the native platform adapters.** The pre-existing
  `core/publisher/` adapters remain the current publishing owners; they are
  **DEPRECATED / REPLACED** by this boundary in the sense that new publication
  work should target Postiz-style backends through `integrations/postiz`
  instead of growing the legacy adapters.
- **Never claims live Postiz works without credentials.** Unconfigured →
  `503 NOT_CONFIGURED`. Endpoint paths (`/api/v1/publications`,
  `/api/v1/publications/status`) are this boundary's expectation — verify
  against the actual Postiz deployment before enabling live use.

### AI Integration (Mastra)

Content generation uses Mastra workflows with Zod-validated schemas:

```
content-generate workflow:
  1. extract-params     → LLM extracts topic, language, platform, format
  2. content-write      → AI writes unified content with retry (2 attempts)
  3. duplicate-check    → pgvector semantic similarity check (threshold: 0.85)
  4. platform-format    → Parallel adaptation per platform
  5. polish-output      → LLM cleanup + regex safety net
```

### External System Integration

| System | Pattern | Protocol |
|--------|---------|----------|
| **hiai-admin** | REST API calls | HTTP/JSON |
| **hiai-store** | Event-driven (webhooks) | HTTP/JSON + `X-Webhook-Secret` HMAC header |
| **hiai-observe** | Structured events (Writer/Carousel/API/MCP start/success/failure) | OTLP `/v1/logs` JSON + `Authorization: Bearer <key>` (see hiai-observe section below) |
| **Postiz** | Publication-intent submission / status sync (boundary only) | HTTP/JSON + `Authorization: Bearer <key>` (see Postiz section below) |
### SSE Real-time Events

The `events.ts` route provides Server-Sent Events for real-time publish status updates:

```typescript
// Event types emitted
event: publish_status     → { postId, status, platform }
event: connected          → { clientId, timestamp }
event: error              → { postId, error }
```

Heartbeat every 30 seconds. Clients disconnected after 90 seconds without response.

### hiai-store → hiai-post Webhook Integration

hiai-store pushes new-product events into hiai-post over a single inbound
webhook. The receiver creates a `draft` post so the merchant can review,
edit, and schedule from the existing Post Editor without re-keying product
data. hiai-post does **not** poll hiai-store.

```
┌──────────────────────┐    POST /api/v1/webhooks/store-product     ┌──────────────────────┐
│      hiai-store      │ ─────────────────────────────────────────▶ │  hiai-post          │
│                      │    X-Webhook-Secret: <HIAI_STORE_…>        │  webhooksRoutes     │
│ product.created /    │    body: { tenantId, productId,           │                      │
│ product.updated      │            productName, productUrl,        │  1. Verify secret    │
│                      │            productImage?, platform }       │     (timingSafeEqual)│
│                      │                                            │  2. Zod-validate     │
│                      │                                            │  3. Hash             │
│                      │                                            │     (tenantId,       │
│                      │                                            │      productId,      │
│                      │                                            │      platform)       │
│                      │                                            │  4. Dedup lookup on  │
│                      │                                            │     posts.contentHash│
│                      │                                            │  5. INSERT draft     │
│                      │ ◀──────────────────────────────────────── │     with mediaUrls = │
│                      │    201 { post }  /  200 { deduplicated }  │     [productImage?]  │
└──────────────────────┘                                            └──────────────────────┘
```

Properties:
- **Auth**: `X-Webhook-Secret` header compared in constant time against
  `HIAI_STORE_WEBHOOK_SECRET`. No user `Authorization` header is required.
- **Idempotency**: `SHA-256(tenantId:productId:platform).slice(0,16)` is
  stored in `posts.content_hash`. Re-deliveries return the original post.
- **Failure isolation**: webhook is registered **outside** the
  auth/tenant/rate-limit middleware stack — it cannot be throttled by
  per-tenant limits.
- **Audit trail**: every successful webhook INSERT is captured by the
  audit middleware (`POST /api/v1/webhooks/store-product`,
  `resource_id = post.id`).

### Audit Middleware

`backend/src/api/middleware/audit.ts` is registered globally inside the
protected app, **after** `auth` and `tenant` so it can read `ctx.user.id`
and `ctx.tenantId`. It hooks `onAfterHandle` and only writes when:

1. The HTTP method is `POST`, `PUT`, `PATCH`, or `DELETE`.
2. The final response status is `< 400`.

Captured columns (mapped to `audit_logs`):

| Column | Source |
|--------|--------|
| `tenant_id` | `ctx.tenantId` (tenant middleware) |
| `actor_id`  | `ctx.user.id` (auth middleware) |
| `action`    | HTTP method upper-cased |
| `resource`  | request path (e.g. `/api/v1/posts/:id`) |
| `resource_id` | last path segment if it looks like a UUID or opaque id |
| `metadata`  | sanitized body summary + query + status + content-type |
| `ip_address` | first `X-Forwarded-For` entry, else `X-Real-IP` |

Sensitive keys (`password`, `token`, `access_token`, `refresh_token`,
`authorization`, `secret`, `api_key`, `private_key`, `signature`,
`cookie`, `set-cookie`) are redacted to `[redacted]` before storage;
string bodies are truncated at 500 chars. Audit writes are best-effort:
a DB failure is logged via pino but never breaks the user request.

---

## Authentication Flow

```
Request → auth middleware
    │
    │ 1. Extract Bearer token from Authorization header
    ▼
    │ 2. POST to Better Auth /api/auth/get-session
    │    with token in Authorization and Cookie headers
    ▼
    │ 3. If session valid → extract user info
    │    If invalid → 401
    ▼
Request → tenant middleware
    │
    │ 1. Extract X-Tenant-Id header
    │ 2. Validate UUID format
    ▼
Handler → tenantId available in context
```

---

## Security Architecture

### HTTP Security Headers

Applied by `secureHeaders.ts` middleware:

| Header | Value | Purpose |
|--------|-------|---------|
| Content-Security-Policy | Restricted default-src | Prevent XSS |
| X-Content-Type-Options | nosniff | Prevent MIME sniffing |
| X-Frame-Options | DENY | Prevent clickjacking |
| Referrer-Policy | strict-origin-when-cross-origin | Limited referrer leakage |
| Strict-Transport-Security | max-age=63072000 (prod) | Enforce HTTPS |
| Permissions-Policy | Restricted features | Limit API access |
| Cross-Origin-Opener-Policy | same-origin | Isolate cross-origin windows |
| Cross-Origin-Resource-Policy | same-site | Restrict resource sharing |

### Rate Limiting

Redis-backed, per-IP rate limiting with configurable tiers:

| Tier | Window | Max | Scope |
|------|--------|-----|-------|
| auth | 15 min | 5 | Auth endpoints |
| public | 1 min | 100 | Health checks |
| authenticated | 1 min | 300 | Main CRUD |
| publish | 1 min | 20 | Publish actions |
| generate | 1 hour | 50 | AI generation |

Fail-open behavior: if Redis is down, rate limiter allows requests and logs a warning.

### Token Encryption

- OAuth tokens encrypted with AES-256-GCM before storage
- Encryption key is environment variable (32 bytes)
- Decryption only in publisher context, never exposed via API
- Token refresh in background worker

---

## Directory Layout Reference

```
hiai-post/
  backend/              # Elysia API server
    src/
      api/              # Routes, middleware, validation
      core/             # Business logic (scheduler, publisher, analytics)
      db/               # Drizzle ORM schema and migrations
      integrations/     # Social platform API clients
      mastra/           # AI workflows, agents, tools
      lib/              # Shared utilities
      workers/          # Background workers
    Dockerfile
    package.json
    tsconfig.json
  app/                  # SvelteKit frontend
    src/
      routes/           # Page components
      lib/              # Components, stores, API client
    Dockerfile
    package.json
  docs/                 # Documentation
  packages/             # Shared workspace packages
  docker-compose.yml
  package.json          # Workspace root
```
