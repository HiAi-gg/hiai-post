# TODO — hiai-post

> **Generated:** 2026-05-23
> **Goal:** Build social media content planning and publishing module for HiAi
> **Stack:** Bun 1.3.14+, Elysia 1.4.28+, Drizzle ORM 0.45.2+, PostgreSQL 18.4 + pgvector, Redis 8.6+, Svelte 5 + SvelteKit 2.60+, Mastra 1.36+, Better Auth

---

## Phase 0 — Foundation

**Goal:** Project scaffold with working dev environment, database, and auth.

- [ ] 0.1 Create `package.json` with all dependencies (bun, elysia, drizzle-orm, zod, better-auth, mastra, minio, sharp, ioredis)
- [ ] 0.2 Create `tsconfig.json` (ESNext module, bundler resolution, strict mode)
- [ ] 0.3 Create `drizzle.config.ts` pointing to `hiai_post` database
- [ ] 0.4 Create `docker-compose.yml` — API service, frontend service, PostgreSQL 18.4, Redis 8.6+
- [ ] 0.5 Create `.env.example` with all required environment variables (see README.md)
- [ ] 0.6 Create `.gitignore` (node_modules, .env, dist, .svelte-kit, .next)
- [ ] 0.7 Create `src/api/index.ts` — Elysia server entry point with CORS, health check
- [ ] 0.8 Create `src/db/index.ts` — Drizzle database client singleton with connection pooling
- [ ] 0.9 Create `src/db/schema.ts` — Base tables (tenants, audit_logs)
- [ ] 0.10 Create `src/api/middleware/auth.ts` — Better Auth JWT verification + tenant context
- [ ] 0.11 Create `src/api/middleware/tenant.ts` — Multi-tenant scoping middleware
- [ ] 0.12 Create `src/api/middleware/rateLimiter.ts` — Redis-backed rate limiter (reuse webs pattern)
- [ ] 0.13 Scaffold SvelteKit frontend in `app/` with shadcn-svelte + Tailwind CSS v4
- [ ] 0.14 Create `src/lib/encryption.ts` — AES-256-GCM token encryption/decryption utilities
- [ ] 0.15 Verify: `bun install` succeeds, `bunx tsc --noEmit` passes, `docker compose up -d` starts, health check returns 200

---

## Phase 1 — Core Models

**Goal:** Database schemas and CRUD routes for all core entities.

### Database Schemas (Drizzle ORM)

- [ ] 1.1 `social_accounts` table — id, tenant_id, platform (enum), account_id, username, display_name, avatar_url, access_token (encrypted), refresh_token (encrypted), token_expires_at, scopes, status (active/expired/revoked), connected_at, updated_at
- [ ] 1.2 `posts` table — id, tenant_id, social_account_id (FK), content_text, content_json (Tipex), media_urls (jsonb), platform, status (draft/scheduled/publishing/published/failed), scheduled_at, published_at, platform_post_id, error_message, content_hash, created_at, updated_at
- [ ] 1.3 `content_plans` table — id, tenant_id, title, description, date, slot_time, post_id (FK nullable), campaign_id (FK nullable), status (planned/draft/published), created_at, updated_at
- [ ] 1.4 `campaigns` table — id, tenant_id, name, description, start_date, end_date, status (draft/active/completed/paused), created_at, updated_at
- [ ] 1.5 `post_templates` table — id, tenant_id, name, platform, content_text, ai_prompt, variables (jsonb), created_at, updated_at
- [ ] 1.6 `post_analytics` table — id, post_id (FK), platform, impressions, reach, engagement_rate, likes, comments, shares, clicks, saves, fetched_at
- [ ] 1.7 `publish_queue` table (optional backup to Redis) — id, post_id (FK), scheduled_for, attempts, last_error, status (pending/processing/completed/failed), created_at
- [ ] 1.8 `audit_logs` table — id, tenant_id, actor_id, action, resource, resource_id, metadata (jsonb), ip_address, created_at
- [ ] 1.9 Drizzle relations definitions for all tables
- [ ] 1.10 SQL migration files for all schemas
- [ ] 1.11 Seed script with sample tenants, accounts, posts for development

### CRUD Routes

- [ ] 1.12 `src/api/routes/accounts.ts` — GET (list), GET/:id, POST (create), PUT/:id, DELETE/:id for social_accounts
- [ ] 1.13 `src/api/routes/posts.ts` — GET (list with filters), GET/:id, POST (create), PUT/:id, DELETE/:id for posts
- [ ] 1.14 `src/api/routes/content-plans.ts` — CRUD for content_plans with date range queries
- [ ] 1.15 `src/api/routes/campaigns.ts` — CRUD for campaigns
- [ ] 1.16 `src/api/routes/templates.ts` — CRUD for post_templates
- [ ] 1.17 `src/api/routes/health.ts` — Health check with DB and Redis connectivity
- [ ] 1.18 Verify: all CRUD endpoints pass manual testing, `bunx tsc --noEmit` clean

---

## Phase 2 — OAuth Flows

**Goal:** Secure OAuth 2.0 connection flows for all social platforms.

- [ ] 2.1 `src/integrations/instagram/` — Instagram Graph API client (OAuth 2.0, long-lived tokens, token refresh)
- [ ] 2.2 `src/integrations/tiktok/` — TikTok Login Kit client (OAuth 2.0 + PKCE)
- [ ] 2.3 `src/integrations/x/` — X API v2 client (OAuth 2.0 + PKCE, 2-hour tokens with refresh)
- [ ] 2.4 `src/integrations/linkedin/` — LinkedIn Marketing API client (OAuth 2.0, 60-day tokens)
- [ ] 2.5 `src/integrations/facebook/` — Facebook Graph API client (OAuth 2.0, long-lived tokens)
- [ ] 2.6 `src/integrations/telegram/` — Telegram Bot API client (bot token verification)
- [ ] 2.7 `src/api/routes/oauth.ts` — OAuth initiation and callback routes for all platforms
- [ ] 2.8 Token encryption: all access/refresh tokens encrypted with AES-256-GCM before storage
- [ ] 2.9 Token refresh scheduler: check and refresh tokens 5 minutes before expiry
- [ ] 2.10 OAuth state parameter with CSRF protection (signed JWT, 5-minute TTL)
- [ ] 2.11 Account disconnection: revoke tokens on platform where possible, clean up local data
- [ ] 2.12 Verify: OAuth flow completes for at least 2 platforms (Instagram + Telegram), tokens stored encrypted

---

## Phase 3 — Queue & Scheduler

**Goal:** Reliable publish queue with retry logic and timezone-aware scheduling.

- [ ] 3.1 `src/core/scheduler/queue.ts` — Redis sorted set queue (score = unix timestamp, key = `publish_queue:{tenant_id}`)
- [ ] 3.2 `src/core/scheduler/publisher.ts` — Cron publisher: every minute, pop posts where `publish_at <= now()`
- [ ] 3.3 `src/core/scheduler/retry.ts` — Exponential backoff retry (3 attempts: 1min, 5min, 15min)
- [ ] 3.4 `src/core/scheduler/dead-letter.ts` — Dead letter queue for permanently failed posts
- [ ] 3.5 `src/core/scheduler/rate-limiter.ts` — Per-platform sliding window rate limiters (IG: 200/hr, X: 300/15min, LI: 100/day, etc.)
- [ ] 3.6 `src/lib/timezone.ts` — Timezone conversion helpers (store UTC, display merchant local time)
- [ ] 3.7 `src/lib/idempotency.ts` — Idempotency key generation from (social_account_id, content_hash)
- [ ] 3.8 Schedule management API: POST /api/v1/posts/:id/schedule, POST /api/v1/posts/:id/cancel-schedule
- [ ] 3.9 Queue status API: GET /api/v1/queue/status (pending, processing, failed counts per tenant)
- [ ] 3.10 SSE endpoint: `/api/v1/events` for real-time publish status updates
- [ ] 3.11 Verify: schedule a post for 1 minute in the future, confirm it publishes, confirm retry works on failure

---

## Phase 4 — Mastra Integration

**Goal:** AI content generation workflows using Mastra 1.36+.

- [ ] 4.1 `src/mastra/index.ts` — Mastra instance setup (singleton, LLM providers, tools registration)
- [ ] 4.2 `src/lib/platform-rules.ts` — Platform content rules for all 6 platforms (character limits, hashtag counts, emoji ranges, content format)
- [ ] 4.3 `src/mastra/workflows/content-generate.ts` — Full pipeline: extract-params → content-write → duplicate-check → platform-format → polish-output
- [ ] 4.4 `src/mastra/workflows/platform-format.ts` — Parallel platform adaptation using `platform-rules.ts` with `Promise.allSettled()`
- [ ] 4.5 `src/mastra/workflows/duplicate-check.ts` — Three-tier dedup: title overlap (0.7) + pgvector semantic (0.85) + template match
- [ ] 4.6 `src/mastra/agents/writer.ts` — Content writer agent with platform-native conventions
- [ ] 4.7 `src/mastra/agents/optimizer.ts` — Post optimizer agent (improve engagement, suggest hashtags)
- [ ] 4.8 `src/mastra/tools/web-search.ts` — Trend research tool for content context
- [ ] 4.9 `src/mastra/tools/image-gen.ts` — Image generation tool for post media
- [ ] 4.10 `src/api/routes/generate.ts` — POST /api/v1/posts/generate endpoint (topic → multi-platform posts)
- [ ] 4.11 `src/api/routes/templates/:id/generate` — Generate post from template with AI
- [ ] 4.12 Verify: generate a post from topic "new product launch", confirm platform-specific output for Instagram + X

---

## Phase 5 — Publishing Adapters

**Goal:** Platform-specific publishing via API and agent-browser fallback.

- [ ] 5.1 `src/core/publisher/instagram.ts` — Publish posts, stories, reels, carousels via Graph API
- [ ] 5.2 `src/core/publisher/tiktok.ts` — Publish videos via Content Posting API
- [ ] 5.3 `src/core/publisher/x.ts` — Publish tweets, threads, media via API v2
- [ ] 5.4 `src/core/publisher/linkedin.ts` — Publish posts and articles via Marketing API
- [ ] 5.5 `src/core/publisher/facebook.ts` — Publish posts and stories via Graph API
- [ ] 5.6 `src/core/publisher/telegram.ts` — Publish messages and media via Bot API
- [ ] 5.7 `src/core/publisher/index.ts` — Publisher registry: maps platform enum to adapter
- [ ] 5.8 `src/api/routes/posts/:id/publish` — Publish now endpoint
- [ ] 5.9 Platform webhook endpoints for delivery confirmations and errors
- [ ] 5.10 Verify: publish a test post to Telegram (simplest API), confirm delivery

---

## Phase 6 — Frontend

**Goal:** Complete SvelteKit frontend with all major pages.

### Layout & Navigation

- [ ] 6.1 `app/src/routes/+layout.svelte` — Main layout with sidebar navigation, header, tenant selector
- [ ] 6.2 `app/src/lib/components/Sidebar.svelte` — Navigation sidebar (Dashboard, Posts, Plans, Accounts, Analytics, Templates)
- [ ] 6.3 `app/src/lib/api.ts` — Typed API client with auth headers and error handling
- [ ] 6.4 `app/src/lib/stores/auth.svelte.ts` — Authentication state management

### Dashboard

- [ ] 6.5 `app/src/routes/dashboard/+page.svelte` — Overview with upcoming posts, recent activity, quick stats
- [ ] 6.6 `app/src/lib/components/Calendar.svelte` — Drag-and-drop content calendar (monthly/weekly/daily views)
- [ ] 6.7 `app/src/lib/components/UpcomingPosts.svelte` — List of next scheduled posts

### Posts

- [ ] 6.8 `app/src/routes/posts/+page.svelte` — Post list with filters (status, platform, date range)
- [ ] 6.9 `app/src/routes/posts/new/+page.svelte` — Create new post
- [ ] 6.10 `app/src/routes/posts/[id]/+page.svelte` — Edit post
- [ ] 6.11 `app/src/lib/components/PostEditor.svelte` — Tipex rich text editor + AI generation panel + media upload
- [ ] 6.12 `app/src/lib/components/PlatformPreview.svelte` — Preview post appearance per platform

### Content Plans

- [ ] 6.13 `app/src/routes/content-plans/+page.svelte` — Content plan list with calendar integration
- [ ] 6.14 `app/src/lib/stores/posts.svelte.ts` — Post state management with Svelte 5 runes

### Social Accounts

- [ ] 6.15 `app/src/routes/accounts/+page.svelte` — Connected accounts list with connect/disconnect actions
- [ ] 6.16 `app/src/lib/components/PlatformCard.svelte` — Social account card (avatar, status, platform icon)
- [ ] 6.17 `app/src/lib/components/ConnectAccountModal.svelte` — OAuth connection flow modal

### Templates

- [ ] 6.18 `app/src/routes/templates/+page.svelte` — Template list with create/edit
- [ ] 6.19 `app/src/lib/components/TemplateEditor.svelte` — Template editor with AI prompt configuration

### Analytics

- [ ] 6.20 `app/src/routes/analytics/+page.svelte` — Analytics overview with charts
- [ ] 6.21 `app/src/lib/components/AnalyticsChart.svelte` — LayerChart wrapper for engagement metrics

- [ ] 6.22 Verify: all pages render, navigation works, post creation flow end-to-end

---

## Phase 7 — Analytics

**Goal:** Engagement metrics collection and performance dashboard.

- [ ] 7.1 `src/core/analytics/collector.ts` — Fetch engagement metrics from platform APIs (scheduled job)
- [ ] 7.2 `src/core/analytics/instagram-analytics.ts` — Instagram insights API integration
- [ ] 7.3 `src/core/analytics/x-analytics.ts` — X engagement metrics
- [ ] 7.4 `src/core/analytics/linkedin-analytics.ts` — LinkedIn post statistics
- [ ] 7.5 `src/core/analytics/aggregator.ts` — Cross-platform metrics aggregation
- [ ] 7.6 `src/api/routes/analytics.ts` — GET /api/v1/analytics/overview, /api/v1/analytics/posts/:id
- [ ] 7.7 Analytics dashboard: engagement rate, reach, impressions, CTR per post and platform
- [ ] 7.8 Best posting time analysis based on historical engagement data
- [ ] 7.9 Campaign performance comparison (side-by-side metrics)
- [ ] 7.10 Verify: analytics data populates for published posts, charts render correctly

---

## Phase 8 — Campaign Management

**Goal:** Group posts into campaigns with coordinated scheduling.

- [ ] 8.1 Campaign creation wizard with date range and platform selection
- [ ] 8.2 Bulk post scheduling within campaign (content plan → campaign)
- [ ] 8.3 Campaign progress tracking (published / remaining / failed counts)
- [ ] 8.4 Campaign analytics aggregation (total reach, engagement across all posts)
- [ ] 8.5 Campaign pause/resume functionality
- [ ] 8.6 Verify: create campaign with 5 posts, schedule across 3 days, confirm progress tracking

---

## Phase 9 — Polish & Testing

**Goal:** Test coverage, documentation, Docker optimization, CI/CD.

### Testing

- [ ] 9.1 Unit tests for `src/lib/encryption.ts` (encrypt/decrypt round-trip)
- [ ] 9.2 Unit tests for `src/lib/platform-rules.ts` (all platform constraints)
- [ ] 9.3 Unit tests for `src/core/scheduler/queue.ts` (enqueue, dequeue, retry)
- [ ] 9.4 Unit tests for `src/core/scheduler/rate-limiter.ts` (sliding window)
- [ ] 9.5 Integration tests for all CRUD routes (accounts, posts, content-plans, campaigns, templates)
- [ ] 9.6 Integration tests for OAuth flow (mock token exchange)
- [ ] 9.7 Integration tests for publish queue (schedule → publish → status update)
- [ ] 9.8 Mastra workflow tests (content generation pipeline end-to-end)

### Documentation

- [ ] 9.9 Update README.md with final API endpoints and setup instructions
- [ ] 9.10 Create `docs/API.md` — Full API reference with request/response examples
- [ ] 9.11 Create `docs/ARCHITECTURE.md` — System architecture diagram and data flow
- [ ] 9.12 Create `docs/PLATFORM_RULES.md` — Platform content rules reference

### Docker & CI

- [ ] 9.13 Create `Dockerfile` for API (multi-stage build, Bun runtime)
- [ ] 9.14 Create `Dockerfile` for frontend (SvelteKit build + node adapter)
- [ ] 9.15 Add health checks to all Docker services
- [ ] 9.16 Add resource limits to docker-compose services
- [ ] 9.17 Create `.github/workflows/ci.yml` — lint, typecheck, test, build on push

### Security

- [ ] 9.18 Audit all routes for auth middleware coverage
- [ ] 9.19 Verify encrypted token storage for all platforms
- [ ] 9.20 Add CSP headers and security middleware
- [ ] 9.21 Rate limit all public endpoints
- [ ] 9.22 Verify: `bun test` passes all tests, `bunx tsc --noEmit` clean, Docker build succeeds

---

## Metrics Target

| Metric | Target |
|--------|--------|
| TypeScript errors | 0 |
| Tests passing | 100% |
| API endpoints | ~25 |
| Frontend pages | 8 |
| DB tables | 8 |
| Supported platforms | 6 |
| Docker services | 4 (api, frontend, postgres, redis) |

---

## Phase 10: Critic Audit Fixes (2026-05-25)

> **Source:** 6 parallel critics audited plugin integration, dual-mode layout, backend workers, and completeness.
> **Result:** 7 PASS, 1 MISS, 4 WARNING

### 10.1 Plugin + Dual-Mode — ✅ PASS (no action needed)
- [x] Plugin manifest exports valid object (id, name, version, icon, navGroups, proxy)
- [x] Config with mode detection (PUBLIC_HIAI_MODE)
- [x] Dual-mode layout (standalone with AdminSidebar, unified without)
- [x] @hiai/ui migration (api.ts, auth store — clean re-exports)

### 10.2 Backend Workers — ✅ PASS (no action needed)
- [x] OAuth refresh worker — 5 platforms (Meta, X, LinkedIn, Threads, Pinterest)
- [x] Dead-letter processor — max 3 retries, exponential backoff
- [x] Cross-platform analytics — engagement rate, top posts per platform
- [x] Workers started in index.ts

### 10.3 MISSING: YouTube Publishers
- [ ] **Create YouTube Shorts publisher adapter** in `backend/src/core/publisher/`
  - Platform rules already define `youtube-shorts-script` in `backend/src/lib/platform-rules.ts`
  - Need: `youtube.ts` adapter using YouTube Data API v3
  - Auth: OAuth 2.0 with `youtube.upload` scope
  - **Effort:** ~6h
- [ ] **Create YouTube Long-form publisher adapter**
  - Platform rules define `youtube-long` content type
  - Same API, different video parameters (longer duration, different thumbnail)
  - **Effort:** ~4h
- [ ] **Add YouTube to SupportedPlatform type** in `backend/src/core/publisher/index.ts`
- [ ] **Add YouTube OAuth config** in `backend/src/api/routes/oauth.ts`

### 10.4 WARNING: Env var naming mismatch
- [ ] **Fix OAuth refresh worker** — change `process.env.FACEBOOK_APP_ID` to `process.env.META_APP_ID`
- [ ] **Fix OAuth refresh worker** — change `process.env.FACEBOOK_APP_SECRET` to `process.env.META_APP_SECRET`
- [ ] **Update .env.example** with correct META_* variable names
- **File:** `backend/src/workers/oauth-refresh.ts`
- **Effort:** 15min

### 10.5 WARNING: X API endpoint outdated
- [ ] **Fix X refresh endpoint** — change `https://api.twitter.com/2/oauth2/token` to `https://api.x.com/2/oauth2/token`
- **File:** `backend/src/workers/oauth-refresh.ts`
- **Effort:** 5min

### 10.6 WARNING: Plugin manifest not typed
- [ ] **Add type annotation** to plugin manifest — use `as const` or define local type
- **File:** `app/src/lib/plugin.ts`
- **Effort:** 10min

### 10.7 WARNING: Nav icons mismatch
- [ ] **Sync icons** between `app/src/lib/plugin.ts` and `app/src/routes/+layout.svelte`
  - Accounts: 🔗 (plugin) vs 👤 (layout) — pick one
  - Campaigns: 🎯 (plugin) vs 📢 (layout) — pick one
- **Files:** `app/src/lib/plugin.ts`, `app/src/routes/+layout.svelte`
- **Effort:** 5min

### 10.8 WARNING: OAuth refresh worker issues
- [ ] **Add fetch timeout** (10s AbortController) to all platform API calls — violates `feedback_fetch_timeout_required.md`
- [ ] **Add HTTP 429 handling** — log warning and skip account, don't crash
- [ ] **Validate token response** — check `access_token` exists before using
- **File:** `backend/src/workers/oauth-refresh.ts`
- **Effort:** 1h

### 10.9 WARNING: Dead-letter retry encoding fragile
- [ ] **Use JSON encoding** for retry metadata instead of `retry:N:lastError` string parsing
  - Change to: `{ retryCount: N, lastError: "..." }`
  - Add migration for existing encoded values
- **File:** `backend/src/workers/dead-letter.ts`
- **Effort:** 30min

### 10.10 WARNING: Cross-platform analytics performance
- [ ] **Add caching** to cross-platform analytics endpoint (Redis, 5min TTL)
- [ ] **Optimize top posts query** — use `DISTINCT ON (platform)` instead of fetching all + JS filter
- **File:** `backend/src/modules/analytics/cross-platform.ts`
- **Effort:** 1h

---

## Summary (Updated)

| Phase | Description | Effort | Status |
|-------|-------------|--------|--------|
| 0-9 | Original phases | ~106h | See above |
| 10 | Critic audit fixes | ~14h | **NEW** |
| **Total** | | **~120h** | |

---

## Phase 10: Critic Audit Fixes (2026-05-25)

> **Source:** 6 critics audited plugin integration, dual-mode layout, backend workers, and completeness.
> **Result:** 7 PASS, 4 WARN, 1 MISS

### 10.1 Plugin + Config + Dual-Mode — PASS
- [x] Plugin manifest (`app/src/lib/plugin.ts`) — valid object
- [x] Config (`app/src/lib/config.ts`) — mode detection works
- [x] Dual-mode layout (`app/src/routes/+layout.svelte`) — standalone/unified
- [x] @hiai/ui migration (`app/src/lib/api.ts`, `stores/auth.svelte.ts`)

### 10.2 Backend Workers — PASS
- [x] OAuth refresh worker — 5 platforms (Meta, X, LinkedIn, Threads, Pinterest)
- [x] Dead-letter processor — 3 retries, exponential backoff
- [x] Cross-platform analytics — engagement rate, top posts
- [x] Backend wiring — workers started in `index.ts`

### 10.3 WARNING: OAuth env var naming
- [ ] `backend/src/workers/oauth-refresh.ts` — uses `FACEBOOK_APP_ID` instead of `META_APP_ID`
- [ ] Fix: change all `FACEBOOK_*` env vars to `META_*`

### 10.4 WARNING: X API endpoint
- [ ] `backend/src/workers/oauth-refresh.ts` — uses `api.twitter.com` instead of `api.x.com`
- [ ] Fix: update to `https://api.x.com/2/oauth2/token`

### 10.5 WARNING: Plugin manifest not typed
- [ ] `app/src/lib/plugin.ts` — exports plain object without `HiAiPlugin` type
- [ ] Fix: add `as const` or import type from hiai-admin

### 10.6 WARNING: Fetch timeouts missing
- [ ] `backend/src/workers/oauth-refresh.ts` — no timeout on platform API calls
- [ ] Fix: add `AbortController` with 10s timeout per `feedback_fetch_timeout_required.md`

### 10.7 WARNING: Nav icon mismatch
- [ ] `app/src/lib/plugin.ts` vs `app/src/routes/+layout.svelte` — different icons for Accounts and Campaigns
- [ ] Fix: sync icons between manifest and layout

### 10.8 MISSING: YouTube Publishers
- [ ] `backend/src/core/publisher/` — no YouTube Shorts or YouTube Long adapters
- [ ] Platform rules define `youtube-shorts-script` and `youtube-long` but no publisher implementation
- [ ] Priority: MEDIUM

### 10.9 WARNING: Dead-letter retry encoding
- [ ] `backend/src/workers/dead-letter.ts` — encodes retry count in `errorMessage` field as `retry:N:lastError`
- [ ] Fragile string parsing — breaks if error message contains `retry:` prefix
- [ ] Fix: use dedicated `retry_count` column or JSON encoding

### 10.10 WARNING: Rate limit handling
- [ ] `backend/src/workers/oauth-refresh.ts` — no HTTP 429 handling
- [ ] Fix: detect 429 and back off per-platform

---

**Estimated effort for Phase 10:** ~8h
**Priority:** MEDIUM (warnings don't block functionality)
