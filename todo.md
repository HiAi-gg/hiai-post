# hiai-post — todo.md

> **Живой статус задач.** Обновляется при каждой сессии.
> **Связано:** [AGENTS.md](./AGENTS.md) · [INDEX.md](../../INDEX.md)

> 🧭 **Живой статус этого проекта.** Стратегия и план — в корне `projects/`:
> [`HIAI_PROJECTS_ROADMAP.md`](../HIAI_PROJECTS_ROADMAP.md) (раздел «hiai-post», фазы P0–P3) +
> [`HIAI_CONVENTIONS.md`](../HIAI_CONVENTIONS.md). Этот файл синхронизируется с ними.
> **Актуализировано:** 2026-06-22

> **Generated:** 2026-05-23
> **Last verified:** 2026-06-28 (Phase 11.1 committed; root `bun test` → `bunx vitest run`; `.env.example` synced with documented env vars)
> **Goal:** Build social media content planning and publishing module for HiAi
> **Stack:** Bun 1.3.14+, Elysia 1.4.28+, Drizzle ORM 0.45.2+, PostgreSQL 18.4 + pgvector, Redis 8.6+, Svelte 5 + SvelteKit 2.60+, Mastra 1.36+, Better Auth

---

## ✅ Выполнено (P0, P2, P3)

| ID | Задача | Статус | Источник |
|---|---|---|---|
| **P0** | ✅ Аудит реального статуса (VERIFY.md/QUALITY/SECURITY снимки vs код) | DONE (2026-06-16) — реальный статус ясен, заглушки (Calendar DnD, LayerChart, SSE, Mastra tools) закрыты 2026-06-20 | [PROJECTS_ROADMAP §2 / P0](../../docs/archive/HIAI_PROJECTS_ROADMAP.md) |
| **P2** | ✅ Доведение продукта: реальные API-вызовы платформ, Mastra tools (Tavily + DALL-E 3), Calendar drag-and-drop, LayerChart интеграция, real SSE `ReadableStream`, OAuth refresh worker | DONE (2026-06-20) — Phase 10 (critic audit fixes) + Phase 11.1 shipped | [PROJECTS_ROADMAP §2 / P2](../../docs/archive/HIAI_PROJECTS_ROADMAP.md) |
| **P3** | ✅ Интеграция в hiai-admin (манифест v1.0.0, `comingSoon` removed, X-Tenant-Id + HS256 JWT auth) | DONE (2026-06-18, commits fcd9856+f3616dd) — plugin ready, proxy prefix `/api/social` | [PROJECTS_ROADMAP §2 / P3](../../docs/archive/HIAI_PROJECTS_ROADMAP.md) |
| **P3.1** | ✅ hiai-store ↔ hiai-post webhook (`POST /api/v1/webhooks/store-product`, HMAC, idempotency) + best posting times endpoint + audit middleware + per-tenant rate limiting | DONE (2026-06-20) — Phase 11.1 | [todo Phase 11.1](../../docs/archive/HIAI_PROJECTS_ROADMAP.md) |

> **Контекст:** Phases 0–10 (126h) + Wave 1 (Phase 11) shipped. CI: backend typecheck ✅, frontend typecheck ✅, frontend build ✅ (2.88s), tests ✅ (58/58). Детали — ниже в «Phase 0–11».

---

## 🟡 В процессе

| ID | Задача | Прогресс | Источник |
|---|---|---|---|
| **B-MIG-POST** | Миграция в hiai-admin host (live-интеграция) | ✅ DONE (verified 2026-06-22): P3 манифест ✅ + P3.1 webhook/audit ✅; остаётся **P3.2 — per-tenant proxy forwarding (X-Tenant-Id header)** — требует правки proxy в `hiai-admin` (forward header per-tenant) | B-MIG-POST контекст |
| **F1** | Извлечение `TipexEditor` в `@hiai/ui` | 🟡 DEFERRED — `TipexEditor` уже потребляется через `@hiai/ui` из hiai-admin (B1.2), формальное выделение отложено | [todo Phase 11 / F1](../../docs/archive/HIAI_PROJECTS_ROADMAP.md) |
| **F2** | Полная миграция `bun:test` → Vitest | ✅ **DONE** (2026-06-28): Vitest 2.1 в `backend/`, `bunx vitest run --coverage` в CI, root `package.json` `test` script → `bunx vitest run` | [todo Phase 11 / F2](../../docs/archive/HIAI_PROJECTS_ROADMAP.md) |

---

## 📋 Запланировано (продуктовое доведение)

| ID | Задача | Приоритет | Источник |
|---|---|---|---|
| **P3.2** | Per-tenant proxy forwarding (`X-Tenant-Id` header) в hiai-admin proxy | 🔴 блокер B-MIG-POST | [todo Phase 11 / P3.2](../../docs/archive/HIAI_PROJECTS_ROADMAP.md) |
| **P0.3** | Реальные LLM-вызовы (выход за placeholder-режим) | 🟡 средний — Phase 11.1 закрыл Mastra tools | [PROJECTS_ROADMAP §2 / P0.3](../../docs/archive/HIAI_PROJECTS_ROADMAP.md) |
| **P2.x** | Расширение real-платформенных API (все 6 платформ доведены до prod-grade, не только Telegram) | 🟡 средний | [PROJECTS_ROADMAP §2 / P2](../../docs/archive/HIAI_PROJECTS_ROADMAP.md) |
| **F3** | RBAC части (audit ✅, RBAC middleware — отложено) | 🟡 после B-MIG-POST | [todo Phase 11 / F4](../../docs/archive/HIAI_PROJECTS_ROADMAP.md) |

---

## 📚 Источники планов (архив)
- [`docs/archive/HIAI_PROJECTS_ROADMAP.md`](../../docs/archive/HIAI_PROJECTS_ROADMAP.md) — раздел «2. hiai-post» (фазы P0–P3) — статусы P0/P2/P3

---

## Phase 11 — Ecosystem Integration (2026-06-16 → 2026-06-20)

> **Source:** Comprehensive review of hiai-post against `HIAI_CONVENTIONS.md` + `HIAI_PROJECTS_ROADMAP.md`.
> **CI status:** backend typecheck ✅, frontend typecheck ✅, frontend build ✅, tests ✅ (58/58, Vitest).

- [x] P0: Audit real status — DONE
- [x] P0.2: Align with HIAI_CONVENTIONS.md — DONE
- [x] P1: UI unification (@hiai/ui + tokens.css) — DONE
- [x] P2: Product completion verification — DONE
- [x] P3: hiai-admin integration (manifest updated, comingSoon removed) — DONE
- [x] P3.1: hiai-store ↔ hiai-post webhook (POST /api/v1/webhooks/store-product) — DONE 2026-06-20
- [x] P3.1b: Best posting times endpoint (GET /api/v1/analytics/best-times) — DONE 2026-06-20
- [x] P3.1c: Audit middleware (POST/PUT/PATCH/DELETE → audit_logs, sensitive-key redaction) — DONE 2026-06-20
- [x] P3.1d: Per-tenant rate limiting (`backend/src/api/middleware/rateLimiter.ts` — tenant-keyed bucket partitioning, `X-RateLimit-Tenant` header) — DONE 2026-06-20
- [ ] P3.2: Per-tenant proxy forwarding (X-Tenant-Id header) — PENDING (requires hiai-admin proxy fix)
- [ ] F1: Extract TipexEditor to @hiai/ui — DEFERRED
- [x] F2: Migrate bun:test → Vitest — DONE 2026-06-28 (Vitest installed; CI uses `bunx vitest run --coverage`; root `bun test` script replaced)
- [x] F3: LayerChart migration — DONE 2026-06-20 (`BarChart` from `layerchart` integrated in `app/src/lib/components/AnalyticsChart.svelte`; `BestTimeChart.svelte` heatmap also live in `app/src/routes/analytics/+page.svelte`)
- [x] F4: Audit middleware shipped — DONE 2026-06-20 (RBAC parts deferred; audit ✅)

### 11.1 — Items added in this session (2026-06-20)

- [x] Add `POST /api/v1/webhooks/store-product` (Zod-validated, `X-Webhook-Secret` HMAC, SHA-256 idempotency on `(tenantId, productId, platform)`) → creates a `draft` post with `contentJson.source = "hiai-store-webhook"`.
- [x] Add `GET /api/v1/analytics/best-times` (`tenantId` + optional `platform`; up to 3 slots per platform from last 90 days of published-post engagement).
- [x] Add global `auditMiddleware` (`api/middleware/audit.ts`) — records `audit_logs` for state-changing requests with status < 400, redacts sensitive keys, best-effort writes.
- [x] Calendar drag-and-drop is **real** (native HTML5 `draggable` / `dragstart` / `dragover` / `dataTransfer` in `app/src/lib/components/Calendar.svelte`). Previously flagged as "не реализован" in 2026-05-23 audit — now ✅.
- [x] SSE `/api/v1/events` is **real** (in-memory client registry + `ReadableStream` controllers, 30 s heartbeat, 90 s timeout, per-tenant broadcast). Previously flagged as "заглушка" — now ✅.
- [x] Mastra tools are **real** (`web-search.ts`, `image-gen.ts` both wired into `mastra/index.ts`; content-generate workflow uses real `agent.generate()`, not placeholders). Previously flagged as "placeholder-ответы" — now ✅.
- [x] Switched `bun run lint` from ESLint to Biome 2.5 (`backend/package.json` + root); Vitest 2.1 added as dev dep (F2 partial — see below).
- [x] F2.1: Replace `bun test` invocation in CI with `bunx vitest run --coverage` (DONE in `.github/workflows/ci.yml`, 2026-06-20).
- [x] F3: LayerChart migration — `BarChart` from `layerchart` is wired into `app/src/lib/components/AnalyticsChart.svelte` (single-series bar chart with CSS-variable color via `var(--chart-1)`); `BestTimeChart.svelte` heatmap rendered in `app/src/routes/analytics/+page.svelte`. Previously flagged as "заглушки графиков" in 2026-05-23 audit — now ✅.
- [x] P3.1d: Per-tenant rate limiting is **real** — `backend/src/api/middleware/rateLimiter.ts` extracts `tenantId` from JWT (or `X-Tenant-Id` header as best-effort) and partitions the Redis bucket key as `ratelimit:{tenantId}:{endpoint}`; per-tenant response header `X-RateLimit-Tenant` is emitted on every decision.

---

## Phase 0 — Foundation

**Goal:** Project scaffold with working dev environment, database, and auth.

- [x] 0.1 Create `package.json` with all dependencies (bun, elysia, drizzle-orm, zod, better-auth, mastra, minio, sharp, ioredis)
- [x] 0.2 Create `tsconfig.json` (ESNext module, bundler resolution, strict mode)
- [x] 0.3 Create `drizzle.config.ts` pointing to `hiai_post` database
- [x] 0.4 Create `docker-compose.yml` — API service, frontend service, PostgreSQL 18.4, Redis 8.6+
- [x] 0.5 Create `.env.example` with all required environment variables (see README.md)
- [x] 0.6 Create `.gitignore` (node_modules, .env, dist, .svelte-kit, .next)
- [x] 0.7 Create `src/api/index.ts` — Elysia server entry point with CORS, health check
- [x] 0.8 Create `src/db/index.ts` — Drizzle database client singleton with connection pooling
- [x] 0.9 Create `src/db/schema.ts` — Base tables (tenants, audit_logs)
- [x] 0.10 Create `src/api/middleware/auth.ts` — Better Auth JWT verification + tenant context
- [x] 0.11 Create `src/api/middleware/tenant.ts` — Multi-tenant scoping middleware
- [x] 0.12 Create `src/api/middleware/rateLimiter.ts` — Redis-backed rate limiter (reuse webs pattern)
- [x] 0.13 Scaffold SvelteKit frontend in `app/` with shadcn-svelte + Tailwind CSS v4
- [x] 0.14 Create `src/lib/encryption.ts` — AES-256-GCM token encryption/decryption utilities
- [x] 0.15 Verify: `bun install` succeeds, `bunx tsc --noEmit` passes, `docker compose up -d` starts, health check returns 200

---

## Phase 1 — Core Models

**Goal:** Database schemas and CRUD routes for all core entities.

### Database Schemas (Drizzle ORM)

- [x] 1.1 `social_accounts` table — id, tenant_id, platform (enum), account_id, username, display_name, avatar_url, access_token (encrypted), refresh_token (encrypted), token_expires_at, scopes, status (active/expired/revoked), connected_at, updated_at
- [x] 1.2 `posts` table — id, tenant_id, social_account_id (FK), content_text, content_json (Tipex), media_urls (jsonb), platform, status (draft/scheduled/publishing/published/failed), scheduled_at, published_at, platform_post_id, error_message, content_hash, created_at, updated_at
- [x] 1.3 `content_plans` table — id, tenant_id, title, description, date, slot_time, post_id (FK nullable), campaign_id (FK nullable), status (planned/draft/published), created_at, updated_at
- [x] 1.4 `campaigns` table — id, tenant_id, name, description, start_date, end_date, status (draft/active/completed/paused), created_at, updated_at
- [x] 1.5 `post_templates` table — id, tenant_id, name, platform, content_text, ai_prompt, variables (jsonb), created_at, updated_at
- [x] 1.6 `post_analytics` table — id, post_id (FK), platform, impressions, reach, engagement_rate, likes, comments, shares, clicks, saves, fetched_at
- [x] 1.7 `publish_queue` table (optional backup to Redis) — id, post_id (FK), scheduled_for, attempts, last_error, status (pending/processing/completed/failed), created_at
- [x] 1.8 `audit_logs` table — id, tenant_id, actor_id, action, resource, resource_id, metadata (jsonb), ip_address, created_at
- [x] 1.9 Drizzle relations definitions for all tables
- [x] 1.10 SQL migration files for all schemas
- [x] 1.11 Seed script with sample tenants, accounts, posts for development

### CRUD Routes

- [x] 1.12 `src/api/routes/accounts.ts` — GET (list), GET/:id, POST (create), PUT/:id, DELETE/:id for social_accounts
- [x] 1.13 `src/api/routes/posts.ts` — GET (list with filters), GET/:id, POST (create), PUT/:id, DELETE/:id for posts
- [x] 1.14 `src/api/routes/content-plans.ts` — CRUD for content_plans with date range queries
- [x] 1.15 `src/api/routes/campaigns.ts` — CRUD for campaigns
- [x] 1.16 `src/api/routes/templates.ts` — CRUD for post_templates
- [x] 1.17 `src/api/routes/health.ts` — Health check with DB and Redis connectivity
- [x] 1.18 Verify: all CRUD endpoints pass manual testing, `bunx tsc --noEmit` clean

---

## Phase 2 — OAuth Flows

**Goal:** Secure OAuth 2.0 connection flows for all social platforms.

- [x] 2.1 `src/integrations/instagram/` — Instagram Graph API client (OAuth 2.0, long-lived tokens, token refresh)
- [x] 2.2 `src/integrations/tiktok/` — TikTok Login Kit client (OAuth 2.0 + PKCE)
- [x] 2.3 `src/integrations/x/` — X API v2 client (OAuth 2.0 + PKCE, 2-hour tokens with refresh)
- [x] 2.4 `src/integrations/linkedin/` — LinkedIn Marketing API client (OAuth 2.0, 60-day tokens)
- [x] 2.5 `src/integrations/facebook/` — Facebook Graph API client (OAuth 2.0, long-lived tokens)
- [x] 2.6 `src/integrations/telegram/` — Telegram Bot API client (bot token verification)
- [x] 2.7 `src/api/routes/oauth.ts` — OAuth initiation and callback routes for all platforms
- [x] 2.8 Token encryption: all access/refresh tokens encrypted with AES-256-GCM before storage
- [x] 2.9 Token refresh scheduler: check and refresh tokens 5 minutes before expiry
- [x] 2.10 OAuth state parameter with CSRF protection (signed JWT, 5-minute TTL)
- [x] 2.11 Account disconnection: revoke tokens on platform where possible, clean up local data
- [x] 2.12 Verify: OAuth flow completes for at least 2 platforms (Instagram + Telegram), tokens stored encrypted

---

## Phase 3 — Queue & Scheduler

**Goal:** Reliable publish queue with retry logic and timezone-aware scheduling.

- [x] 3.1 `src/core/scheduler/queue.ts` — Redis sorted set queue (score = unix timestamp, key = `publish_queue:{tenant_id}`)
- [x] 3.2 `src/core/scheduler/publisher.ts` — Cron publisher: every minute, pop posts where `publish_at <= now()`
- [x] 3.3 `src/core/scheduler/retry.ts` — Exponential backoff retry (3 attempts: 1min, 5min, 15min)
- [x] 3.4 `src/core/scheduler/dead-letter.ts` — Dead letter queue for permanently failed posts
- [x] 3.5 `src/core/scheduler/rate-limiter.ts` — Per-platform sliding window rate limiters (IG: 200/hr, X: 300/15min, LI: 100/day, etc.)
- [x] 3.6 `src/lib/timezone.ts` — Timezone conversion helpers (store UTC, display merchant local time)
- [x] 3.7 `src/lib/idempotency.ts` — Idempotency key generation from (social_account_id, content_hash)
- [x] 3.8 Schedule management API: POST /api/v1/posts/:id/schedule, POST /api/v1/posts/:id/cancel-schedule
- [x] 3.9 Queue status API: GET /api/v1/queue/status (pending, processing, failed counts per tenant)
- [x] 3.10 SSE endpoint: `/api/v1/events` for real-time publish status updates
- [x] 3.11 Verify: schedule a post for 1 minute in the future, confirm it publishes, confirm retry works on failure

---

## Phase 4 — Mastra Integration

**Goal:** AI content generation workflows using Mastra 1.36+.

- [x] 4.1 `src/mastra/index.ts` — Mastra instance setup (singleton, LLM providers, tools registration)
- [x] 4.2 `src/lib/platform-rules.ts` — Platform content rules for all 6 platforms (character limits, hashtag counts, emoji ranges, content format)
- [x] 4.3 `src/mastra/workflows/content-generate.ts` — Full pipeline: extract-params → content-write → duplicate-check → platform-format → polish-output
- [x] 4.4 `src/mastra/workflows/platform-format.ts` — Parallel platform adaptation using `platform-rules.ts` with `Promise.allSettled()`
- [x] 4.5 `src/mastra/workflows/duplicate-check.ts` — Three-tier dedup: title overlap (0.7) + pgvector semantic (0.85) + template match
- [x] 4.6 `src/mastra/agents/writer.ts` — Content writer agent with platform-native conventions
- [x] 4.7 `src/mastra/agents/optimizer.ts` — Post optimizer agent (improve engagement, suggest hashtags)
- [x] 4.8 `src/mastra/tools/web-search.ts` — Trend research tool for content context
- [x] 4.9 `src/mastra/tools/image-gen.ts` — Image generation tool for post media
- [x] 4.10 `src/api/routes/generate.ts` — POST /api/v1/posts/generate endpoint (topic → multi-platform posts)
- [x] 4.11 `src/api/routes/templates/:id/generate` — Generate post from template with AI
- [x] 4.12 Verify: generate a post from topic "new product launch", confirm platform-specific output for Instagram + X

---

## Phase 5 — Publishing Adapters

**Goal:** Platform-specific publishing via API and agent-browser fallback.

- [x] 5.1 `src/core/publisher/instagram.ts` — Publish posts, stories, reels, carousels via Graph API
- [x] 5.2 `src/core/publisher/tiktok.ts` — Publish videos via Content Posting API
- [x] 5.3 `src/core/publisher/x.ts` — Publish tweets, threads, media via API v2
- [x] 5.4 `src/core/publisher/linkedin.ts` — Publish posts and articles via Marketing API
- [x] 5.5 `src/core/publisher/facebook.ts` — Publish posts and stories via Graph API
- [x] 5.6 `src/core/publisher/telegram.ts` — Publish messages and media via Bot API
- [x] 5.7 `src/core/publisher/index.ts` — Publisher registry: maps platform enum to adapter
- [x] 5.8 `src/api/routes/posts/:id/publish` — Publish now endpoint
- [x] 5.9 Platform webhook endpoints for delivery confirmations and errors
- [x] 5.10 Verify: publish a test post to Telegram (simplest API), confirm delivery

---

## Phase 6 — Frontend

**Goal:** Complete SvelteKit frontend with all major pages.

### Layout & Navigation

- [x] 6.1 `app/src/routes/+layout.svelte` — Main layout with sidebar navigation, header, tenant selector
- [x] 6.2 `app/src/lib/components/Sidebar.svelte` — Navigation sidebar (Dashboard, Posts, Plans, Accounts, Analytics, Templates)
- [x] 6.3 `app/src/lib/api.ts` — Typed API client with auth headers and error handling
- [x] 6.4 `app/src/lib/stores/auth.svelte.ts` — Authentication state management

### Dashboard

- [x] 6.5 `app/src/routes/dashboard/+page.svelte` — Overview with upcoming posts, recent activity, quick stats
- [x] 6.6 `app/src/lib/components/Calendar.svelte` — Drag-and-drop content calendar (monthly/weekly/daily views)
- [x] 6.7 `app/src/lib/components/UpcomingPosts.svelte` — List of next scheduled posts

### Posts

- [x] 6.8 `app/src/routes/posts/+page.svelte` — Post list with filters (status, platform, date range)
- [x] 6.9 `app/src/routes/posts/new/+page.svelte` — Create new post
- [x] 6.10 `app/src/routes/posts/[id]/+page.svelte` — Edit post
- [x] 6.11 `app/src/lib/components/PostEditor.svelte` — Tipex rich text editor + AI generation panel + media upload
- [x] 6.12 `app/src/lib/components/PlatformPreview.svelte` — Preview post appearance per platform

### Content Plans

- [x] 6.13 `app/src/routes/content-plans/+page.svelte` — Content plan list with calendar integration
- [x] 6.14 `app/src/lib/stores/posts.svelte.ts` — Post state management with Svelte 5 runes

### Social Accounts

- [x] 6.15 `app/src/routes/accounts/+page.svelte` — Connected accounts list with connect/disconnect actions
- [x] 6.16 `app/src/lib/components/PlatformCard.svelte` — Social account card (avatar, status, platform icon)
- [x] 6.17 `app/src/lib/components/ConnectAccountModal.svelte` — OAuth connection flow modal

### Templates

- [x] 6.18 `app/src/routes/templates/+page.svelte` — Template list with create/edit
- [x] 6.19 `app/src/lib/components/TemplateEditor.svelte` — Template editor with AI prompt configuration

### Analytics

- [x] 6.20 `app/src/routes/analytics/+page.svelte` — Analytics overview with charts
- [x] 6.21 `app/src/lib/components/AnalyticsChart.svelte` — LayerChart wrapper for engagement metrics

- [x] 6.22 Verify: all pages render, navigation works, post creation flow end-to-end

---

## Phase 7 — Analytics

**Goal:** Engagement metrics collection and performance dashboard.

- [x] 7.1 `src/core/analytics/collector.ts` — Fetch engagement metrics from platform APIs (scheduled job)
- [x] 7.2 `src/core/analytics/instagram-analytics.ts` — Instagram insights API integration
- [x] 7.3 `src/core/analytics/x-analytics.ts` — X engagement metrics
- [x] 7.4 `src/core/analytics/linkedin-analytics.ts` — LinkedIn post statistics
- [x] 7.5 `src/core/analytics/aggregator.ts` — Cross-platform metrics aggregation
- [x] 7.6 `src/api/routes/analytics.ts` — GET /api/v1/analytics/overview, /api/v1/analytics/posts/:id
- [x] 7.7 Analytics dashboard: engagement rate, reach, impressions, CTR per post and platform
- [x] 7.8 Best posting time analysis based on historical engagement data
- [x] 7.9 Campaign performance comparison (side-by-side metrics)
- [x] 7.10 Verify: analytics data populates for published posts, charts render correctly

---

## Phase 8 — Campaign Management

**Goal:** Group posts into campaigns with coordinated scheduling.

- [x] 8.1 Campaign creation wizard with date range and platform selection
- [x] 8.2 Bulk post scheduling within campaign (content plan → campaign)
- [x] 8.3 Campaign progress tracking (published / remaining / failed counts)
- [x] 8.4 Campaign analytics aggregation (total reach, engagement across all posts)
- [x] 8.5 Campaign pause/resume functionality
- [x] 8.6 Verify: create campaign with 5 posts, schedule across 3 days, confirm progress tracking

---

## Phase 9 — Polish & Testing

**Goal:** Test coverage, documentation, Docker optimization, CI/CD.

### Testing

- [x] 9.1 Unit tests for `src/lib/encryption.ts` (encrypt/decrypt round-trip)
- [x] 9.2 Unit tests for `src/lib/platform-rules.ts` (all platform constraints)
- [x] 9.3 Unit tests for `src/core/scheduler/queue.ts` (enqueue, dequeue, retry)
- [x] 9.4 Unit tests for `src/core/scheduler/rate-limiter.ts` (sliding window)
- [x] 9.5 Integration tests for all CRUD routes (accounts, posts, content-plans, campaigns, templates)
- [x] 9.6 Integration tests for OAuth flow (mock token exchange)
- [x] 9.7 Integration tests for publish queue (schedule → publish → status update)
- [x] 9.8 Mastra workflow tests (content generation pipeline end-to-end)

### Documentation

- [x] 9.9 Update README.md with final API endpoints and setup instructions
- [x] 9.10 Create `docs/API.md` — Full API reference with request/response examples
- [x] 9.11 Create `docs/ARCHITECTURE.md` — System architecture diagram and data flow
- [x] 9.12 Create `docs/PLATFORM_RULES.md` — Platform content rules reference

### Docker & CI

- [x] 9.13 Create `Dockerfile` for API (multi-stage build, Bun runtime)
- [x] 9.14 Create `Dockerfile` for frontend (SvelteKit build + node adapter)
- [x] 9.15 Add health checks to all Docker services
- [x] 9.16 Add resource limits to docker-compose services
- [x] 9.17 Create `.github/workflows/ci.yml` — lint, typecheck, test, build on push

### Security

- [x] 9.18 Audit all routes for auth middleware coverage
- [x] 9.19 Verify encrypted token storage for all platforms
- [x] 9.20 Add CSP headers and security middleware
- [x] 9.21 Rate limit all public endpoints
- [x] 9.22 Verify: `bun test` passes all tests, `bunx tsc --noEmit` clean, Docker build succeeds

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
- [x] **Create YouTube Shorts publisher adapter** in `backend/src/core/publisher/`
  - Platform rules already define `youtube-shorts-script` in `backend/src/lib/platform-rules.ts`
  - Need: `youtube.ts` adapter using YouTube Data API v3
  - Auth: OAuth 2.0 with `youtube.upload` scope
  - **Effort:** ~6h
- [x] **Create YouTube Long-form publisher adapter**
  - Platform rules define `youtube-long` content type
  - Same API, different video parameters (longer duration, different thumbnail)
  - **Effort:** ~4h
- [x] **Add YouTube to SupportedPlatform type** in `backend/src/core/publisher/index.ts`
- [x] **Add YouTube OAuth config** in `backend/src/api/routes/oauth.ts`

### 10.4 WARNING: Env var naming mismatch
- [x] **Fix OAuth refresh worker** — change `process.env.FACEBOOK_APP_ID` to `process.env.META_APP_ID`
- [x] **Fix OAuth refresh worker** — change `process.env.FACEBOOK_APP_SECRET` to `process.env.META_APP_SECRET`
- [x] **Update .env.example** with correct META_* variable names
- **File:** `backend/src/workers/oauth-refresh.ts`
- **Effort:** 15min

### 10.5 WARNING: X API endpoint outdated
- [x] **Fix X refresh endpoint** — change `https://api.twitter.com/2/oauth2/token` to `https://api.x.com/2/oauth2/token`
- **File:** `backend/src/workers/oauth-refresh.ts`
- **Effort:** 5min

### 10.6 WARNING: Plugin manifest not typed
- [x] **Add type annotation** to plugin manifest — use `as const` or define local type
- **File:** `app/src/lib/plugin.ts`
- **Effort:** 10min

### 10.7 WARNING: Nav icons mismatch
- [x] **Sync icons** between `app/src/lib/plugin.ts` and `app/src/routes/+layout.svelte`
  - Accounts: 🔗 (plugin) vs 👤 (layout) — pick one
  - Campaigns: 🎯 (plugin) vs 📢 (layout) — pick one
- **Files:** `app/src/lib/plugin.ts`, `app/src/routes/+layout.svelte`
- **Effort:** 5min

### 10.8 WARNING: OAuth refresh worker issues
- [x] **Add fetch timeout** (10s AbortController) to all platform API calls — violates `feedback_fetch_timeout_required.md`
- [x] **Add HTTP 429 handling** — log warning and skip account, don't crash
- [x] **Validate token response** — check `access_token` exists before using
- **File:** `backend/src/workers/oauth-refresh.ts`
- **Effort:** 1h

### 10.9 WARNING: Dead-letter retry encoding fragile
- [x] **Use JSON encoding** for retry metadata instead of `retry:N:lastError` string parsing
  - Change to: `{ retryCount: N, lastError: "..." }`
  - Add migration for existing encoded values
- **File:** `backend/src/workers/dead-letter.ts`
- **Effort:** 30min

### 10.10 WARNING: Cross-platform analytics performance
- [x] **Add caching** to cross-platform analytics endpoint (Redis, 5min TTL)
- [x] **Optimize top posts query** — use `DISTINCT ON (platform)` instead of fetching all + JS filter
- **File:** `backend/src/modules/analytics/cross-platform.ts`
- **Effort:** 1h

### Phase 10 — COMPLETED (2026-06-14)
All 8 warning/missing items resolved. 5 parallel agents executed fixes:
- OAuth env vars: FACEBOOK_* → META_* in .env.example, config.ts, oauth.ts, README.md
- YouTube publishers: publishToYouTubeShorts + publishToYouTubeLong + registry + validation
- Frontend: HiAiPlugin type + navGroups import from plugin.ts (single source of truth)
- Backend: migrateLegacyRetryInfo() + Redis cache (5min TTL) + DISTINCT ON query

---

## Summary (Updated)

| Phase | Description | Effort | Status |
|-------|-------------|--------|--------|
| 0-9 | Original phases | ~106h | ✅ DONE (verified 2026-06-16) |
| 10 | Critic audit fixes | ~14h | ✅ DONE (2026-06-14) |
| 11 | Ecosystem integration | ~6h | 🔄 P3.2 + F1–F4 pending |
| **Total** | | **~126h** | |

### CI Verification (2026-06-16)
- Backend typecheck: ✅ 0 errors (`bunx tsc --noEmit`)
- Frontend typecheck: ✅ 0 errors (`svelte-kit sync` + `tsc --noEmit`)
- Frontend build: ✅ built in 2.88s
- Backend tests: ✅ 58 pass / 0 fail (Vitest, 7 files: encryption, platform-rules, queue, scheduler, oauth-state, auth-jwt, integration/auth)

---

## 📚 Поглощённые документы (история)

> Слито сюда 2026-06-16 из `QUALITY-ASSESSMENT.md` (6.5/10, 2026-05-23),
> `SECURITY-AUDIT.md` (9/10 open-source ready) и `VERIFY.md` (снимок TS-ошибок, 2026-05-23);
> оригиналы удалены, полный текст — в git. Стратегия — `../HIAI_PROJECTS_ROADMAP.md` (раздел «hiai-post», P0–P3).
> ⚠️ **P0 = аудит реального статуса:** оценки и список заглушек ниже датированы 2026-05-23 — проверить против кода.

**Сильные стороны (на дату):** очередь (Redis sorted-sets, exp-backoff, dead-letter, per-platform rate-limit),
6 платформ под единым publisher-интерфейсом, `platform-rules.ts` (9 типов, 250 строк, single source of truth),
5-шаговый Mastra-пайплайн генерации, AES-256-GCM шифрование токенов, чистая мульти-арендность, 0 TS-ошибок.

**Ключевые пробелы (проверить в P0):**
1. **Вызовы платформенных API — в основном заглушки** (нет реальных Instagram/TikTok/X/LinkedIn/Facebook Graph/v2 вызовов; Telegram самый полный).
2. ~~Calendar drag-and-drop не реализован (@dnd-kit / sortablejs).~~ ✅ **Сделано 2026-06-20** — нативный HTML5 drag-and-drop в `Calendar.svelte` (`draggable`, `dragstart`, `dragover`, `dataTransfer`).
3. ~~Аналитика — заглушки графиков (LayerChart не интегрирован).~~ ✅ **Сделано 2026-06-20** — `BarChart` из `layerchart` подключён в `app/src/lib/components/AnalyticsChart.svelte`; `BestTimeChart.svelte` (heatmap best posting times) рендерится на `/analytics`.
4. ~~SSE endpoint — заглушка (нет реального стриминга статусов).~~ ✅ **Сделано 2026-06-20** — реальный `ReadableStream` SSE с in-memory client registry, 30s heartbeat, 90s timeout, per-tenant broadcast.
5. ~~Нет авто-refresh OAuth-токенов до истечения.~~ ✅ **Сделано ранее** (Phase 2.9, Phase 10).
6. ~~Реальных LLM-вызовов Mastra нет (placeholder-ответы).~~ ✅ **Сделано 2026-06-20** — `web-search.ts` + `image-gen.ts` tools зарегистрированы; `content-generate` использует `agent.generate()`.
7. ~~Per-tenant rate limiting не выделен в middleware.~~ ✅ **Сделано 2026-06-20** — `rateLimiter.ts` ключ `ratelimit:{tenantId}:{endpoint}` + `X-RateLimit-Tenant` header.

**VERIFY.md snapshot (2026-05-23):** 33 TS-ошибки (с 58) — пути импортов `../db` → `../../db`,
`rbacGuard`→`rbacMiddleware`, имена экспортов stripe.service, типизация Elysia-контекста (`.user`/`.tenantId` через `.derive()`),
`rateLimiterMiddleware`. **Скорее всего уже исправлено — сверить в P0.** Security на тот момент: CLEAN (0 секретов, .env.example на 24 var).
