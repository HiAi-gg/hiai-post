# Changelog — hiai-post

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-06-20

### Added
- Biome 2.5.0 linter (replaced ESLint)
- Vitest test runner (replaced bun:test, 58 tests pass)
- `POST /api/v1/webhooks/store-product` endpoint for hiai-store auto-publish integration
- `GET /api/v1/analytics/best-times` endpoint for best posting time analysis
- Audit middleware (`backend/src/api/middleware/audit.ts`) — logs state-changing operations to
  `audit_logs` table with sensitive key redaction
- Per-tenant rate limiting (`ratelimit:{tenantId}:{endpoint}`) with dual-bucket fallback
- Frontend error boundary (`+error.svelte`)
- `BestTimeChart.svelte` component (7×24 heatmap for optimal posting times)
- Calendar week and day views (in addition to existing month view)
- Dashboard summary stats cards (total posts, scheduled, published, connected accounts)
- hiai-store event listener scaffold (`backend/src/core/events/store-listener.ts`)
- Docker `ai-internal` shared network integration
- `SENTRY_DSN` configuration for hiai-observe integration
- `TAVILY_API_KEY` and `OPENAI_API_KEY` for real Mastra tool implementations
- `HIAI_STORE_WEBHOOK_SECRET` for webhook authentication
- Threads and Pinterest OAuth callback support with proper user info fetching

### Changed
- `@hiai/ui` dependency from `file:` to `workspace:*` protocol
- Mastra `web-search` tool: now uses real Tavily API (was placeholder)
- Mastra `image-gen` tool: now uses real DALL-E 3 API via OpenRouter (was placeholder)
- `AnalyticsChart.svelte`: now uses LayerChart `BarChart` (was CSS-only bar chart)
- Auth routing: now uses `authRoutes` Elysia sub-app (was `.onRequest` handler)
- `.env`: renamed `FACEBOOK_APP_ID` to `META_APP_ID`, added `THREADS_*`, `PINTEREST_*`,
  `YOUTUBE_*`, `HIAI_ADMIN_JWT_SECRET`

### Fixed
- Frontend 500 error: auth endpoints now properly bypass tenant middleware
- OAuth callback routing for Threads and Pinterest
- Docker network isolation: now joins shared `ai-internal` network

## [1.0.0] - 2026-06-16

### Added
- SiteAdapter-compatible health endpoint at `/health`
- Drizzle migrations for all 8 tables
- `@hiai/ui` integration with canonical tokens.css

### Fixed
- Svelte 5 build error (`class:bg-.../N` syntax)
- Encrypted tokens now decrypted before API calls in analytics
- `twitter.com` → `x.com` API endpoint update
- All `process.env` reads centralized in `config.ts`
- `@hiai/ui` package populated with components, stores, and API client

### Changed
- Frontend icons: emoji → lucide-svelte
- Dashboard stat cards: inline → `StatsCard`/`StatusBadge` from `@hiai/ui`
- hiai-admin plugin manifest: removed `comingSoon`, updated to v1.0.0
