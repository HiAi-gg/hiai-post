# hiai-post — Agent Operating Instructions

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
docker compose up -d   # starts API + frontend + postgres + redis

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
bun run lint                   # ESLint
bun run lint:fix               # ESLint auto-fix

# Test
bun test                       # Run all tests
bun test src/db/__tests__/     # Run specific test directory

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
| `src/api/routes/` | Elysia route handlers (accounts, posts, content-plans, campaigns, templates, analytics, health) |
| `src/api/middleware/` | Auth, rate limiting, tenant scoping middleware |
| `src/core/scheduler/` | Redis-based publish queue, cron publisher, retry logic |
| `src/core/publisher/` | Platform-specific publishing adapters (Instagram, TikTok, X, etc.) |
| `src/core/analytics/` | Engagement metrics aggregation from platform APIs |
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
| `src/mastra/tools/` | Mastra tools (web-search, image-gen) |
| `src/mastra/index.ts` | Mastra instance setup |
| `src/lib/encryption.ts` | AES-256-GCM token encryption/decryption |
| `src/lib/platform-rules.ts` | Platform content rules (character limits, hashtag counts, emoji limits) |
| `src/lib/timezone.ts` | Timezone conversion utilities |
| `src/lib/idempotency.ts` | Idempotency key generation |
| `app/src/routes/` | SvelteKit pages (dashboard, posts, content-plans, accounts, analytics, templates) |
| `app/src/lib/components/` | Svelte components (Calendar, PostEditor, PlatformCard, AnalyticsChart) |
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
7. Run `bun test` to verify no regressions

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

## Integration Points

| System | Integration |
|--------|------------|
| **hiai-admin** | Tenant management, platform settings, RBAC via REST API |
| **hiai-store** | Auto-publish new products and promotions via internal events |
| **Mastra** | AI content generation workflows and agents |
| **Instagram** | Graph API — posts, stories, reels, carousels |
| **TikTok** | Login Kit + Content Posting API |
| **X (Twitter)** | API v2 — tweets, threads, media upload |
| **LinkedIn** | Marketing API — posts, articles |
| **Facebook** | Graph API — posts, stories |
| **Telegram** | Bot API — messages, media |
| **HiAi Observe** | Error tracking via Sentry-compatible DSN |
| **Redis** | Publish queue, rate limit counters, session cache |
| **PostgreSQL + pgvector** | Data storage, semantic duplicate detection |
