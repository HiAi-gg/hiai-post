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
│                    hiai-post-api (Elysia)                         │
│                         Port 50300                                │
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │ Accounts │ │  Posts   │ │Content   │ │Campaigns │ │Templates│ │
│  │ Route    │ │  Route   │ │Plans R.  │ │ Route    │ │ Route   │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬───┘ │
│       │            │            │            │            │      │
│  ┌────▼────────────▼────────────▼────────────▼────────────▼────┐ │
│  │                     Middleware Stack                          │ │
│  │  auth.ts · tenant.ts · rateLimiter.ts · secureHeaders.ts     │ │
│  └────────────────────────────┬─────────────────────────────────┘ │
│                               │                                   │
│  ┌────────────────────────────▼─────────────────────────────────┐ │
│  │                     Core Business Logic                       │ │
│  │                                                               │ │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐   │ │
│  │  │  Publisher   │  │  Scheduler   │  │  Analytics         │   │ │
│  │  │  (platform   │  │  (Redis      │  │  Aggregator        │   │ │
│  │  │   adapters)  │  │   sorted     │  │  (platform APIs)   │   │ │
│  │  └──────┬──────┘  │   sets)      │  └────────────────────┘   │ │
│  │         │         └──────────────┘                            │ │
│  │  ┌──────▼──────┐                                             │ │
│  │  │ Mastra AI   │                                             │ │
│  │  │ Workflows   │                                             │ │
│  │  └─────────────┘                                             │ │
│  └────────────────────────────┬─────────────────────────────────┘ │
│                               │                                   │
│  ┌────────────────────────────▼─────────────────────────────────┐ │
│  │                     Data Access Layer                         │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │ │
│  │  │  Drizzle  │  │  Redis   │  │  MinIO   │  │  Integration │ │ │
│  │  │  ORM      │  │  Client  │  │  Client  │  │  Clients     │ │ │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘ │ │
│  └───────┼─────────────┼──────────────┼────────────────┼─────────┘ │
└──────────┼─────────────┼──────────────┼────────────────┼───────────┘
           │             │              │                │
           ▼             ▼              ▼                ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────────┐
    │PostgreSQL│  │  Redis   │  │  MinIO   │  │   Platform APIs   │
    │+pgvector │  │ 8.6+     │  │ (Object  │  │ IG · TikTok · X   │
    │  18.4    │  │          │  │  Store)  │  │ LI · FB · TG · YT │
    └──────────┘  └──────────┘  └──────────┘  │ Threads · Pins    │
                                               └───────────────────┘
```

---

## Module Boundaries

### Backend Modules (`backend/src/`)

| Module | Directory | Responsibility |
|--------|-----------|----------------|
| **API Routes** | `api/routes/` | HTTP request handlers, validation, response formatting |
| **Middleware** | `api/middleware/` | Auth, rate limiting, tenant scoping, security headers, logging |
| **Publisher** | `core/publisher/` | Platform-specific publishing adapters |
| **Scheduler** | `core/scheduler/` | Redis queue, cron-based poller, retry logic |
| **Analytics** | `core/analytics/` | Engagement metrics aggregation from platform APIs |
| **DB** | `db/` | Drizzle ORM schema definitions, migrations, client |
| **Integrations** | `integrations/` | Social platform API clients (one directory per platform) |
| **Mastra** | `mastra/` | AI workflows, agents, tools |
| **Lib** | `lib/` | Shared utilities (config, encryption, platform rules, etc.) |
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
| **hiai-store** | Event-driven (webhooks) | HTTP/JSON |
| **hiai-observe** | Error reporting | Sentry-compatible DSN |
| **MinIO** | Object storage | S3-compatible API |

### SSE Real-time Events

The `events.ts` route provides Server-Sent Events for real-time publish status updates:

```typescript
// Event types emitted
event: publish_status     → { postId, status, platform }
event: connected          → { clientId, timestamp }
event: error              → { postId, error }
```

Heartbeat every 30 seconds. Clients disconnected after 90 seconds without response.

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
