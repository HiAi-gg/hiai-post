# hiai-post — AGENTS.md

> **Роль:** модуль постинга — social media content planning + AI-генерация (Mastra) + auto-publish (Instagram, TikTok, X, LinkedIn, Facebook, Telegram).
> **Статус:** продукт доведён, plugin-манифест v1.0.0 (Phase 11), подключён в `hiai-admin` host.
> **Точка входа экосистемы:** [`projects/INDEX.md`](../../INDEX.md)
> **Канонические правила:** [`docs/hiai-ecosystem/CONVENTIONS.md`](../../docs/hiai-ecosystem/CONVENTIONS.md)

---

## Cheat-sheet конвенций

| # | Правило | Значение |
|---|---|---|
| 1 | Runtime | **Bun 1.3.14+** |
| 2 | Backend framework | **Elysia 1.4.28+** |
| 3 | Frontend | **Svelte 5.55+** + **SvelteKit 2.60+** |
| 4 | UI-пакет | **@hiai/ui** + **shadcn-svelte** |
| 5 | ORM | **Drizzle ORM 0.45.2+** |
| 6 | Auth | **Better Auth 1.6+** (mounted `authRoutes` BEFORE `protectedApp`, bypasses tenant middleware) |
| 7 | База данных | **PostgreSQL 18.4** + **pgvector 0.8.x** (semantic duplicate detection) |
| 8 | Cache / queue | **Redis 8.6+** — publish queue: sorted set `publish_queue:{tenant_id}` (score = unix ts) |
| 9 | Линтер / формат | **Biome 2.5+** |
| 10 | Тесты | **Vitest** + **agent-browser** (Playwright FORBIDDEN) |
| 11 | Структура | `backend/` (API) + `app/` (SvelteKit frontend) |
| 12 | Конфиг env | **Только через `src/lib/config.ts`** (Zod-валидация) |
| 13 | Токены UI | **Импорт из `@hiai/ui/styles/tokens.css`** — никаких хардкодов |
| 14 | Порты | API **50300** · Frontend **50301** · PostgreSQL **5436** · Redis **6383** |
| 15 | AI / оркестрация | **Mastra 1.36+** (workflows: content-generate, platform-format, duplicate-check) |

### Канонические документы

- [`docs/hiai-ecosystem/CONVENTIONS.md`](../../docs/hiai-ecosystem/CONVENTIONS.md) — правила
- [`docs/hiai-ecosystem/ARCHITECTURE.md`](../../docs/hiai-ecosystem/ARCHITECTURE.md) — архитектура, модули vs host
- [`docs/hiai-ecosystem/PORTS.md`](../../docs/hiai-ecosystem/PORTS.md) — реестр портов (50300/50301, 5436, 6383)
- [`docs/hiai-ecosystem/DESIGN_SYSTEM.md`](../../docs/hiai-ecosystem/DESIGN_SYSTEM.md) — дизайн-токены, @hiai/ui
- [`docs/hiai-ecosystem/PLUGIN_CONTRACT.md`](../../docs/hiai-ecosystem/PLUGIN_CONTRACT.md) — **plugin-контракт** (manifest v1.0.0, proxy prefix `/api/social`)

### Проектные документы (index)

| Документ | Назначение |
|---|---|
| `README.md` | обзор проекта |
| `todo.md` | живой статус задач (Phases P0–P3 + F1–F4 deferred) |
| `docs/plugin-integration-plan.md` | план интеграции в hiai-admin (proxy, manifest, X-Tenant-Id) |
| `docs/API.md` | REST API reference |
| `docs/ARCHITECTURE.md` | детальная архитектура модуля |
| `docs/PLATFORM_RULES.md` | правила платформ (character limits, hashtag, emoji) |
| `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md` | стандартные |

> **Примечание:** Этот файл (`AGENTS.md`) и `todo.md` добавлены в `.gitignore` и не коммитятся.
> Они содержат оперативные инструкции для агентов и могут меняться без review.

---

## Source of Truth (legacy — see cheat-sheet above for canonical references)

This project is part of the HiAi ecosystem. **Shared truth lives in the `projects/` root:**

- [`../HIAI_CONVENTIONS.md`](../HIAI_CONVENTIONS.md) — rules, topology, design tokens, plugin contract.
- [`../../docs/archive/HIAI_ECOSYSTEM_UNIFICATION_PLAN.md`](../../docs/archive/HIAI_ECOSYSTEM_UNIFICATION_PLAN.md) — unification program (U0–U5).
- [`../../packages/hiai-ui/README.md`](../../packages/hiai-ui/README.md) — **@hiai/ui**: consumption contract (tokens/primitives/composites); plan — [`../../docs/archive/HIAI_UI_PACKAGE_PLAN.md`](../../docs/archive/HIAI_UI_PACKAGE_PLAN.md).
- [`../../docs/archive/HIAI_PROJECTS_ROADMAP.md`](../../docs/archive/HIAI_PROJECTS_ROADMAP.md) — **project plan (section "hiai-post", phases P0–P3)**.

**Role:** social media posting module, connects to `hiai-admin` (:50300). Admin manifest updated to v1.0.0 (`comingSoon` removed) — Phase 11.
**What's next:** **P3.2 — per-tenant proxy forwarding (X-Tenant-Id header)** in `hiai-admin` proxy (blocked until proxy fix in admin). F1 (TipexEditor extraction to @hiai/ui) DONE 2026-06-28 — consumed as HiAiEditor via @hiai/ui v0.0.8. F2 (Vitest) DONE; F3 (DataTable/LayerChart) DONE; F4 (audit) DONE. RBAC shipped 2026-06-28 (rbac.ts). Details — in roadmap.

### Project Documents (index)
| Document | Purpose | Status |
|---|---|---|
| `README.md` · `AGENTS.md` (this) · `todo.md` | overview · rules · live status | core |
| `SECURITY.md`, `CONTRIBUTING.md` | standard | core |
| `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/PLATFORM_RULES.md` | technical reference | reference |

> `QUALITY-ASSESSMENT.md` + `SECURITY-AUDIT.md` + `VERIFY.md` absorbed 2026-06-16 into the "📚 Absorbed Documents" section at the bottom of `todo.md` and deleted; full text — in git history.

## Identity & Purpose

`hiai-post` is the social media content planning and publishing module for the HiAi platform. Merchants create content plans, generate posts with AI (Mastra), and auto-publish to Instagram, TikTok, X, LinkedIn, Facebook, and Telegram.

**What agents should know before working here:**
- Uses Mastra 1.36+ for AI content generation — follow the `createStep()`/`createWorkflow()` pattern
- Playwright is FORBIDDEN — use `agent-browser` only for browser automation
- Every table must have `tenant_id` for multi-tenant isolation — no exceptions
- OAuth tokens must be encrypted with AES-256-GCM before storage
- Redis sorted sets are the publish queue (score = unix timestamp) — not BullMQ
- Platform rules live in `src/lib/platform-rules.ts` — single source of truth for character limits, hashtags, emoji
- Module boundaries: `integrations/` must not import from `mastra/`; `core/scheduler` must not import from `integrations/` directly (but `core/publisher/` MAY import from `integrations/` to post content)
- Plugin manifest v1.0.0 — not `comingSoon`; proxy prefix `/api/social`
- Mastra tools are production implementations: Tavily for web-search, DALL-E 3 for image-gen
- Dashboard summary stats cards fetch from API client-side (not server-rendered)
- Calendar has month + week + day views all with drag-and-drop

## Runtime Contract

- **Stack:** Bun 1.3.14+, Elysia 1.4.28+, Drizzle ORM 0.45.2+, PostgreSQL 18.4 + pgvector, Redis 8.6+, Mastra 1.36+
- **Ports:** API `50300`, Frontend `50301`
- **Database:** `hiai_post` (PostgreSQL 18.4)
- **Health:** `GET /api/v1/health`

## Canonical Commands

```bash
cd projects/hiai-post

# Install
bun install

# Setup
cp .env.example .env   # fill DATABASE_URL, REDIS_URL, BETTER_AUTH_SECRET, social API keys
docker compose up -d   # starts API + frontend + postgres + redis (joins ai-internal + hiai-post networks)

# Development
bun run dev                    # start API dev server (port 50300)
bun run dev:frontend           # start SvelteKit dev server (port 50301)

# Build
bun run build                  # build API
bun run build:frontend         # build SvelteKit frontend

# Typecheck
bunx tsc --noEmit -p .         # API typecheck
cd app && bunx svelte-kit sync && bunx tsc --noEmit  # Frontend typecheck

# Lint
bun run lint                   # Biome 2.5.0 check
bun run lint:fix               # Biome auto-fix

# Test
cd backend && npx vitest run   # Run all tests (Vitest)
cd backend && npx vitest run src/db/__tests__/  # Run specific test directory

# Database
bun run db:generate            # Generate Drizzle migration
bun run db:migrate             # Run migrations
bun run db:push                # Push schema changes (dev only)
bun run db:seed                # Seed development data

# Docker
docker compose up -d --build   # Rebuild and start
docker compose logs -f api     # Watch API logs
```

## Repo Map

| Path | Role |
|------|------|
| `src/api/routes/` | Elysia route handlers (accounts, posts, content-plans, campaigns, templates, analytics, health, webhooks, auth) |
| `src/api/middleware/` | Auth, tenant, rate limiting, audit middleware (audit.ts) |
| `src/core/scheduler/` | Redis-based publish queue, cron publisher, retry logic |
| `src/core/publisher/` | Platform-specific publishing adapters (Instagram, TikTok, X, etc.) |
| `src/core/analytics/` | Engagement metrics aggregation from platform APIs |
| `src/core/events/` | Redis pub/sub event handlers (store-listener for hiai-store integration) |
| `src/db/schema.ts` | Drizzle ORM table definitions |
| `src/db/index.ts` | Database client singleton |
| `src/db/migrations/` | SQL migration files |
| `src/integrations/instagram/` | Instagram Graph API client |
| `src/integrations/tiktok/` | TikTok API client |
| `src/integrations/x/` | X API v2 client |
| `src/integrations/linkedin/` | LinkedIn Marketing API client |
| `src/integrations/facebook/` | Facebook Graph API client |
| `src/integrations/telegram/` | Telegram Bot API client |
| `src/mastra/workflows/` | Mastra workflows (content-generate, platform-format, duplicate-check) |
| `src/mastra/agents/` | Mastra agents (writer, optimizer) |
| `src/mastra/tools/` | Mastra tools — Tavily (web-search), DALL-E 3 (image-gen) — production implementations |
| `src/mastra/index.ts` | Mastra instance setup |
| `src/lib/encryption.ts` | AES-256-GCM token encryption/decryption |
| `src/lib/platform-rules.ts` | Platform content rules (character limits, hashtag counts, emoji limits) |
| `src/lib/timezone.ts` | Timezone conversion utilities |
| `src/lib/idempotency.ts` | Idempotency key generation |
| `app/src/routes/` | SvelteKit pages (dashboard, posts, content-plans, accounts, analytics, templates) |
| `app/src/routes/+error.svelte` | SvelteKit error boundary page |
| `app/src/lib/components/` | Svelte components (Calendar — month/week/day views + drag-and-drop, PostEditor, PlatformCard, AnalyticsChart, BestTimeChart) |
| `app/src/lib/stores/` | Svelte 5 rune-based state stores |
| `app/src/lib/api.ts` | Frontend API client |
| `docker-compose.yml` | Service definitions |
| `.env.example` | Environment variable template |

## Start Here As An Agent

1. Read this file for project context
2. Read `todo.md` for active backlog
3. Check `src/lib/platform-rules.ts` before any content-related work
4. Check `src/mastra/workflows/` for existing AI workflow patterns
5. Check `src/integrations/` for existing social platform adapters
6. Run `bunx tsc --noEmit` after any code changes
7. Run `cd backend && npx vitest run` to verify no regressions

## Key Patterns

### Mastra Content Generation Workflow
The content pipeline uses the following pattern:
1. **extract-params** — LLM extracts topic, language, platform, format
2. **content-write** — Unified writer with Zod schemas, retry (2 attempts), refusal/placeholder detection
3. **duplicate-check** — Title overlap (0.7) + pgvector semantic similarity (0.85)
4. **platform-format** — Parallel adaptation per platform via `platform-rules.ts`
5. **polish-output** — LLM cleanup + regex safety net

### Multi-tenant Isolation
- Every query must include `WHERE tenant_id = $1`
- Tenant context set by `tenant.ts` middleware from JWT claims
- No cross-tenant data leakage — verify with tests

### OAuth Token Storage
- Tokens encrypted with AES-256-GCM before DB insert
- Encryption key from `TOKEN_ENCRYPTION_KEY` env var
- Refresh tokens stored alongside access tokens
- Token expiry tracked — refresh 5 minutes before expiry

### Publish Queue (Redis)
- Sorted set: `publish_queue:{tenant_id}`, score = unix timestamp
- Publisher cron: every minute, pop posts where `publish_at <= now()`
- Retry: 3 attempts, exponential backoff (1min, 5min, 15min)
- Dead letter queue for permanently failed posts
- Idempotency: `(social_account_id, content_hash)` unique constraint

### Platform Rules (single source of truth)
All platform constraints defined in `src/lib/platform-rules.ts`:
- Character limits, hashtag counts, emoji ranges per platform
- Content format rules (markdown allowed/disallowed, media requirements)
- Platform-specific posting requirements (thread format, carousel limits)

### Auth Routing (Better Auth)
- Better Auth is mounted as an `authRoutes` Elysia sub-app imported from `src/api/routes/auth.ts`
- Mounted on the unprotected app **BEFORE** the `protectedApp` — no tenant middleware applied
- All `/api/auth/*` routes bypass `tenantMiddleware` entirely

### Audit Logging
- `src/api/middleware/audit.ts` hooks into `onAfterHandle` for write operations (POST/PUT/PATCH/DELETE)
- Logs to DB: actor ID, action, resource, result (success/failure), request metadata
- **Redacts** sensitive keys (`password`, `token`, `secret`, `key`, `authorization`) from logged metadata

### Rate Limiting
- Per-tenant Redis keys: `ratelimit:{tenantId}:{endpoint}`
- Dual-bucket algorithm with global IP fallback when tenant context is unavailable
- Configurable limits per-endpoint via middleware options

### Calendar Views
- Three view modes: **month**, **week**, **day** — all with drag-and-drop for rescheduling posts
- Best posting times displayed as a heatmap chart (`BestTimeChart.svelte`)

### Dashboard Data
- Summary stats cards fetch from API client-side (not server-rendered)
- Endpoints at `GET /api/v1/analytics/summary` and related stats endpoints

## Integration Points

| System | Integration |
|--------|------------|
| **hiai-admin** | Tenant management, platform settings, RBAC via REST API |
| **hiai-store** | Auto-publish products via `POST /api/v1/webhooks/store-product` + Redis pub/sub `store-listener.ts` |
| **Mastra** | AI content generation workflows and agents |
| **Instagram** | Graph API — posts, stories, reels, carousels |
| **TikTok** | Login Kit + Content Posting API |
| **X (Twitter)** | API v2 — tweets, threads, media upload |
| **LinkedIn** | Marketing API — posts, articles |
| **Facebook** | Graph API — posts, stories |
| **Telegram** | Bot API — messages, media |
| **HiAi Observe** | Error tracking via Sentry-compatible DSN (configured in audit middleware + error boundary) |
| **Redis** | Publish queue, rate limit counters, session cache |
| **PostgreSQL + pgvector** | Data storage, semantic duplicate detection |
| **Docker network** | Joins `ai-internal` shared network (external) alongside `hiai-post` bridge network |
