# hiai-post

Social media content planning and publishing module for the HiAi platform — AI-powered content generation, multi-platform scheduling, and analytics for merchant stores.

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/HiAi-gg/hiai-post?sort=semver)](https://github.com/HiAi-gg/hiai-post/releases)
[![Stars](https://img.shields.io/github/stars/HiAi-gg/hiai-post)](https://github.com/HiAi-gg/hiai-post/stargazers)
[![CI](https://github.com/HiAi-gg/hiai-post/actions/workflows/ci.yml/badge.svg)](https://github.com/HiAi-gg/hiai-post/actions/workflows/ci.yml)
[![Bun](https://img.shields.io/badge/Runtime-Bun_1.3-black?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Svelte](https://img.shields.io/badge/Svelte-5.x-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev)
[![Elysia](https://img.shields.io/badge/Elysia-1.4-lightgrey?logo=elysia&logoColor=white)](https://elysiajs.com)
[![Drizzle_ORM](https://img.shields.io/badge/Drizzle_ORM-0.45-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## Quick Start

```bash
cd projects/hiai-post
cp .env.example .env
bun install
docker compose up -d
bun run dev
```

**Health check:** `curl -fsS http://localhost:50300/api/v1/health`

**Run tests:** `bun run test` (unit tests via Vitest in backend + app) or `bun run test:e2e` (end-to-end tests via bun:test)

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Runtime** | Bun | 1.3.14+ |
| **Backend** | Elysia | 1.4.28+ |
| **ORM** | Drizzle ORM | 0.45.2+ |
| **Validation** | Zod | latest |
| **Database** | PostgreSQL + pgvector | 18.4 |
| **Cache / Queue** | Redis | 8.6+ |
| **Frontend** | Svelte 5 + SvelteKit | 2.60+ |
| **UI** | shadcn-svelte + Tailwind CSS | v4 |
| **Rich Text** | svelte-tiptap + TipTap v3 | latest |
| **AI** | Mastra | 1.36+ |
| **Auth** | Better Auth | latest |
| **Browser Automation** | agent-browser | latest |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   hiai-post-frontend                 │
│              SvelteKit 2.60+ (port 50301)            │
│   Calendar · Post Editor · Accounts · Analytics      │
└──────────────────────┬──────────────────────────────┘
                       │ REST / SSE
┌──────────────────────▼──────────────────────────────┐
│                    hiai-post-api                      │
│              Elysia 1.4.28+ (port 50300)              │
│                                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ Account  │ │   Post   │ │Scheduler │ │Analytics│ │
│  │ Module   │ │ Module   │ │ Module   │ │ Module  │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬────┘ │
│       │             │            │             │      │
│  ┌────▼─────────────▼────────────▼─────────────▼────┐ │
│  │              Mastra Workflows                     │ │
│  │  content-write · platform-format · polish-output  │ │
│  └──────────────────────┬───────────────────────────┘ │
└─────────────────────────┬────────────────────────────┘
                          │
     ┌────────────────────┼────────────────────┐
     ▼                    ▼                    ▼
 PostgreSQL          Redis 8.6+            Social APIs
 + pgvector        (queue, cache)    IG · TikTok · X · LI
                                      FB · TG · Threads
                                      Pinterest · YT · Blog
```

**Multi-tenant isolation:** Every table has `tenant_id`. Queries scope by authenticated tenant context.

**Auth:** Better Auth is mounted at `/api/auth` as an Elysia sub-app (`authRoutes`). The `auth` middleware verifies either an HS256 admin JWT (shared with hiai-admin proxy) or a Better Auth session token.

**Rate limiting:** Per-tenant Redis-backed (`ratelimit:{tenantId}:{endpoint}`) with dual-bucket fallback (global IP-based when no tenant context is available).

**Audit logging:** `audit.ts` middleware captures state-changing operations (POST/PUT/PATCH/DELETE) and writes to the `audit_logs` table after successful handler completion — never on validation/auth errors.

**Docker networking:** Services join both the `hiai-post` bridge network and the shared `docker_ai-internal` external network for cross-service communication (hiai-admin, hiai-store, etc.).

---

## Key Features

- **AI Content Generation** — Mastra workflows generate platform-native posts from a single topic input
- **Multi-platform Publishing** — Instagram, TikTok, X, LinkedIn, Facebook, Telegram, Threads, Pinterest, YouTube (Shorts + Long), Blog from one interface
- **Content Calendar** — Drag-and-drop scheduling with month, week, and day views, timezone-aware
- **Post Editor** — HiAiEditor (TipTap-based) rich text with inline AI generation and media upload
- **Queue Management** — Redis-based scheduler with retry, backoff, and dead letter queue
- **Analytics Dashboard** — Engagement metrics, reach, impressions, CTR per post and platform
- **Template System** — Reusable post templates with AI prompt presets
- **Social Account Management** — OAuth 2.0 flows for all platforms with encrypted token storage
- **Multi-tenant** — Each merchant sees only their own accounts, posts, and analytics

---

## Supported Platforms

| Platform | Content Types | Auth | Rate Limits |
|----------|--------------|------|-------------|
| **Instagram** | Posts, Stories, Reels, Carousels | Graph API OAuth 2.0 | 200 calls/hour |
| **TikTok** | Videos, Stories | Login Kit OAuth 2.0 + PKCE | 1000 calls/day |
| **X (Twitter)** | Threads, Posts, Media | OAuth 2.0 + PKCE | 300 requests/15min |
| **LinkedIn** | Posts, Articles, Documents | OAuth 2.0 | 100 calls/day |
| **Facebook** | Posts, Stories, Reels | Graph API OAuth 2.0 | 200 calls/hour |
| **Telegram** | Messages, Media | Bot API (token-based) | 30 messages/second |
| **Threads** | Posts, Media | Graph API OAuth 2.0 | 200 calls/hour |
| **Pinterest** | Pins, Boards | OAuth 2.0 | 100 calls/day |
| **YouTube** | Videos, Shorts, Long-form | Google OAuth 2.0 | 10M units/day |
| **Blog** | Long-form articles | N/A (internal) | N/A |

---

## Project Structure

```
/hiai-post
  /backend                # Elysia API server (Bun)
    /src
      /api                # Elysia routes
        /routes
          accounts.ts       # SocialAccount CRUD + OAuth callbacks
          posts.ts          # Post CRUD, scheduling, publishing
          content-plans.ts  # ContentPlan CRUD
          campaigns.ts      # Campaign management
          templates.ts      # PostTemplate CRUD
          analytics.ts      # Engagement metrics aggregation
          webhooks.ts       # hiai-store product → draft post webhook
          oauth.ts          # Multi-platform OAuth 2.0 flows
          youtube.ts        # YouTube-specific OAuth + upload
          generate.ts       # AI content generation endpoints
          queue.ts          # Publish queue management
          events.ts         # SSE real-time event stream
          health.ts         # Health check endpoint
          auth.ts           # Better Auth delegation handler at /api/auth
        /middleware
          auth.ts           # Better Auth + JWT verification (supports HS256 admin bridge)
          rateLimiter.ts    # Per-tenant Redis-backed rate limiting (dual-bucket fallback)
          tenant.ts         # Multi-tenant scoping
          secureHeaders.ts  # HTTP security headers
          apiLogger.ts      # Request/response logging
          audit.ts          # Audit logging for state-changing operations (POST/PUT/PATCH/DELETE)
        /validation
          schemas.ts        # Zod validation schemas
      /core                # Business logic
        /scheduler         # Redis queue publisher + cron
        /publisher         # Platform-specific publishing adapters
        /analytics         # Metrics aggregation
        /events
          store-listener.ts # Redis pub/sub scaffold for future hiai-store stream (NOT wired — use HTTP webhook)
      /db                  # Drizzle schemas + migrations
        schema.ts          # All table definitions
        index.ts           # DB client
        migrations/        # SQL migrations
      /integrations        # Social platform adapters
        /instagram         # Graph API client
        /tiktok            # TikTok API client
        /x                 # X API v2 client
        /linkedin          # LinkedIn Marketing API client
        /facebook          # Facebook Graph API client
        /telegram          # Telegram Bot API client
        /youtube           # YouTube Data API v3 client
      /auth                # Better Auth instance (module-init)
        index.ts           # betterAuth() with Drizzle adapter, email/password, session config
      /mastra              # AI workflows
        /workflows
          content-generate.ts   # Full content pipeline
          platform-format.ts    # Platform adaptation
          duplicate-check.ts    # Deduplication
        /agents
          writer.ts         # Content writer agent
          optimizer.ts      # Post optimizer agent
        /tools
          web-search.ts     # Real Tavily API for trend research (not a placeholder)
          image-gen.ts      # Real DALL·E 3 API for image generation (falls back to placehold.co)
        index.ts            # Mastra instance
      /lib                 # Shared utilities
        config.ts           # Environment config (Zod)
        encryption.ts       # AES-256-GCM token encryption
        platform-rules.ts   # Platform content rules (chars, hashtags, emoji)
        timezone.ts         # Timezone conversion helpers
        idempotency.ts      # Idempotency key generation
        redis.ts            # Redis client
        db.ts               # Database client singleton
        logger.ts           # Pino logger
      /workers             # Background workers
        oauth-refresh.ts    # OAuth token refresh worker
        dead-letter.ts      # Dead letter queue processor
    Dockerfile
    package.json
    tsconfig.json
    drizzle.config.ts
  /app                    # SvelteKit frontend
    /src
      /routes
        +error.svelte      # Global error boundary (catches 4xx/5xx)
        /dashboard         # Overview + calendar + summary stats cards
        /posts             # Post list + editor
        /content-plans     # Content plan management
        /accounts          # Social account connections
        /analytics         # Performance dashboard
        /templates         # Template management
      /lib
        /components
          Calendar.svelte       # Drag-and-drop calendar (month + week + day views)
          PostEditor.svelte     # HiAiEditor + AI panel (consumed from @hiai/ui)
          PlatformCard.svelte   # Social account card
          AnalyticsChart.svelte # LayerChart wrapper
          BestTimeChart.svelte  # Heatmap chart for best posting times
        /stores
          posts.svelte.ts       # Post state management
          accounts.svelte.ts    # Account state
        api.ts              # API client
    Dockerfile
    package.json
    svelte.config.js
    tsconfig.json
    vite.config.ts
  /packages               # Shared workspace packages
    /hiai-ui              # @hiai/ui — shared UI components
  docker-compose.yml
  package.json            # Workspace root
  tsconfig.json
  drizzle.config.ts
  .env.example
```

---

## Database

PostgreSQL 18.4 with pgvector extension. Database: `hiai_post`.

### Core Tables

| Table | Purpose |
|-------|---------|
| `tenants` | Tenant / merchant reference |
| `social_accounts` | Connected social platform accounts (encrypted tokens) |
| `posts` | Scheduled / draft / published posts |
| `content_plans` | Content plan entries (calendar slots) |
| `campaigns` | Grouped posts for campaigns |
| `post_templates` | Reusable post templates with AI prompts |
| `post_analytics` | Per-post engagement metrics |
| `audit_logs` | Action audit trail |

**Publish queue** is stored in Redis as sorted sets (score = unix timestamp), not in PostgreSQL.

### Migration Integrity Check

`bun run db:check` runs a deterministic migration-integrity check against an
**empty** PostgreSQL database (a disposable one — see below). It:

1. Validates the migration journal (`meta/_journal.json`): sequential `idx`,
   tag ↔ file match, per-entry snapshot present, no orphaned SQL files.
2. Applies repository migrations `0000` through current via the Drizzle
   migrator (the same path as `db:migrate`).
3. Verifies the expected core tables exist, including `tenant_members`, the
   Better Auth tables (`user`, `session`, `account`, `verification`),
   `content_items`, and `api_keys`.
4. Detects drift: the migrated database must match the latest committed
   snapshot (table set, columns, enums), and `src/db/schema.ts` must not drift
   from the committed migrations. The check never writes into the repository
   (schema drift is verified against a throwaway copy under
   `node_modules/.migration-check` that is removed afterwards).

Safety: the check **refuses to run against a database that already has
tables**. Point `DATABASE_URL` at a fresh/disposable database:

```bash
# 1. Start a throwaway PostgreSQL (or reuse a fresh service container)
docker run --rm -d --name hiai-post-db-check \
  -e POSTGRES_DB=hiai_post_check -e POSTGRES_USER=hipost -e POSTGRES_PASSWORD=changeme \
  -p 55432:5432 postgres:16-alpine

# 2. Run the check
DATABASE_URL=postgresql://hipost:changeme@localhost:55432/hiai_post_check bun run db:check

# 3. Clean up
docker rm -f hiai-post-db-check
```

`bun run db:check --reset` drops and recreates the `public` schema before
running (destructive — only use on a throwaway database). The same check runs
automatically in CI (`Migration integrity` job) against a fresh PostgreSQL
service container on every push/PR.

---

## API Endpoints (overview)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health` | Health check |
| `GET` | `/api/v1/accounts` | List social accounts |
| `GET` | `/api/v1/accounts/:id` | Get social account details |
| `DELETE` | `/api/v1/accounts/:id` | Disconnect social account |
| `GET` | `/api/v1/posts` | List posts (paginated, filterable) |
| `GET` | `/api/v1/posts/:id` | Get single post |
| `POST` | `/api/v1/posts` | Create post |
| `PUT` | `/api/v1/posts/:id` | Update post |
| `DELETE` | `/api/v1/posts/:id` | Delete post |
| `POST` | `/api/v1/posts/:id/schedule` | Schedule post for later |
| `POST` | `/api/v1/posts/:id/publish` | Publish post now |
| `POST` | `/api/v1/posts/generate` | Generate content via AI |
| `POST` | `/api/v1/posts/:id/optimize` | Optimize post content via AI |
| `GET` | `/api/v1/content-plans` | List content plans |
| `GET` | `/api/v1/content-plans/:id` | Get single content plan |
| `POST` | `/api/v1/content-plans` | Create content plan |
| `PUT` | `/api/v1/content-plans/:id` | Update content plan |
| `DELETE` | `/api/v1/content-plans/:id` | Delete content plan |
| `GET` | `/api/v1/campaigns` | List campaigns |
| `GET` | `/api/v1/campaigns/:id` | Get campaign with content plans |
| `POST` | `/api/v1/campaigns` | Create campaign |
| `PUT` | `/api/v1/campaigns/:id` | Update campaign |
| `DELETE` | `/api/v1/campaigns/:id` | Delete campaign |
| `GET` | `/api/v1/templates` | List templates |
| `GET` | `/api/v1/templates/:id` | Get single template |
| `POST` | `/api/v1/templates` | Create template |
| `PUT` | `/api/v1/templates/:id` | Update template |
| `DELETE` | `/api/v1/templates/:id` | Delete template |
| `POST` | `/api/v1/webhooks/store-product` | Incoming webhook from hiai-store (product → draft post) |
| `GET` | `/api/v1/analytics/overview` | Aggregated analytics |
| `GET` | `/api/v1/analytics/platforms` | Platform breakdown |
| `GET` | `/api/v1/analytics/posts/:postId` | Per-post metrics |
| `GET` | `/api/v1/analytics/top-posts` | Top performing posts |
| `GET` | `/api/v1/analytics/cross-platform` | Cross-platform comparison |
| `GET` | `/api/v1/analytics/best-times` | Best posting time recommendations |
| `GET` | `/api/v1/oauth/:platform/connect` | Start OAuth flow |
| `GET` | `/api/v1/oauth/:platform/callback` | OAuth callback |
| `GET` | `/api/v1/youtube/connect` | YouTube OAuth connect |
| `GET` | `/api/v1/youtube/callback` | YouTube OAuth callback |
| `POST` | `/api/v1/youtube/upload` | Upload video to YouTube |
| `GET` | `/api/v1/youtube/status` | YouTube video processing status |
| `GET` | `/api/v1/youtube/channel` | Get YouTube channel info |
| `GET` | `/api/v1/queue/status` | Publish queue status |
| `GET` | `/api/v1/queue/scheduled` | Scheduled queue items |
| `GET` | `/api/v1/queue/dead-letter` | Dead letter queue items |
| `POST` | `/api/v1/queue/retry/:postId` | Retry from dead letter queue |
| `GET` | `/api/v1/events` | SSE real-time event stream |
| `GET` | `/api/v1/events/stats` | SSE connection stats |

---

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://hipost:changeme@localhost:5436/hiai_post
REDIS_URL=redis://localhost:6383

# Auth
BETTER_AUTH_SECRET=change-me-to-a-random-32-char-string-min
BETTER_AUTH_URL=http://localhost:50300
HIAI_ADMIN_JWT_SECRET=  # HS256 shared secret for hiai-admin proxy cross-service auth

# Encryption (AES-256-GCM)
TOKEN_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# Social Platform API Keys
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
X_CLIENT_ID=
X_CLIENT_SECRET=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
META_APP_ID=
META_APP_SECRET=
THREADS_APP_ID=
THREADS_APP_SECRET=
PINTEREST_APP_ID=
PINTEREST_APP_SECRET=
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
TELEGRAM_BOT_TOKEN=

# Mastra / LLM
OPENROUTER_API_KEY=
OPENAI_API_KEY=  # Required for DALL·E 3 image generation (image-gen.ts)
MASTRA_MODEL=openai/gpt-4o

# Ports
API_PORT=50300
FRONTEND_PORT=50301

# Webhook (hiai-store integration)
HIAI_STORE_WEBHOOK_SECRET=  # Shared secret for incoming store-product webhooks

# Error tracking
SENTRY_DSN=  # Sentry-compatible DSN (via hiai-observe)

# Environment
NODE_ENV=development
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start API + frontend in parallel |
| `bun run dev:api` | Start API dev server (port 50300) |
| `bun run dev:frontend` | Start SvelteKit dev server (port 50301) |
| `bun run build` | Build all workspaces |
| `bun run lint` | Run Biome check across all workspaces |
| `bun run typecheck` | Run TypeScript type checking |
| `bun run test` | Run unit tests (Vitest in backend + app workspaces) |
| `bun run test:backend` | Run backend unit tests only |
| `bun run test:frontend` | Run frontend unit tests only |
| `bun run test:e2e` | Run end-to-end tests (bun:test, requires dev server) |
| `bun run test:coverage` | Run unit tests with coverage reporting |
| `bun run db:generate` | Generate Drizzle migration |
| `bun run db:migrate` | Run Drizzle migrations |
| `bun run db:push` | Push schema changes (dev only) |
| `bun run db:seed` | Seed development data |
| `bun run db:check` | Migration integrity check (see [Database](#database)) |

---

## Related Projects

| Project | Relationship |
|---------|-------------|
| [hiai-admin](https://github.com/HiAi-gg/hiai-admin) | Platform admin manages post module settings and tenant access |
| [hiai-store](https://github.com/HiAi-gg/hiai-store) | Auto-publish new products and promotions to social channels |
| [hiai-observe](https://github.com/HiAi-gg/hiai-observe) | Error tracking, uptime monitoring, and observability |
