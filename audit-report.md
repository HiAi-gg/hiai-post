# HiAi-Post — Repository Audit Report

- **Repo:** `/home/hiai/projects/hiai-post` (monorepo: `backend/` Elysia API, `app/` SvelteKit frontend)
- **Audit date:** 2026-08-10
- **Audit type:** Read-only, documentation-only. No production code, config, migration, lockfile, or test files were modified. **No adjacent repositories were modified** (see §2).
- **Baseline:** branch `master` @ `30a54be` (`fix(tests): exclude E2E from vitest (bun:test suite) + scope test script to backend`), **working tree NOT clean** (see §2). This report is itself untracked (`?? audit-report.md`).
- **Method:** direct file inspection + live verification commands (lint, typecheck, vitest both suites, bun:test runner, `bun audit`, git state) + read-only cross-repo contract checks. Every finding cites exact `path:line`. Unknowns are explicitly marked `UNKNOWN`.
- **Status vocabulary (requested):** `DONE` · `PARTIAL` · `STUB` · `BROKEN` · `MISSING` · `UNKNOWN`
  - Legacy terms in earlier drafts mapped as: `PASS`→`DONE`, `FAIL`→`BROKEN`, `RISK`→`PARTIAL` (working but risky), `NOT-IMPLEMENTED`/`NOT MET`→`MISSING`, `STALE`→`PARTIAL` (docs only). `STUB` is reserved for placeholder implementations (e.g. F18).

---

## 1. Executive Summary

HiAi-Post is structurally sound for a POC but is **not production-ready**. Lint and typecheck pass; the backend test suite (69 tests) and frontend suite (14 tests) all pass once the broken Vitest pool configuration is bypassed — but in the current working tree **both Vitest suites crash before a single test runs** (Tinypool `RangeError`, 0 tests executed). `bun audit` reports **47 vulnerabilities (1 critical, 20 high, 21 moderate, 5 low)**.

The three most consequential functional gaps are:

1. **The publish pipeline is dead.** The scheduler (`Publisher`) is never started, no platform adapter is ever registered, and `POST /posts/:id/publish` sets `status=publishing` and then nothing ever publishes. Scheduled posts accumulate in Redis/DB forever.
2. **Tenant isolation is asserted, not enforced.** `X-Tenant-Id` is a client-supplied header accepted on trust (no membership check, no JWT-claim cross-check), and the queue API reads `tenantId` from the **query string**, allowing cross-tenant queue inspection. Combined with a migration journal that omits `0001_rbac.sql`, the RBAC layer (which is the only defense) is absent on fresh databases.
3. **The OAuth callback cannot work as written.** The callback is mounted behind `authMiddleware` (Bearer required) and `tenantMiddleware` (`X-Tenant-Id` required), but the provider redirect carries neither. X/Twitter PKCE additionally sends a hardcoded `code_verifier="challenge"` that never matches the `code_challenge`.

**Cross-cutting:** the SvelteKit frontend never sends `X-Tenant-Id` or `Authorization` headers (no `hooks.server.ts`, proxy forwards only existing headers), so **every protected backend call from the app fails**; several page components also reference undefined identifiers (`_`-prefix bug) and read `body.data` where the backend returns `{ post }`/`{ posts }` (see §7, §23, §27).

**Readiness verdict: `NOT READY — BLOCKED`** for production/multi-tenant launch. The CI-critical surface is green at HEAD, but the current working tree breaks the test suites and the runtime gaps above are feature-blocking (see §37 P0 Blockers).

---

## 2. Canonical Repository State

`git status --short` (branch `master`, HEAD `30a54be`):

```
 M app/package.json
 M app/src/lib/config.ts
 M app/src/lib/plugin.ts
 M app/src/routes/+error.svelte
 M app/src/routes/+layout.svelte
 M app/src/routes/dashboard/+page.svelte
 M app/vitest.config.ts
 M backend/vitest.config.ts
 M bun.lock
?? .opencode/
?? app/src/lib/features/          (hiai-kit carousel + scriptforge clients)
?? app/src/routes/carousels/
?? app/src/routes/scripts/
?? audit-report.md
```

- Recent commits: `30a54be` fix(tests) · `957522f` remove MinIO · `f0f8d51` OSS hygiene · `a68fb60`/`cfd1477` CI repairs · `3299b8b` RBAC + HiAiEditor v0.0.8 · `0b23f2b` biome/vitest coverage · `09844cb` @hiai/ui via npm.
- `.opencode/` is untracked and contains only tooling config (`.mcp.json`, package-lock, node_modules) — no audit artifacts.
- `backend/.env` exists (gitignored) with the required local keys present (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, platform keys, `MASTRA_MODEL`, `SENTRY_DSN`, ports, `NODE_ENV`). **`HIAI_ADMIN_JWT_SECRET` and `OAUTH_STATE_SECRET` are NOT set locally** (both optional; OAuth state secret then derives from `BETTER_AUTH_SECRET` per `.env.example:13`).
- **Build artifacts:** `backend/dist/index.js` is **present on disk** (≈10 MB, built 2026-08-01) but is **gitignored (`dist/`, `.gitignore:15`) and untracked — it is NOT committed** (`git ls-files backend/dist/index.js` → empty; `git check-ignore` → ignored; `git show HEAD:backend/dist/index.js` → "path exists on disk, but not in HEAD"). CI uploads `backend/dist/` as an artifact after each build (`.github/workflows/ci.yml:80-84`), so it is reproducible, not a versioned source of drift. **Correction of prior draft F28.**

### No adjacent repositories were modified

This audit was read-only for the whole workspace. Only `hiai-post/audit-report.md` was written. The following sibling repositories under `/home/hiai/projects/` were **inspected read-only only** and were not modified by this audit (their working trees were already in these states before the audit, from unrelated work):

| Repo | HEAD at audit time | Working tree |
|---|---|---|
| hiai-kit | `5397783` | pre-existing dirty (`.gitignore`, `AGENTS.md`, `CHANGELOG.md`, `Caddyfile`, `app/vite.config.ts`, …) |
| hiai-observe | `5e2c5a5` | clean |
| carusel | `faa198f` | pre-existing dirty (`backend/src/*`, `mastra/prompts/*`) |
| script | `d7bd9d2` | pre-existing dirty (deleted `dist/*`) |
| hiai-dashboard | `06e9f4f` | pre-existing dirty (shadcn components) |
| blackbox-audit | — | untracked root tooling files only |

---

## 3. Repositories / Workspace Map

### 3.1 hiai-post workspace (this repo)

```
hiai-post/
├── backend/                  Elysia (Bun) API — routes, middleware, core, workers, Mastra, Drizzle
│   └── src/
│       ├── api/              index.ts, routes/* (14 route files), middleware/* (auth, tenant, rbac, audit, rateLimiter, secureHeaders)
│       ├── core/             analytics/, events/, publisher/ (11 adapters), scheduler/ (publisher, queue, dead-letter, retry, rate-limiter)
│       ├── mastra/           index.ts, agents/{writer,optimizer}.ts, workflows/{content-generate,duplicate-check,platform-format}.ts, tools/web-search.ts
│       ├── workers/          oauth-refresh.ts, dead-letter.ts
│       ├── integrations/     platform API clients
│       ├── db/               schema.ts (13 tables), migrations/ (0000 + orphaned 0001_rbac.sql)
│       └── lib/              redis.ts, db.ts, config.ts, encryption.ts, oauth-state.ts, platform-rules.ts
├── app/                      SvelteKit frontend — routes (posts, accounts, analytics, campaigns, content-plans,
│   │                         templates, dashboard, carousels, scripts, api proxy), lib/ (api, config, plugin,
│   │                         features/{carousel,scriptforge,shared}, components/, stores/)
│   └── src/routes/           26 page/server route files + 2 catch-all proxies (api/v1, api/auth)
├── docs/                     ARCHITECTURE.md (also referenced as source of truth in many findings)
├── docker-compose.yml        api :50300, frontend :50301, postgres(pgvector) :5436, redis :6383
├── .github/workflows/ci.yml  lint / typecheck / test / build / security jobs
└── .gitignore                gitignores dist/, .env, node_modules, .bob/, todo.md, AGENTS.md …
```

### 3.2 Adjacent repositories and the dependency graph (read-only contract audit, 2026-08-10)

| Repo | Purpose | Integration with hiai-post | Type |
|---|---|---|---|
| `hiai-kit/` | Private HiAi platform (Bun monorepo; Elysia backend on port **3000**; carousel + scriptforge content pipelines; Mastra agents) | hiai-post frontend → hiai-kit backend via HTTP/SSE: `/api/v1/carousel/*` (7 endpoints) + `/api/v1/scriptforge/*` (4 endpoints) — all verified **1:1** against `hiai-kit/src/api/routes/{carousel,scriptforge}.ts`; constants match (`MAX_SLIDES = 10`, 7 identical presets) | **PEER_SERVICE** (not a package dep; no shared workspace) |
| `hiai-observe/` | Unified observability plane (port 8001): Sentry-compatible ingest, OTLP traces/metrics, AI cost | hiai-post declares `SENTRY_DSN` but consumes nothing (no SDK, no ingest calls) → **DORMANT**; active consumers are hiai-kit (OTLP healthy, Sentry ingest **BROKEN** — see §29) | PEER_SERVICE (declared only) |
| `carusel/` | Standalone Instagram carousel generator (`/api/carusel/*`, port 50600) | **NONE** — zero references in hiai-post; domain absorbed into hiai-kit (`hiai-kit/src/modules/carousel/steps/carusel.ts`) | LEGACY origin |
| `script/` | "scriptforge-ai" AI Reels script SPA (`/api/run-pipeline`, Vite middleware) | **NONE** — hiai-post's `/scripts` page consumes hiai-kit's `/api/v1/scriptforge/*`, not this repo; implementation absorbed into hiai-kit (`src/modules/scriptforge/*`) | LEGACY origin |

```
hiai-post frontend ──HTTP/SSE──▶ hiai-kit backend   /api/v1/carousel, /api/v1/scriptforge   [DONE — healthy]
hiai-post backend  ──declared──▶ hiai-observe       SENTRY_DSN (unused in code)             [MISSING — dormant]
hiai-kit           ──OTLP──────▶ hiai-observe       POST /v1/traces + /v1/metrics, Bearer   [DONE]
hiai-kit           ──Sentry────▶ hiai-observe       POST /api/:pid/store, X-Sentry-Auth     [BROKEN — 401]
hiai-kit           ──npm dep───▶ @hiai-gg/hiai-observe@0.2.0 (repo now 0.2.1)               [PARTIAL — stale pin]
hiai-post backend  ◀──webhook── hiai-store          POST /api/v1/webhooks/store-product      [adjacent, not audited]
carusel / script   ──absorbed──▶ hiai-kit modules (carousel, scriptforge)                  [PARTIAL — legacy origins]
```

---

## 4. What HiAi-Post Actually Is Today

**Positioning (README/ARCHITECTURE):** a multi-tenant social media content planning & publishing platform — schedule posts, connect platform accounts (X, Instagram, Facebook, LinkedIn, Pinterest, Threads, TikTok, YouTube, Telegram), generate AI content, auto-publish via webhooks, and view analytics.

**What actually exists in code (2026-08-10):**

| Surface | Reality | Status |
|---|---|---|
| Multi-tenant API (Elysia) with auth, tenant, RBAC middleware | Present; auth works; tenant is header-trust only; RBAC blocked on fresh DB (F23) | PARTIAL |
| Posts CRUD + scheduling + campaigns + content-plans + templates | Present (routes + tables); scheduling writes an orphaned queue (F5) | PARTIAL |
| Publishing to 11 platform variants | Adapter code exists but is dead — pipeline never started (F1-F3) | BROKEN |
| OAuth connect for platforms | Callback unreachable; X PKCE broken (F13-F14) | BROKEN |
| AI generation (Mastra workflows + writer/optimizer agents) | Route exists but input contract mismatched, no persistence, duplicate-check is a stub (F17-F18) | BROKEN |
| Analytics (overview/platforms/top-posts/best-times) | Routes + DB-only aggregation exist; collector never runs; frontend page broken | PARTIAL |
| hiai-store product webhook → draft post | Working end-to-end (secret-gated, dedup via contentHash) | DONE |
| Carousel + Script pages | Present (untracked) but depend on external hiai-kit backend at `http://localhost:3000` (F25) | PARTIAL (external dep) |
| Frontend app | Renders; 14 unit tests pass; but cannot authenticate to the backend and has undefined-identifier/response-shape bugs (see §7, §27) | BROKEN |

**Not a real product yet — a POC with a promising skeleton and a broken runtime spine.** The queue → scheduler → publisher → platform → SSE pipeline that is the product's core value proposition exists only as dead/orphaned code.

---

## 5. Current Architecture (actual vs docs)

### 5.1 Documented architecture (docs/ARCHITECTURE.md)

```
[Frontend SvelteKit] ──proxy──▶ [Elysia API]
  ├─ Better Auth (session cookie) → RBAC (owner>admin>editor>viewer)
  ├─ [Scheduler Module] ──cron──▶ [Publisher] ──adapters──▶ X / IG / FB / LinkedIn / Pinterest
  │                                                          Threads / TikTok / YouTube / Telegram / …
  ├─ [Redis queue] + retry(1/5/15min) + dead-letter(Redis list)
  ├─ [Mastra workflows] extract-params → content-write → duplicate-check → platform-format → polish-output
  │     ("Posts created as 'draft'", ARCHITECTURE.md:170; pgvector embedding, :82)
  ├─ [Error Reporter (pino → DSN)] via hiai-observe (ARCHITECTURE.md:66-68,88-96)
  └─ [Analytics collector] platform APIs → post_analytics upsert (ARCHITECTURE.md ~380+)
```
Source: `docs/ARCHITECTURE.md:60-68,82,88-96,170,214,317,371-379,477-506`.

### 5.2 Actual architecture (verified by trace + grep, 2026-08-10)

```
[Frontend SvelteKit] ──proxy (/api/v1/*, /api/auth/*)──▶ [Elysia API]
  ├─ auth: Bearer-token middleware (auth.ts:74)  +  tenant: X-Tenant-Id header-trust (tenant.ts:10)  ← frontend sends NEITHER
  ├─ RBAC (rbac.ts:75-130) — bypassable when ids missing; DB tables absent on fresh install (F23)
  ├─ posts CRUD ──▶ Redis ZSET member = bare postId        (lib/redis.ts:41)      ← used by routes
  ├─ /api/v1/queue/* ──▶ Redis ZSET member = tenantId:postId (scheduler/queue.ts:48) ← format conflict (F5)
  ├─ POST /posts/:id/publish → status="publishing" ──▶ (nothing consumes)          (F2)
  ├─ [Publisher.start() + adapters + cron] ── never started; 0 callers            (F1, F3)
  ├─ [Mastra workflows] ── in-memory only, no storage (mastra/index.ts:6-17); duplicate-check STUB (F17-F18)
  ├─ workers: oauth-refresh ✓ started; dead-letter (DB posts table, status="dead") (api/index.ts:92-93)
  ├─ OAuth callback — mounted inside protectedApp → 401 before handler (F13)
  └─ hiai-observe/Sentry — no SDK anywhere (F26)
```

**Documented vs actual — key deltas:** the Scheduler/Publisher/Error Reporter drawn in ARCHITECTURE.md do not run; the analytics collector is unwired; the OAuth callback is drawn as a bare redirect (ARCHITECTURE.md:214) but is actually auth-gated; dead-letter is drawn as a Redis **list** but implemented as **ZSETs** (F6); the frontend→API leg of the diagram does not work (no headers).

### 5.3 Module Readiness Matrix (M1)

| Module | Files | Lint | Typecheck | Tests | Runtime wiring | Readiness |
|---|---|---|---|---|---|---|
| API core (Elysia app, middleware) | `src/api/index.ts`, `middleware/*` | DONE | DONE | n/a | Starts | PARTIAL (F9, F13) |
| Auth (Better Auth + JWT bridge) | `src/auth/index.ts`, `middleware/auth.ts` | DONE | DONE | 17 tests pass (auth-jwt, auth) | Works | PARTIAL (F13) |
| Tenant scoping | `middleware/tenant.ts`, `rbac.ts` | DONE | DONE | 11 tests pass (rbac) | Wired but trust-based | BROKEN (F9, F10, F23) |
| Posts CRUD + schedule | `routes/posts.ts` | DONE | DONE | — | Writes queue (Impl A) | PARTIAL (F2, F5) |
| Publish pipeline | `core/publisher/`, `core/scheduler/publisher.ts` | DONE | DONE | 20 tests pass (queue, scheduler) | **Not started** | BROKEN (F1-F4) |
| Queue / dead-letter | `core/scheduler/queue.ts`, `lib/redis.ts`, `workers/dead-letter.ts` | DONE | DONE | 9+11 tests pass | Divergent impls | BROKEN (F5-F8) |
| OAuth connect/callback | `routes/oauth.ts`, `workers/oauth-refresh.ts` | DONE | DONE | — | Callback broken | BROKEN (F13-F16) |
| Analytics | `core/analytics/*`, `routes/analytics.ts` | DONE | DONE | — | Present, collector unwired | UNKNOWN (no live verification) |
| AI generation (Mastra) | `mastra/*`, `routes/generate.ts` | DONE | DONE | — | Stateless, no persistence | BROKEN (F17-F19) |
| Webhooks (hiai-store) | `routes/webhooks.ts` | DONE | DONE | — | Works (secret-gated) | PARTIAL (F24) |
| Frontend app | `app/src/*` | DONE | DONE | 14 tests pass | Renders; cannot auth to API | BROKEN (see §7, §27) |
| Carousel / Script pages | `app/src/lib/features/*`, routes | DONE | DONE | — | External hiai-kit dep | PARTIAL (F25) |
| Observability (hiai-observe) | `config.ts`, docs | DONE | DONE | n/a | **Not wired** | MISSING (F26) |
| Migrations | `db/migrations/*` | n/a | n/a | n/a | Journal incomplete | BROKEN (F23) |
| CI | `.github/workflows/ci.yml` | DONE (at HEAD) | DONE (at HEAD) | DONE (at HEAD) | Vitest + coverage | PARTIAL (E3/E4 if poolOptions committed) |

### 5.4 Documentation claims vs reality (F27, F28)

| ID | Severity | Status | Finding | Evidence |
|----|----------|--------|---------|----------|
| F27 | LOW | PARTIAL | **Stale README claims:** "Run tests … (58 tests)" — actual backend suite is 69; architecture diagram advertises a live "Scheduler Module"/"Publisher" and "Error Reporter (pino → DSN)" that do not run. | `README.md:30,66-74`; `docs/ARCHITECTURE.md:60-68` |
| F28 | LOW | PARTIAL | ~~`backend/dist/index.js` build artifact is committed~~ — **CORRECTED: `backend/dist/index.js` is present on disk (≈10 MB) but is gitignored (`dist/`, `.gitignore:15`) and untracked — NOT committed.** A gitignored build artifact is normal; CI regenerates it every build (`ci.yml:80-84`). Residual risk is only that a stale local artifact could be confused with source. | `.gitignore:15`; `git ls-files backend/dist/index.js` → empty; `git check-ignore` → ignored; `ci.yml:80-84` |

---

## 6. Runtime Verification Results

All checks run locally on 2026-08-10 (commands in the Appendix).

| # | Claim / check | Command | Result | Status |
|---|----------------|---------|--------|--------|
| E1 | Root lint (biome, both workspaces) | `bun lint` | backend 87 files, frontend 47 files checked; exit 0 both | **DONE** |
| E2 | Typecheck backend + frontend | `bun typecheck` | `tsc --noEmit` backend; `svelte-kit sync && tsc --noEmit` frontend; exit 0 both | **DONE** |
| E3 | Backend Vitest suite | `cd backend && bunx vitest run` | 0 tests run; `RangeError: options.minThreads and options.maxThreads must not conflict` (Tinypool 1.1.1, `createForksPool`); exit 1 | **BROKEN** |
| E4 | Frontend Vitest suite | `cd app && bunx vitest run` | 0 tests run; identical Tinypool `RangeError`; exit 1 | **BROKEN** |
| E5 | Backend suite, pool override (no file changes) | `cd backend && bunx vitest run --pool=threads` | 8 files / **69 tests passed** | **DONE** |
| E6 | Frontend suite, pool override | `cd app && bunx vitest run --pool=threads` | 1 file / **14 tests passed** (`sse.test.ts`) | **DONE** |
| E7 | bun:test runner (whole repo) | `bun test` | 90 tests across 10 files: **83 pass, 7 fail** — all 7 are E2E (`app/tests/e2e/post.spec.ts`) failing `Frontend is not reachable at http://localhost:50301` (needs dev stack or `HIAI_POST_E2E_SKIP=1`) | **PARTIAL** |
| E8 | Dependency audit | `bun audit` | **47 vulnerabilities: 1 critical, 20 high, 21 moderate, 5 low** | **BROKEN** |
| E9 | Git working-tree vs HEAD | `git diff` + `git status` | `poolOptions` blocks (threads + forks) added to **both** vitest configs are **uncommitted** | PARTIAL (risk) |

**Root cause of E3/E4:** the uncommitted `poolOptions` blocks in `backend/vitest.config.ts:8-16` and `app/vitest.config.ts:8-16` add `forks: { maxForks: 9 }` (no `minForks`). Vitest 2.1.9 default-pool is `forks`; Tinypool 1.1.1 rejects the resulting `minThreads`/`maxThreads` combination **before collecting any test**. With `--pool=threads` (valid `minThreads: 1, maxThreads: 9`) all tests pass — proving the suites are healthy and the config block is the sole blocker. HEAD's committed configs (no `poolOptions`) are unaffected, so CI at HEAD is not broken by this; the current **working tree** is.

**Explicitly unverified (UNKNOWN):** production environment values (`HIAI_ADMIN_JWT_SECRET`, `SENTRY_DSN`, `MASTRA_MODEL`, real platform credentials); whether production DBs were migrated manually (incl. `0001_rbac.sql`); hiai-kit backend availability/version in prod; CI status at HEAD (inferred green from commit history, not re-run); live analytics aggregation; E2E suite with the full stack running. No runtime services (postgres/redis) were started; DB-dependent behavior (migrations, RBAC against real data, webhook dedup) was assessed statically.

---

## 7. End-to-End Workflow Verification

Step-by-step chains traced by following every import/call edge (read-only; all hops `file:line`). Classification uses the status vocabulary; "where unknown" flows are explicitly marked UNKNOWN rather than guessed.

### 7.1 Create project / content (campaign → content-plan → post)

| Hop | Location |
|---|---|
| Frontend campaigns page load | `app/src/routes/campaigns/+page.server.ts` → `/api/v1/campaigns` (proxy `app/src/routes/api/v1/[...path]/+server.ts:75` → `proxy()` 24-73) |
| Campaigns CRUD (list/get/pause/resume/bulk-schedule) | `backend/src/api/routes/campaigns.ts:23,46,66,93,139,187,243,260,281` |
| Content-plans CRUD | `backend/src/api/routes/content-plans.ts:18,48,62,81,100` |
| Templates CRUD | `backend/src/api/routes/templates.ts:18,45,59,77,92` |
| Post create (DB insert + enqueue) | `app/src/routes/posts/new/+page.svelte:16` `_save()` → `fetch("/api/v1/posts")`; `backend/src/api/routes/posts.ts:80` insert (84-97); `posts.ts:101` → `lib/redis.ts:35` `enqueuePost()` → `zadd publish_queue:{tenantId} score postId` (member = **bare postId**, `lib/redis.ts:41`) |

**Status: BROKEN.** Frontend bugs: `posts/new/+page.svelte:64,102-107` reference undefined `save`/`saving`/`PLATFORMS` (`_`-prefix); `:28` reads `body.data.id` but the backend returns `{ post }` → redirect to `/posts/undefined`. Also the **"projects" entity does not exist** in `db/schema.ts` (grep: zero matches) — the closest analogs are `campaigns` and `contentPlans`. Frontend→backend chains for campaigns/content-plans were verified only to the proxy/route level (handlers are thin CRUD); full runtime behavior for those pages is **UNKNOWN** (not traced with a running stack).

### 7.2 Research

| Hop | Location |
|---|---|
| Web-search tool (Tavily-backed) | `backend/src/mastra/tools/web-search.ts:1-30` (`createTool({ id: "web-search" })`, endpoint `api.tavily.com/search`, timeout 10s) |
| Importers of `webSearchTool` | **none in code** (grep: only a config comment at `backend/src/lib/config.ts:50`) |

**Status: MISSING as a product workflow.** No research stage exists in any workflow or route; the only research primitive (a web-search tool) is orphaned. If `TAVILY_API_KEY` is unset the tool falls back to empty results by design (config comment). Any "research" UX in the docs has no implementation.

### 7.3 Writing / AI generation

| Hop | Location |
|---|---|
| Frontend | `posts/new/+page.svelte:35` `_generateWithAI()` → POST `/api/v1/posts/generate` `{topic, platforms:[platform]}` (39-43); reads `body.posts?.[0]?.content` (46-48) |
| Route | `backend/src/api/routes/generate.ts:21` → inline `generateRequestSchema` (11-17) → `contentGenerateWorkflow.createRun()` (25-26) → `run.start({ inputData: {topic, language, platforms, tone, additionalContext} })` (27-35) |
| **Input contract mismatch** | Workflow `inputSchema` is `{ input: z.string() }` (`mastra/workflows/content-generate.ts:241`); `extractParamsStep` reads `inputData.input` (67,77). The route never passes `input` → validation failure or `topic = undefined` |
| Step 1 extract-params | `content-generate.ts:61-96` |
| Step 2 content-write | `content-generate.ts:98-142` (hardcodes `platform: "instagram"`, 125/135) |
| Step 3 duplicate-check | `content-generate.ts:144-155` — **STUB, always `isDuplicate: false`**; real impl `mastra/workflows/duplicate-check.ts:7` (Jaccard >0.7, substring >0.5, pgvector >0.85) is **dead code — never imported**; pgvector `embedding` column absent from `schema.ts`, so Tier-3 silently no-ops (try/catch 115-138) |
| Step 4 platform-format | `content-generate.ts:157-216` (inline); `mastra/workflows/platform-format.ts` (`platform-format-single`) is **dead code — never imported** |
| Step 5 polish-output | `content-generate.ts:218-237` |
| Result | `PolishOutput` (35-47) has **no `isDuplicate`** → `generate.ts:45` `result.result.isDuplicate` always `undefined` → 409 branch (47-53) never fires |
| **No DB insert** | `generate.ts` returns generated posts but **never calls `db.insert(posts)`** — ARCHITECTURE.md:170 "Posts created as 'draft'" is **not implemented** |

**Status: BROKEN.** Also: no `generate`-tier rate limiter on the route (`api/middleware/rateLimiter.ts:16` exists, unused); route is inside `protectedApp` so frontend calls fail on missing headers too (cross-cutting).

### 7.4 Script (scriptforge)

| Hop | Location |
|---|---|
| Page | `app/src/routes/scripts/+page.svelte:443` "Streaming events live from the hiai-kit backend" |
| Client | `app/src/lib/features/scriptforge/api.ts:81-109` → `GET /api/v1/scriptforge/run-pipeline`, `GET /continue-pipeline` (SSE), `POST /re-polish`, `POST /re-polish-saved`; SSE framing parsed by `app/src/lib/features/shared/sse.ts` |
| Server | hiai-kit backend `hiai-kit/src/api/routes/scriptforge.ts` (all 4 endpoints verified verbatim) |
| Base URL | `app/src/lib/config.ts:8` `PUBLIC_HIAI_KIT_URL ?? "http://localhost:3000"`; defaults to language `"ru"` (`scriptforge/api.ts`) |

**Status: PARTIAL (external).** Works only if the hiai-kit backend is running; without it the page 502s/streams nothing (F25). Runtime against a live hiai-kit was **UNKNOWN** in this audit (no services started).

### 7.5 Carousel

| Hop | Location |
|---|---|
| Page | `app/src/routes/carousels/+page.svelte` |
| Client | `app/src/lib/features/carousel/api.ts` → `GET /api/v1/carousel/list`, `/by-slug/:slug`, `/:id`, `/:id/slide/:n/json`, `/:id/cover.png`, `POST /`, `POST /:id/slide/:n/regenerate` |
| Server | hiai-kit backend `hiai-kit/src/api/routes/carousel.ts` (all 7 endpoints verified verbatim; `MAX_SLIDES = 10` matches `MAX_CAROUSEL_SLIDES = 10`; 7 identical presets) |

**Status: PARTIAL (external).** Same external-dependency caveat as script; write routes additionally require hiai-kit session auth (`requireAuth` + `agents:write` RBAC) while hiai-post calls with `credentials: "include"` — cross-domain cookies only work under the "unified" host mode, not standalone multi-port dev. Live runtime: **UNKNOWN**.

### 7.6 hiai-store webhook auto-publish

| Hop | Location |
|---|---|
| Route (outside protectedApp) | `backend/src/api/routes/webhooks.ts:51` POST `/api/v1/webhooks/store-product` (mounted `api/index.ts:81`, before `protectedApp`) |
| Secret verify | `webhooks.ts:28` `verifyWebhookSecret()` — `timingSafeEqual` vs `HIAI_STORE_WEBHOOK_SECRET` (`config.ts:21`); 503 if unset (55-59), 401 if mismatch (62-66) |
| Zod validate | `webhooks.ts:68` + `storeProductWebhookSchema` (13-20) |
| Dedup | `webhooks.ts:73-76` `SHA-256(tenantId:productId:platform).slice(0,16)` → lookup `posts.contentHash` (78-91) → 200 deduplicated |
| Draft insert | `webhooks.ts:102-113` insert `posts` (status `draft`, `mediaUrls=[productImage?]`, `contentJson` source marker) → 201 |

**Status: DONE (flow works) / PARTIAL (audit gap).** Contradiction: ARCHITECTURE.md:477-479 claims every webhook INSERT is audited, but `auditMiddleware` is registered **inside** `protectedApp` (`api/index.ts:54`) while webhooks are mounted outside (81) → webhook requests are **never audited** (audit.ts requires `ctx.user`/`ctx.tenantId`). Minor: unknown `tenantId` → FK violation → 500. `core/events/store-listener.ts` Redis pub/sub listener is scaffold-only, self-documented as not wired (`store-listener.ts:5-13`).

### 7.7 Schedule / publish

| Hop | Location |
|---|---|
| Schedule | `backend/src/api/routes/posts.ts:176-197` `POST /:id/schedule` → re-update by `id` (189-193) → enqueue `posts.ts:195` → `lib/redis.ts:35-41` (bare postId member) |
| Publish-now | `posts.ts:199-223` `POST /:id/publish` → sets `status="publishing"`, returns "Post queued for immediate publishing" → **nothing consumes it** (F2) |
| Scheduler | `core/scheduler/publisher.ts:50` `class Publisher`, `start()` at 59 — **never instantiated/started anywhere**; `api/index.ts:92-93` starts only `startOAuthRefreshWorker()` + `startDeadLetterProcessor()` (F1) |
| Adapters | `core/publisher/index.ts:58` `publish()` (switch over 11 platform variants) — **dead code, never imported**; `registerPublisher` never called (F3) |
| Queue consumer | `core/scheduler/queue.ts:48` reads members as `tenantId:postId` (split on `:`) — format conflict with writer (F5) |
| SSE feedback | `backend/src/api/routes/events.ts:18` `broadcastEvent()` — **never called anywhere**; endpoint requires auth+tenant headers an `EventSource` can't send |
| Dead-letter retry | `POST /api/v1/queue/retry/:postId` (`api/routes/queue.ts:34-46`) → `DeadLetterQueue.retryDeadLetter` (`core/scheduler/dead-letter.ts:41-54`) which only `ZREM`s — **never re-enqueues**; `PublishQueue.retryDeadLetter` (`queue.ts:108-122`) does re-enqueue but is not used by the route |

**Status: BROKEN.** Campaigns also enqueue via `campaigns.ts:173,235` (same Impl A format). Retry table (1/5/15 min, `core/scheduler/retry.ts:3-7`) matches ARCHITECTURE but is reachable only through the never-started Publisher. Publish idempotency key `(social_account_id, content_hash)` (ARCHITECTURE.md:379) — **not implemented anywhere**.

### 7.8 Revision / approval

**Status: MISSING / UNKNOWN.** Grep for approval/revision/review workflows across `backend/src` and `app/src` found **no revision or approval state machine** — no status values beyond `draft/scheduled/publishing/published/failed/dead` (`db/schema.ts:75`), no reviewer role flow (RBAC roles are `owner/admin/editor/viewer`, `schema.ts:180-202` — no "approver"), no revision history on posts (single `updatedAt`). Editing exists only as direct editing (see §15). Any revision/approval workflow described in product docs is **UNKNOWN** (nothing found in code).

### 7.9 Supporting traces (from the 6-flow trace pass)

- **OAuth connect → callback → token store — BROKEN:** frontend `accounts/+page.svelte:19` calls POST but backend route is GET (`oauth.ts:99`); reads `body.url` but backend returns `{ authUrl }` (130); callback mounted inside `protectedApp` (`api/index.ts:62`) → 401 before handler (F13); X PKCE `code_challenge=state` vs hardcoded `code_verifier="challenge"` (`oauth.ts:126-127,184`) (F14); token encryption is sound (AES-256-GCM, `lib/encryption.ts:19-30,52`); insert at `oauth.ts:316-331`.
- **OAuth token refresh worker — DONE (with gaps):** started at `api/index.ts:92`; polls every 30 min (`oauth-refresh.ts:17-49`); strategies for IG/FB/Threads/X/LinkedIn/Pinterest (66-87,152-201); **no strategy for tiktok/youtube/telegram** (warn + return, 84-86) (F16); on failure logs only — **never sets `status="expired"`** as ARCHITECTURE.md:317 specifies.
- **Analytics aggregation — BROKEN:** frontend `analytics/+page.server.ts:3` fetches `/api/v1/analytics/*` with `?tenantId=` query param (14-22) — backend middleware reads header only → 401/400; route then trusts `query.tenantId` (analytics.ts:21) → cross-tenant; `core/analytics/collector.ts:151` `collectAllMetrics()` and `aggregator.ts:319` `collectAnalyticsForAccount()` are **never called** → `post_analytics` never populated; `/analytics/posts/:postId` (analytics.ts:78-109) has **no tenant filter**; page component references undefined `a`/`platforms`/`topPosts`/… (`_`-prefix, 5-44 vs template 55-215).

---

## 8. Product Surface Inventory

### Backend API surface (`backend/src/api/routes/`)

| Route file | Exposed (method-path) | Notes |
|---|---|---|
| `health.ts` | GET `/health`, GET `/api/v1/health` (18,23) | Healthcheck target for compose (`docker-compose.yml:21`) |
| `auth.ts` | Better Auth handlers (mounted at `/api/auth/*`, `api/index.ts`) | Session/account/verification tables |
| `accounts.ts` | Platform account connect/disconnect/list | Frontend `accounts/+page.svelte` broken (F13, §7.9) |
| `oauth.ts` | GET `/:platform/connect`, GET `/:platform/callback`, POST `/:platform/disconnect`, token refresh helpers (99,132,125-128,183-185,224-331) | Callback broken (F13-F16) |
| `posts.ts` | POST `/`, GET `/`, GET `/:id`, PATCH/PUT `/:id`, DELETE, POST `/:id/schedule`, POST `/:id/publish` (80-223) | Publish dead-end (F2); schedule race (F12) |
| `generate.ts` | POST `/api/v1/posts/generate`, `/optimize` (21-103) | Input mismatch, no persistence (F17-F19) |
| `campaigns.ts` | CRUD + `/:id/progress|pause|resume|bulk-schedule` (23-283) | Enqueues via Impl A (173,235) |
| `content-plans.ts` | CRUD (18-102) | Thin CRUD; runtime UNKNOWN |
| `templates.ts` | CRUD (18-94) | Thin CRUD |
| `analytics.ts` | `/overview|platforms|top-posts|best-times|posts/:postId` (15-191) | Tenant query-param trust; collector unwired |
| `queue.ts` | `/scheduled|pending|failed`, `/retry/:postId`, `/dead-letter` (10-55) | Query-string `tenantId` (F7); retry doesn't re-enqueue |
| `events.ts` | SSE stream (75) | `broadcastEvent` never called; auth-gated SSE unusable |
| `webhooks.ts` | POST `/api/v1/webhooks/store-product` (51) | Working (F24 note); not audited |
| `youtube.ts` | `/connect|callback|upload|status|channel` (128-322) | Parallel OAuth+upload surface; refresh strategy MISSING (F16) |

### Frontend surface (`app/src/routes/`)

Pages: `+page` (landing), `dashboard`, `posts` (+ `new`, `[id]`), `accounts`, `analytics`, `campaigns` (+ `new`), `content-plans`, `templates`, `carousels` (untracked), `scripts` (untracked); catch-all proxies `api/v1/[...path]` and `api/auth/[...path]`; `+error.svelte` (modified in working tree).

### Untracked feature code (working tree, not in git)

`app/src/lib/features/{carousel,scriptforge,shared}`, `app/src/routes/carousels/`, `app/src/routes/scripts/` — hiai-kit clients (F25). These are present only in the working tree; a fresh clone of `master` has **no carousel/script pages**.

---

## 9. Content Domain Model

Tables in `backend/src/db/schema.ts` (Drizzle, 13 tables):

| Table | Lines | Role | Status |
|---|---|---|---|
| `tenants` | 18 | Top-level tenant (workspace) | DONE |
| `socialAccounts` | 30 | Connected platform accounts + encrypted tokens | DONE |
| `posts` | 61 | Content posts; `status` enum at 75 (`draft/scheduled/publishing/published/failed` — comment omits `dead` which the worker writes, F24); `contentHash` (dedup key, 73); `mediaUrls` jsonb (73) | DONE (enum drift) |
| `contentPlans` | 92 | Calendar/content plans | DONE |
| `campaigns` | 113 | Campaigns with progress/pause/resume/bulk-schedule | DONE |
| `postTemplates` | 132 | Reusable templates | DONE |
| `postAnalytics` | 151 | Per-post analytics (upsert target) | DONE (never populated — §7.9) |
| `tenantMembers` | 183 | RBAC membership (created by `0001_rbac.sql`, F23) | BROKEN on fresh DB |
| `auditLogs` | 205 | Audit trail; `role` + `audit_logs_actor_idx` from `0001_rbac.sql` (F23) | PARTIAL |
| `user/session/account/verification` | 234-274 | Better Auth tables | DONE |

**No `projects` entity** (grep: zero matches) — §7.1. **No embedding column** (pgvector used by the dead duplicate-check Tier-3) — `schema.ts` has none (F17 note). **No revisions table** — §7.8.

---

## 10. Research

| Capability | Location | Status |
|---|---|---|
| Web search tool (Tavily) | `backend/src/mastra/tools/web-search.ts:1-30` | STUB/orphaned — zero importers; `TAVILY_API_KEY` optional, falls back empty |
| Research stage in any workflow | — | MISSING |
| Research UX (frontend) | — | MISSING |

**Status: MISSING as a product workflow** (see §7.2). The only primitive is an orphaned tool.

---

## 11. Writing

| Capability | Location | Status |
|---|---|---|
| Mastra agents: `writer`, `optimizer` | `backend/src/mastra/agents/writer.ts:3`, `optimizer.ts:3`, registered `mastra/index.ts:12-13` | DONE (registered); runtime use by workflows **UNKNOWN** in this pass |
| Generation workflow | `mastra/workflows/content-generate.ts` (5 steps, 61-237) | BROKEN — input mismatch, hardcoded `instagram`, no persistence (F17-F19, §7.3) |
| Duplicate check | inline stub `content-generate.ts:144-155`; real impl `duplicate-check.ts:7` dead | STUB |
| Platform formatting | inline `content-generate.ts:157-216`; `platform-format.ts` dead | PARTIAL |
| `/api/v1/posts/generate`, `/optimize` | `generate.ts:21-103` | BROKEN (no `db.insert`, no `isDuplicate`, no tenant scoping F19) |

**Findings (AI — persistence & isolation):**

| ID | Severity | Status | Finding | Evidence |
|----|----------|--------|---------|----------|
| F17 | HIGH | PARTIAL | **No AI persistence.** `createMastra()` sets no `storage` — Mastra defaults to in-memory; no threads/messages survive restart. The `/api/v1/posts/generate` route builds a fresh workflow run per request; `/optimize` is stateless. | `backend/src/mastra/index.ts:6-17`; `backend/src/api/routes/generate.ts:21-103` |
| F18 | MED | STUB | **Duplicate-content check is a stub** — always `{ isDuplicate: false }`, so the 409 duplicate path in `generate.ts:47-53` is unreachable. | `backend/src/mastra/workflows/content-generate.ts:144-155` |
| F19 | MED | PARTIAL | **No tenant scoping of AI runs** — `tenantId` is never passed into the workflow; no per-tenant usage/cost accounting (a hiai-observe claim, see F26). | `backend/src/api/routes/generate.ts:27-35`; `docs/ARCHITECTURE.md:94-95` |

---

## 12. Script

- **What exists:** `app/src/routes/scripts/+page.svelte` (untracked) + `app/src/lib/features/scriptforge/api.ts` + `shared/sse.ts`; consumes **hiai-kit's** `/api/v1/scriptforge/*` (4 endpoints, SSE-framed).
- **Status: PARTIAL (external dep).** Works only when hiai-kit runs at `PUBLIC_HIAI_KIT_URL` (default `http://localhost:3000`; `config.ts:8`); defaults to language `"ru"` (`scriptforge/api.ts`). Without hiai-kit → 502/streams nothing (F25). Live runtime **UNKNOWN** (no services started).
- **Origin:** the standalone `script/` repo ("scriptforge-ai") is a legacy origin absorbed into hiai-kit (`hiai-kit/src/modules/scriptforge/*`); hiai-post has **zero** coupling to the `script/` repo (§3.2).
- **Ownership question:** see §45 Q1.

---

## 13. Carousel

- **What exists:** `app/src/routes/carousels/+page.svelte` (untracked) + `app/src/lib/features/carousel/api.ts`; consumes **hiai-kit's** `/api/v1/carousel/*` (7 endpoints, constants 1:1 with hiai-kit).
- **Status: PARTIAL (external dep).** Same caveats as Script (F25, §7.5); write routes need hiai-kit session auth (`requireAuth` + `agents:write` RBAC) incompatible with standalone multi-port dev cookies.
- **Origin:** `carusel/` repo (standalone generator, `/api/carusel/*`, port 50600) is a legacy origin absorbed into hiai-kit (`hiai-kit/src/modules/carousel/`); hiai-post has **zero** coupling to `carusel/` (§3.2).

---

## 14. Visual Content

| Capability | Location | Status |
|---|---|---|
| Post media storage | `posts.mediaUrls` jsonb (`schema.ts:73`), set from webhook `mediaUrls=[productImage?]` (`webhooks.ts:102-113`) | PARTIAL |
| Carousel cover/slide images | via hiai-kit `/:id/cover.png`, `/:id/slide/:n/json` (`features/carousel/api.ts`) | PARTIAL (external) |
| YouTube upload thumbnails | `youtube.ts:237` fetches `content-type` before upload | PARTIAL (unverified live) |
| Local image/media pipeline (upload, resize, object storage) | — | MISSING (MinIO was removed in `957522f`) |
| Video processing / Reels asset generation | — | MISSING (handled by hiai-kit scriptforge/carousel externally) |

**Status: MISSING locally.** hiai-post stores media URLs only; all image/video asset generation lives in hiai-kit.

---

## 15. Editing & Revisions

| Capability | Location | Status |
|---|---|---|
| Post editor component | `app/src/lib/components/PostEditor.svelte` (imports HiAiEditor from `@hiai/ui` v0.0.8; commit `3299b8b` "HiAiEditor v0.0.8") | PARTIAL — `PostEditor.svelte` is listed among files with `_`-prefix undefined-identifier compile failures (§27) |
| Post edit route | `posts/[id]/+page.svelte` + `+page.server.ts` (reads `body.data` vs `{ post }` mismatch) | BROKEN (response-shape) |
| Revision history / diff | — | MISSING |
| Review/approval workflow | — | MISSING (§7.8) |

---

## 16. Brand / Project Context

| Capability | Location | Status |
|---|---|---|
| Tenant (workspace) context | `tenants` table (`schema.ts:18`); `X-Tenant-Id` header (`tenant.ts:8-27`) | PARTIAL (header-trust, F9) |
| Campaigns (grouped posts) | `campaigns.ts` CRUD + progress/pause/resume/bulk-schedule (23-283); `campaigns` table (113) | PARTIAL (schedule enqueue orphaned) |
| Content plans (calendar plans) | `content-plans.ts` CRUD (18-102); `contentPlans` table (92) | PARTIAL (thin CRUD) |
| Brand assets / voice / style per tenant | — | MISSING |
| "Projects" entity | — | MISSING (no `projects` in schema; closest = campaigns/content-plans) |

---

## 17. Multi-Channel Adaptation

| Capability | Location | Status |
|---|---|---|
| Platform adapters (11 variants) | `backend/src/core/publisher/index.ts:58-254` switch (`publish()`) — IG, FB, X, LinkedIn, Pinterest, Threads, TikTok, YouTube, Telegram + | BROKEN (dead code, F3) |
| Platform rules (char limits, media, best times) | `backend/src/lib/platform-rules.ts` (tested: 6 tests in `__tests__/platform-rules.test.ts`) | DONE (unit-tested) |
| Platform-format workflow step | `content-generate.ts:157-216` (inline, hardcodes instagram) + dead `platform-format.ts` | PARTIAL |
| Per-platform account storage | `socialAccounts` + encrypted tokens (`schema.ts:30`; `lib/encryption.ts:19-30`) | DONE |
| Platform refresh strategies | `workers/oauth-refresh.ts:66-87` — IG/FB/Threads/X/LinkedIn/Pinterest only | PARTIAL (F16: tiktok/youtube/telegram MISSING) |

**Status: PARTIAL.** The adapters are written but unreachable; rules are unit-tested; refresh coverage is incomplete.

---

## 18. Calendar & Scheduling

**Findings (publish pipeline & scheduler):**

| ID | Severity | Status | Finding | Evidence |
|----|----------|--------|---------|----------|
| F1 | **CRIT** | BROKEN | **Scheduler never started.** `api/index.ts` starts only `startOAuthRefreshWorker()` and `startDeadLetterProcessor()`; no `Publisher.start()` is ever called. `Publisher.start()` exists (`core/scheduler/publisher.ts:59-69`) but has **zero callers** (grep: no `new Publisher(`, no `registerPublisher(` anywhere outside its own definition). | `backend/src/api/index.ts:92-93`; `backend/src/core/scheduler/publisher.ts:59-69`; grep `registerPublisher\|new Publisher` → only defs |
| F4 | HIGH | PARTIAL | **Rate-limiter/retry logic is dead code** — only reachable via the never-started Publisher. | `backend/src/core/scheduler/rate-limiter.ts`, `retry.ts` (callers: publisher only) |

Plus: scheduling entry points `posts.ts:176-197`, `campaigns.ts:173,235` write the queue but no consumer runs (§7.7). **Status: BROKEN.**

---

## 19. Publishing

**Findings:**

| ID | Severity | Status | Finding | Evidence |
|----|----------|--------|---------|----------|
| F2 | **CRIT** | BROKEN | **Publish-now is a dead end.** `POST /api/v1/posts/:id/publish` sets `status="publishing"` and returns "Post queued for immediate publishing", but nothing consumes that state — posts remain `publishing` forever. | `backend/src/api/routes/posts.ts:199-223` |
| F3 | HIGH | PARTIAL | **Publisher adapters never registered.** `core/publisher/index.ts` implements a full `publish()` switch for 11 platform variants, but no route/worker imports it (grep: zero importers). `scheduler/publisher.ts` uses its own `PublisherAdapter` registry that no adapter registers into. | `backend/src/core/publisher/index.ts:58-254`; `backend/src/core/scheduler/publisher.ts:20-28` |

**Status: BROKEN.** No post has ever been published by this code; publish idempotency key (ARCHITECTURE.md:379) unimplemented.

---

## 20. hiai-kit Integration

**Finding F25:**

| ID | Severity | Status | Finding | Evidence |
|----|----------|--------|---------|----------|
| F25 | HIGH | PARTIAL | **Carousel + Script pages depend on an external hiai-kit backend** that this repo does not ship. All untracked feature code (`app/src/lib/features/`, `app/src/routes/carousels/`, `app/src/routes/scripts/`) calls `config.hiaiKitApiUrl` (default `http://localhost:3000`). Scripts pipeline defaults to language `"ru"`. If hiai-kit is absent/renamed, these pages 502/stream nothing. | `app/src/lib/features/shared/client.ts:4-10,29-33`; `app/src/lib/config.ts:6-8`; `app/src/lib/features/scriptforge/api.ts:81-109`; `app/src/routes/scripts/+page.svelte:443`; `app/src/lib/plugin.ts:84` |

**Contract health (verified read-only against hiai-kit):** carousel + scriptforge endpoints are 1:1 with `hiai-kit/src/api/routes/{carousel,scriptforge}.ts`; error envelope `{ error, message, code }` matches (`features/shared/client.ts:88-94`). Caveat: write routes require hiai-kit `agents:write` RBAC + cross-domain cookies (§7.4, §7.5). **No adjacent repo was modified by this audit** (§2).

---

## 21. Agent / Capability Inventory

| Agent / capability | Location | Role | Status |
|---|---|---|---|
| `writerAgent` | `backend/src/mastra/agents/writer.ts:3` | Content writer | DONE (registered `mastra/index.ts:12`); runtime use UNKNOWN |
| `optimizerAgent` | `backend/src/mastra/agents/optimizer.ts:3` | Content optimizer | DONE (registered `mastra/index.ts:13`); runtime use UNKNOWN |
| `webSearchTool` | `backend/src/mastra/tools/web-search.ts:1-30` | Research primitive (Tavily) | STUB — orphaned, zero importers |
| `contentGenerateWorkflow` | `mastra/workflows/content-generate.ts` | 5-step generation | BROKEN (§7.3) |
| `duplicate-check` workflow | `mastra/workflows/duplicate-check.ts:7` | Real dedup (Jaccard/substring/pgvector) | MISSING — never imported (stub inline instead) |
| `platform-format-single` workflow | `mastra/workflows/platform-format.ts` | Per-platform formatting | MISSING — never imported |
| Redis workers | `workers/{oauth-refresh,dead-letter}.ts` | Background jobs | PARTIAL (refresh works with gaps; dead-letter operates on DB with undocumented `status="dead"`, F6) |
| `store-listener` | `core/events/store-listener.ts:5-13` | Pub/sub scaffold | STUB — self-documented "not wired" |

**Capability coverage vs docs:** writer/optimizer agents exist and are registered, but neither the generation route nor any workflow demonstrably invokes them in the traced path (workflow steps make inline LLM calls); treat agent-runtime usage as **UNKNOWN** pending a live run.

---

## 22. Workflow / Orchestration

**Findings (queue — dual implementations, incompatible formats):**

| ID | Severity | Status | Finding | Evidence |
|----|----------|--------|---------|----------|
| F5 | **CRIT** | BROKEN | **Two queue implementations write the same Redis key with different ZSET member formats.** Impl A (`lib/redis.ts`, used by live routes) stores the **bare `postId`**; Impl B (`core/scheduler/queue.ts`, used by `/api/v1/queue/*` routes) stores **`tenantId:postId`**. `queue.dequeue()` splits members on `:` — a member written by Impl A yields `pid=undefined`, `tid=<uuid>`. Cross-reads corrupt. | `backend/src/lib/redis.ts:35-58` vs `backend/src/core/scheduler/queue.ts:21-40,48-51`; callers `posts.ts:101,146,195`, `campaigns.ts:173,235`, `api/routes/queue.ts:6-7` |
| F6 | HIGH | BROKEN | **Triplicated dead-letter handling.** (a) `PublishQueue.moveToDeadLetter` + separate `DeadLetterQueue` class (Redis ZSETs); (b) `workers/dead-letter.ts` operates on the **DB `posts` table** instead, and writes a `status="dead"` value not present in the documented enum. Three divergent mechanisms, none of which re-enqueues into a running pipeline. | `backend/src/core/scheduler/queue.ts:84-100`; `backend/src/core/scheduler/dead-letter.ts`; `backend/src/workers/dead-letter.ts:23-63`; `backend/src/db/schema.ts:75` |
| F7 | HIGH | PARTIAL | **Queue endpoints trust query-string `tenantId`.** `/api/v1/queue/*` handlers read `(query as any).tenantId` instead of the middleware-derived `tenantId` — any authenticated caller can inspect/retry **any tenant's** queue. | `backend/src/api/routes/queue.ts:10-55` |
| F8 | MED | PARTIAL | Key-prefix inconsistency: `lib/redis.ts` client uses `keyPrefix: "hipost:"` while `queue.test.ts` asserts unprefixed keys — unit-level consistency only; the class-based queue uses the same singleton so runtime keys are consistent, but the two member-format variants (F5) are not. | `backend/src/lib/redis.ts:7-8`; `backend/src/__tests__/queue.test.ts:33-74` |

**Status: BROKEN.** No orchestrator runs (F1); SSE feedback path unused (events.ts:18); `store-listener` scaffold-only.

---

## 23. API Audit

- **Surface:** 14 route files (§8) behind two mounts — public (`api/index.ts:70-81`: health, webhooks, `/api/v1/oauth/*:connect` …) and `protectedApp` (`api/index.ts:51-66`: auth + tenant + RBAC + audit middleware).
- **Method/response mismatches (frontend vs backend):**
  - OAuth connect: frontend `accounts/+page.svelte:19` POST + reads `body.url`; backend GET + returns `{ authUrl }` (`oauth.ts:99,130`) → 404/405 + `url: undefined`.
  - Posts: backend returns `{ post }`/`{ posts }`; frontend reads `body.data` (`posts/+page.server.ts:15`, `posts/[id]/+page.server.ts:8`, `posts/new/+page.svelte:28`, `dashboard/+page.server.ts:29,33`) → empty data.
  - Accounts: backend `{ accounts }`; frontend `accounts/+page.server.ts:11` reads `body.data`.
- **Auth on the wire:** every protected route needs `Authorization: Bearer` + `X-Tenant-Id`; the SvelteKit app sends neither (§27) → all protected calls fail in practice.
- **Tenant scoping:** queue (F7) and analytics (`analytics.ts:21`) read `query.tenantId`; `/analytics/posts/:postId` (`analytics.ts:78-109`) has no tenant filter at all.
- **Response envelopes:** all backend handlers wrap `{ success, … }`; frontend mostly ignores `success`.
- **SSE:** `/api/v1/events` (events.ts:75) is auth-gated in a way browsers can't satisfy; `broadcastEvent` never called.

---

## 24. Persistence

| Layer | Implementation | Status |
|---|---|---|
| Postgres (pgvector image) | Drizzle ORM; 13 tables (`schema.ts`); local port 5436 (`docker-compose.yml:86`); `drizzle/` gitignored | DONE |
| Redis | `lib/redis.ts` singleton with `keyPrefix: "hipost:"` (7-8); compose redis:8.6-alpine (108-130) | DONE |
| Encrypted OAuth tokens | AES-256-GCM `iv:authTag:ciphertext` (`lib/encryption.ts:19-30,52`); 7 tests pass | DONE |
| Mastra state | **in-memory only** — no `storage` (F17) | MISSING |
| Migrations | `_journal.json` lists only `0000_initial_schema`; `0001_rbac.sql` (26 lines) **not in journal** (F23) | BROKEN on fresh DB |

**Findings (migrations):**

| ID | Severity | Status | Finding | Evidence |
|----|----------|--------|---------|----------|
| F23 | **CRIT** | BROKEN | **Migration journal incomplete.** `_journal.json` lists only `0000_initial_schema`; `0001_rbac.sql` (26 lines: `tenant_role` enum, `tenant_members`, `audit_logs.role`, `audit_logs_actor_idx`) exists on disk but is **not in the journal** → `drizzle-kit migrate` never applies it. Fresh DBs lack RBAC tables while `schema.ts` references them. | `backend/src/db/migrations/meta/_journal.json:5-11`; `backend/src/db/migrations/0001_rbac.sql:1-26`; `backend/src/db/schema.ts:180-202` |
| F24 | MED | PARTIAL | **Schema/docs drift:** `posts.status` enum comment omits `dead` (set by the worker); `.env.example:46` claims the store webhook is "HMAC SHA-256 of body" but code compares a raw shared-secret header (`webhooks.ts:28-34`) — docs/ARCHITECTURE agree with code, `.env.example` is stale. | `backend/src/db/schema.ts:75`; `backend/src/api/routes/webhooks.ts:28-34`; `.env.example:46` |

---

## 25. Authentication / Tenancy

**Findings (tenant isolation & header trust):**

| ID | Severity | Status | Finding | Evidence |
|----|----------|--------|---------|----------|
| F9 | **CRIT** | BROKEN | **`X-Tenant-Id` is accepted on trust.** `tenant.ts` extracts the header, validates only UUID format, and never: (a) checks the tenant exists/active (its own docstring claims it does), (b) verifies the authenticated user is a member, (c) cross-checks any JWT claim. Any client can assert any tenant UUID. | `backend/src/api/middleware/tenant.ts:8-27` |
| F10 | HIGH | PARTIAL | **RBAC is the only defense and it is bypassable / absent.** `checkRbac` returns `{ok:true, bypass:true}` when `tenantId` or `userId` is missing (`rbac.ts:80-83`). Critically, the `tenant_members` table backing RBAC is created by `0001_rbac.sql`, which is **missing from the migration journal** (F21/F23) — on a fresh DB every RBAC check fails at lookup. | `backend/src/api/middleware/rbac.ts:75-130` |
| F11 | MED | PARTIAL | **CORS allows the tenant header** (needed for the proxy) — fine by itself, but combined with F9 it makes tenant assertion trivially scriptable. | `backend/src/api/index.ts:70-75` |
| F12 | LOW | PARTIAL | `POST /posts/:id/schedule` re-updates by `id` only (tenant verified in a prior select — race-window IDOR, low practical risk). Note: the update does **not** re-verify `tenantId`, so a concurrent request could theoretically affect a post transferred to another tenant between the select and the update. | `backend/src/api/routes/posts.ts:189-193` |

**Findings (OAuth):**

| ID | Severity | Status | Finding | Evidence |
|----|----------|--------|---------|----------|
| F13 | **CRIT** | BROKEN | **OAuth callback is unreachable.** `/api/v1/oauth/:platform/callback` is mounted inside `protectedApp` behind `authMiddleware` (Bearer required) + `tenantMiddleware` (`X-Tenant-Id` required). The provider redirect to `{BETTER_AUTH_URL}/api/v1/oauth/{platform}/callback` carries neither → **401 before state validation**. The state-based tenant check at `oauth.ts:154-161` is therefore dead code in practice. | `backend/src/api/index.ts:62`; `backend/src/api/routes/oauth.ts:97-98,132`; `backend/src/api/middleware/auth.ts:74-77`; `tenant.ts:10-15` |
| F14 | HIGH | BROKEN | **X/Twitter PKCE is broken.** Connect sets `code_challenge = state` (method `plain`), but the token exchange sends hardcoded `code_verifier: "challenge"` — never equal to `state` → X token exchange rejects. | `backend/src/api/routes/oauth.ts:125-128,183-185` |
| F15 | MED | PARTIAL | **Threads falls back to Instagram credentials** (`THREADS_APP_ID || INSTAGRAM_APP_ID`, same for secret). Threads is a Meta product that shares Instagram's app infrastructure in many setups — the fallback may be intentional, but it is undocumented and unverified for the Threads OAuth app. | `backend/src/api/routes/oauth.ts:74,88` |
| F16 | MED | PARTIAL | **No refresh strategy for tiktok / youtube / telegram** — the refresh worker warns "No refresh strategy for platform" and leaves those tokens to expire. | `backend/src/workers/oauth-refresh.ts:66-87` |

**Tenancy verdict: BROKEN.** Identity is client-asserted end-to-end (header + query param), RBAC is absent on fresh installs, and the frontend never sends the required headers.

---

## 26. Security

| Area | Finding | Evidence | Status |
|---|---|---|---|
| Dependency advisories | 47 vulns: 1 critical (vitest <3.2.6 GHSA-5xrq-8626-4rwp), 20 high, 21 moderate, 5 low | E8 (§31) | BROKEN |
| Tenant/authorization | Header trust + query-param tenantId + bypassable RBAC + missing RBAC tables | F9, F10, F7, F23 | BROKEN |
| OAuth | Unreachable callback; broken X PKCE; undocumented Threads fallback; missing refresh strategies | F13-F16 | BROKEN |
| Frontend headers/CSP | Weak meta CSP `script-src 'unsafe-inline' 'unsafe-eval'` + legacy Stripe origins; no `frame-ancestors`/`base-uri`; no `hooks.server.ts` → no HSTS/nosniff/XFO; proxies forward only `content-type`/`cache-control`/`set-cookie`, so backend's strict `secureHeaders` CSP never reaches the browser | `app/src/app.html:7`; `backend/src/api/middleware/secureHeaders.ts:13-56`; `app/src/routes/api/v1/[...path]/+server.ts:53-63`; `app/src/routes/api/auth/[...path]/+server.ts` (F20) | PARTIAL |
| PII in logs | `+layout.server.ts` logs the full session JSON via `console.error` on every load | `app/src/routes/+layout.server.ts:4-22` (F21) | PARTIAL |
| Proxy hop-by-hop headers | Only `content-length`/`host` stripped — `connection`, `accept-encoding`, etc. pass through | `app/src/routes/api/v1/[...path]/+server.ts:17-22` (F22) | PARTIAL |
| Webhook auth | Raw shared-secret header (`timingSafeEqual`), documented as HMAC in `.env.example:46` | `webhooks.ts:28-34` (F24) | PARTIAL |
| Secret storage | AES-256-GCM encrypted tokens; keys from `.env` (gitignored) | `lib/encryption.ts`; `.gitignore` | DONE |
| Migration integrity | RBAC migration absent from journal → fresh-DB security hole | F23 | BROKEN |
| Supply-chain CI | `bun audit` in CI swallows errors (`|| true`, `ci.yml:101-103`) | `ci.yml` | PARTIAL |

---

## 27. Frontend Audit

**Findings (headers & proxies) — F20-F22 (see §26 for text):** weak/absent security headers (F20), PII logged (F21), blind hop-by-hop proxy forwarding (F22).

**Cross-cutting issues verified by trace (§7):**

1. **Frontend never sends `X-Tenant-Id` or `Authorization`.** `tenant.ts:10` throws 400 without the header; `auth.ts:74` throws 401 without `Bearer`. No `hooks.server.ts` exists in `app/`; the proxy (`app/src/routes/api/v1/[...path]/+server.ts:17-22`) only forwards existing headers, and no page/store sets them → **every protected backend call from the app fails** (status: BROKEN).
2. **`_`-prefix undefined-identifier bug** in Svelte components: `posts/+page.svelte`, `posts/new/+page.svelte`, `posts/[id]/+page.svelte`, `accounts/+page.svelte`, `analytics/+page.svelte`, `ConnectAccountModal.svelte`, `PostEditor.svelte` (e.g. `_PLATFORMS` vs `PLATFORMS`, `_connect` vs `connect`, `_save` vs `save`) — these pages fail `svelte-check`/compile (status: BROKEN).
3. **Response-shape mismatches:** backend `{ posts }`/`{ post }`/`{ accounts }` vs frontend `body.data` in `posts/+page.server.ts:15`, `posts/[id]/+page.server.ts:8`, `posts/new/+page.svelte:28`, `accounts/+page.server.ts:11`, `dashboard/+page.server.ts:29,33`, `dashboard/+page.svelte:68` (status: BROKEN).
4. **SSE unusable:** `events.ts:75` requires auth+tenant headers a browser `EventSource` can't send; `broadcastEvent` never called.
5. **Working-tree-only features:** carousels/scripts pages + `lib/features/` are untracked (§2).

---

## 28. Tests

| Suite | Files | Result (2026-08-10) | Status |
|---|---|---|---|
| Backend vitest | 8 files: `__tests__/{encryption,platform-rules,queue,rbac,scheduler}.test.ts`, `lib/oauth-state.test.ts`, `tests/{auth-jwt,auth}.test.ts` | 0 run (config crash E3); **69/69 pass** with `--pool=threads` (E5) | DONE (with runner caveat) |
| Frontend vitest | `app/src/lib/features/shared/sse.test.ts` | 0 run (E4); **14/14 pass** with `--pool=threads` (E6) | DONE (with runner caveat) |
| bun:test (repo-wide) | 10 files / 90 tests | 83 pass, **7 fail** — all E2E `app/tests/e2e/post.spec.ts` ("Frontend is not reachable at http://localhost:50301", needs running stack or `HIAI_POST_E2E_SKIP=1`) (E7) | PARTIAL |
| Coverage | `--coverage` in CI (`ci.yml:55,57`) | reported but not re-run locally | UNKNOWN |
| E2E | `app/tests/e2e/post.spec.ts` | not runnable without dev stack | UNKNOWN (needs stack) |

**Gaps:** no tests for posts/oauth/analytics/webhook/generate routes; no contract tests against hiai-kit; E2E requires a live stack. CI at HEAD runs `bunx vitest run` with committed configs (green), but the working-tree `poolOptions` change breaks local runs (E9).

---

## 29. Observability

**Finding F26:**

| ID | Severity | Status | Finding | Evidence |
|----|----------|--------|---------|----------|
| F26 | MED | PARTIAL | **hiai-observe mismatch.** Docs (`docs/ARCHITECTURE.md:88-96,428`) document error reporting via `HIAI_OBSERVE_SENTRY_DSN` and a "pino → DSN" error reporter; code declares **`SENTRY_DSN`** (`config.ts:61`) and imports/initializes **no Sentry SDK anywhere** (grep: zero code hits) — `logger.ts` is pino-only. README/.env.example use `SENTRY_DSN`; ARCHITECTURE uses `HIAI_OBSERVE_SENTRY_DSN`. Naming mismatch + unimplemented wiring. | `backend/src/lib/config.ts:61`; `docs/ARCHITECTURE.md:89,428`; `README.md:367`; `.env.example:49`; `backend/src/api/middleware/secureHeaders.ts:4` (comment typo `hiai-obsee`) |

**Status: MISSING (declared only).** Setting `SENTRY_DSN` today is a no-op — no `@sentry` package in `bun.lock`, no ingest calls. (Adjacent finding: hiai-kit's Sentry client → hiai-observe ingest is itself BROKEN — `X-Sentry-Auth` header vs `Authorization`-only auth, `hiai-observe/src/middleware/auth.ts:62-73` — see §3.2.)

---

## 30. Deployment

### 30.1 docker-compose (`docker-compose.yml`, 140 lines)

| Service | Image / build | Port | Healthcheck | Notes |
|---|---|---|---|---|
| `hiai-post-api` | `./backend` Dockerfile | 50300→3000 | `wget /api/v1/health` (21-25) | env_file `.env`; depends on healthy postgres+redis; 512M/1CPU limit; on `hiai-post` + external `docker_ai-internal` networks |
| `hiai-post-frontend` | `.` + `app/Dockerfile`; `additional_contexts: packages_host=${HOST_PACKAGES_DIR:-}` (47-48) | 50301→3000 | `wget /` (61-65) | `ORIGIN=${FRONTEND_URL:-http://localhost:50301}` (54), `API_URL=http://hiai-post-api:3000` (55); comment documents the npm vs workspace `@hiai/ui` choice (39-43) |
| `postgres` | `pgvector/pgvector:pg18` | 5436→5432 | `pg_isready` | named volume; 1G limit |
| `redis` | `redis:8.6-alpine` | 6383→6379 | `redis-cli ping` | named volume |

Notes: external network `docker_ai-internal` is shared with sibling stacks (assumed hiai-kit); **no scheduler/worker service exists** — consistent with F1 (the Publisher would have to run inside the API process). Default secrets (`changeme`) in compose are dev-only.

### 30.2 Dockerfiles + CI

- `backend/Dockerfile` builds `bun build src/api/index.ts --outdir dist --target bun` (`backend/package.json:7`).
- `app/Dockerfile` builds the SvelteKit app; CI uploads `backend/dist/` and `app/build/` as artifacts (`ci.yml:80-89`).
- **CI (`.github/workflows/ci.yml`, 103 lines):** 4 parallel jobs + security on `push/PR` to master/main + `workflow_dispatch`. Lint uses **Biome 2.5** (`biome check src/` per workspace + `biome ci .` — no ESLint/Prettier); typecheck runs `tsc --noEmit` per workspace (`ci.yml:37-40`); test runs `bunx vitest run --coverage` per workspace (`55-57`); security job runs `npm-audit-helper` and `bun audit` **with errors swallowed** (`|| true`, 101-103) — so the 47-vuln posture is invisible to CI. No deployment job; images are built locally/compose only.

### 30.3 Configuration & environment surface

| Env var | Source | Documented | Actual |
|---|---|---|---|
| `DATABASE_URL` | `config.ts` (Zod) | `.env.example:2` | set locally; compose builds from `POSTGRES_*` |
| `BETTER_AUTH_SECRET` / `TOKEN_ENCRYPTION_KEY` | `config.ts` | `.env.example` | set locally |
| `HIAI_STORE_WEBHOOK_SECRET` | `config.ts:21` | `.env.example:46` (says HMAC; code is raw secret — F24) | unset locally → webhook 503s |
| `SENTRY_DSN` | `config.ts:61` | `.env.example:49` | set locally but **no-op** (F26) |
| `HIAI_ADMIN_JWT_SECRET` / `OAUTH_STATE_SECRET` | `config.ts` | `.env.example:13` | **NOT set locally** (optional) |
| `PUBLIC_HIAI_KIT_URL` | `app/src/lib/config.ts:8` | — | default `http://localhost:3000` (F25) |
| `MASTRA_MODEL`, platform keys, ports, `NODE_ENV` | `config.ts` | `.env.example` | set locally |

---

## 31. Dependencies

`bun audit` — 47 vulnerabilities (1 critical, 20 high, 21 moderate, 5 low). Notable entries:

| Package (vuln range) | Advisory | Severity | Affected via |
|---|---|---|---|
| `vitest` < 3.2.6 | GHSA-5xrq-8626-4rwp — arbitrary file read/execute when Vitest UI server listening | **critical** | `vitest`, `@vitest/coverage-v8`, `better-auth` (both workspaces) |
| `nanoid` ≥4.0.0 <5.1.16 | GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8 — non-secure generators loop indefinitely | high | `cmdk-sv`, `bits-ui`, `@mastra/core`, `shadcn-svelte`, `vite`, `tailwindcss` |
| `sharp` < 0.35.0 | GHSA-f88m-g3jw-g9cj — libvips CVE-2026-33327/33328/35590/35591 | high | `backend › sharp` |
| `fast-uri` ≥3.0.0 <3.1.5 | GHSA-7p8r-x3mc-p8w7, GHSA-v2hh-gcrm-f6hx, GHSA-4c8g-83qw-93j6 — host confusion (SSRF-adjacent) | high | `@mastra/core` |
| `postcss` ≤8.5.22 | GHSA-r28c-9q8g-f849, GHSA-fxqj-rqcc-2cmp — source-map file disclosure | high | `vite`, `tailwindcss`, `shadcn-svelte` |
| `@sveltejs/kit` ≤2.69.0 | GHSA-866w-xmhq-wj7x, GHSA-wqjv-9729-c5q2, GHSA-29g2-3rmr-qm68 — prototype pollution, form DoS, Accept-header ReDoS | moderate | `@sveltejs/kit`, `adapter-node`, `better-auth`, `bits-ui` |
| `cookie` <0.7.0 | GHSA-pxg6-pf52-xh8x — out-of-bounds chars in cookie name/path/domain | low | `@sveltejs/kit`, `elysia`, `@mastra/core` |
| `ip-address` | GHSA-22jq-vg5j-6vgg — IPv4-mapped/NAT64 misclassification (SSRF/trust bypass) | moderate | via kit/mastra chain |

Remediation requires a coordinated `bun update` of both workspaces (breaking changes expected: vitest 2→3, sharp, kit) — tracked in §43 Phase 3 / §38 P1-B7.

---

## 32. Dead / Legacy Code

| Dead / orphaned code | Location | Evidence | Disposition |
|---|---|---|---|
| `publish()` switch — 11 platform adapters | `core/publisher/index.ts:58-254` | zero importers (F3) | Wire or delete (§42) |
| `Publisher.start()` / `registerPublisher` | `core/scheduler/publisher.ts:59-69,20-28` | zero callers (F1) | Wire into bootstrap |
| `broadcastEvent()` / SSE feedback | `api/routes/events.ts:18` | zero call sites | Wire or delete |
| `collectAllMetrics()` / `collectAnalyticsForAccount()` | `core/analytics/collector.ts:151`, `aggregator.ts:319` | never called | Wire to a cron/worker |
| `initRateLimiter` / `checkLimit` | `core/scheduler/rate-limiter.ts:19,33` | never initialized → always true (F4) | Wire or delete |
| Retry tables | `core/scheduler/retry.ts:3-7` | reachable only via dead publisher (F4) | Wire or delete |
| `duplicate-check.ts` workflow (real dedup) | `mastra/workflows/duplicate-check.ts:7` | never imported (stub inline) (F18) | Wire into workflow |
| `platform-format.ts` workflow | `mastra/workflows/platform-format.ts` | never imported (inline copy) (F17 note) | Wire or delete |
| `webSearchTool` | `mastra/tools/web-search.ts` | zero importers (§10) | Wire or delete |
| `store-listener` pub/sub scaffold | `core/events/store-listener.ts:5-13` | self-documented "not wired" | Wire or delete |
| Second/third dead-letter mechanisms | `core/scheduler/dead-letter.ts`, `PublishQueue.*DeadLetter` | unused variants (F6) | Consolidate |
| Status `"dead"` writer | `workers/dead-letter.ts:23-63` | writes value absent from enum | Consolidate (F6) |
| Legacy origins | `carusel/`, `script/` repos | absorbed into hiai-kit; hiai-post has zero references (§3.2) | Archive/retire |
| `HOST_PACKAGES_DIR` compose override | `docker-compose.yml:47-48` | for internal monorepo only; OSS path is npm `@hiai/ui` (39-43) | Document as internal-only |

---

## 33. HiAi-Post vs Carousel vs Script Consolidation Matrix

| Dimension | hiAi-post (this repo) | carusel (legacy) | script (legacy) | hiai-kit (current home) |
|---|---|---|---|---|
| Role | Content planning/publishing platform | Standalone IG carousel generator | Standalone AI script generator | Platform backend owning both domains |
| Carousel capability | Page + client only (`features/carousel/api.ts`); **no own implementation** | Full pipeline (`/api/carusel/*`, port 50600; Konva editor) | — | Full pipeline (`src/modules/carousel/`, `/api/v1/carousel/*`, port 3000) |
| Script capability | Page + client only (`features/scriptforge/api.ts`); **no own implementation** | — | Full pipeline (`/api/run-pipeline` etc., Vite middleware) | Full pipeline (`src/modules/scriptforge/*`, `/api/v1/scriptforge/*`) |
| Coupling from hiai-post | — | **NONE** (zero references) | **NONE** (zero references) | **HTTP/SSE peer service** (verified 1:1) |
| State | In-repo client code untracked; backend dead (F1-F4) | Orphaned origin; superseded | Orphaned origin; superseded | Active owner |
| Recommendation | Keep thin clients; never re-implement pipelines | Archive (superseded by hiai-kit) | Archive (superseded by hiai-kit) | Contract owner; fix auth+pin drift (§45 Q1) |

---

## 34. Target Ownership Matrix

Who should own each capability after consolidation (recommended, **not implemented**):

| Capability | Current (de-facto) | Target owner | Gate |
|---|---|---|---|
| Post planning/scheduling/publishing | hiai-post (broken) | **hiai-post** | P0 fixes (§37) |
| Platform adapters & publish | hiai-post (dead) | **hiai-post** (worker process) | D1 decision |
| Carousel pipeline | hiai-kit (external) | **hiai-kit** (keep) or hiai-post if hiai-kit EOL | D6 / Q1 |
| Script pipeline | hiai-kit (external) | **hiai-kit** (keep) or hiai-post if hiai-kit EOL | D6 / Q1 |
| AI generation (writer/optimizer) | hiai-post Mastra (broken) | **hiai-post** (Postgres storage) | D5 |
| Research (web search) | hiai-post (orphaned tool) | **hiai-post** (wire into workflow) or hiai-kit | Q1 |
| Observability ingest | hiai-kit→hiai-observe (broken) | **hiai-observe** (fix auth) + hiai-post wires DSN | D7 / Q4 |
| `@hiai/ui` components | npm `@hiai-gg/hiai-ui` shared | **shared package** (single source) | Q5 |
| Legacy carusel/script repos | orphaned | **archive** | §41 |

---

## 35. Product Completeness Matrix

Requirement claims (README/ARCHITECTURE) vs reality, using the requested status vocabulary:

| Claimed feature | Source | Reality | Status |
|---|---|---|---|
| "Redis-based scheduler with retry, backoff, and dead letter queue" | README:103 | Components exist; scheduler never runs | MISSING |
| "Each merchant sees only their own accounts, posts, and analytics" | README:107 | Header-trust only; no membership enforcement | MISSING |
| "Validates tenant exists and is active" (tenant middleware docstring) | tenant.ts:5-7 | No such validation | MISSING |
| "OAuth 2.0 flows for all platforms with encrypted token storage" | README:106 | Encryption DONE; callback flow broken; refresh gaps | PARTIAL |
| "Error reporter (pino → DSN)" / hiai-observe | ARCHITECTURE:66-68,88-96 | No SDK, env-var name mismatch | MISSING |
| "Duplicate content detected" 409 path | generate.ts:47-53 | Stub always false | STUB |
| "Run tests: … (58 tests)" | README:30 | 69 backend tests; vitest currently 0-run | PARTIAL (docs stale) |
| Multi-tenant RBAC (owner > admin > editor > viewer) | rbac.ts, schema.ts | Implemented; blocked by migration journal on fresh DB | PARTIAL |
| Audit logging with secret redaction | audit.ts, ARCHITECTURE:481-506 | Present; depends on `audit_logs.role` from unapplied migration; webhooks never audited (§7.6) | PARTIAL |
| "Posts created as 'draft'" in generate flow | ARCHITECTURE:170 | No `db.insert` in generate route | MISSING |
| Publish idempotency key `(social_account_id, content_hash)` | ARCHITECTURE:379 | Not implemented anywhere | MISSING |
| Analytics aggregation to `post_analytics` | ARCHITECTURE ~380+ | Collector never runs | MISSING |
| Refresh-failure → `status="expired"` | ARCHITECTURE:317 | Not implemented | MISSING |
| Carousel/script pages | hiai-kit integration | Pages exist (untracked); external dep; write-auth mismatch | PARTIAL |
| Frontend↔backend end-to-end calls | README | Broken — no headers, undefined identifiers, response-shape mismatches (§27) | BROKEN |

---

## 36. Completion Estimates

Estimates are for a focused 1-2 engineer effort, sequential (parallel tracks in §44 overlap):

| Phase | Work | Estimate |
|---|---|---|
| P0 — unblock CI + runtime spine (§37) | vitest config; queue unification + scheduler bootstrap + adapter wiring; tenant identity; migration journal | 3-4 days |
| P1 — auth/oauth + security (§38) | OAuth callback + PKCE + refresh strategies; dependency remediation (vitest 3, sharp, kit); frontend headers; RBAC enforcement | 4-5 days |
| P2 — product depth (§39) | Mastra Postgres storage + real dedup + tenant scoping; analytics collector; SSE feedback; webhook audit wiring; E2E suite; frontend page fixes | 5-7 days |
| P3 — cleanup (§40) | docs refresh; dead-code removal; CI hardening (fail on `bun audit`); env naming contract; legacy archive | 2-3 days |
| **Total** | | **~14-19 days** |

---

## 37. P0 Blockers

(Blocks launch or any usable product; ordered by blast radius. Original B-numbers preserved.)

| # | Blocker | Blocks | First fix step |
|---|---------|--------|----------------|
| B2 | Publish pipeline never started (scheduler + adapters unwired) | Scheduled/immediate publishing | Start `Publisher` in `api/index.ts`; register adapters; wire `publish` into a consumer |
| B3 | Dual queue member-format conflict (bare id vs `tenantId:id`) | Queue correctness | Unify on one implementation; reconcile `lib/redis.ts` vs `core/scheduler/queue.ts` |
| B4 | Tenant identity asserted client-side (header + query param) | Multi-tenant security | Derive tenant from verified session/JWT claims; validate membership; stop trusting query `tenantId` |
| B5 | `0001_rbac.sql` missing from migration journal | RBAC on fresh installs | Regenerate journal (drizzle-kit) so `0001` applies; verify `tenant_members` exists |
| B0 | **Frontend cannot call the backend** (no `X-Tenant-Id`/`Authorization`; `_`-prefix compile errors; `body.data` mismatches — §27) | **Every protected page flow** | Add `hooks.server.ts` header/session bridging; fix identifiers; align response shapes (traced in §7) |

---

## 38. P1 Blockers

(Blocks key flows or security posture; original B-numbers preserved.)

| # | Blocker | Blocks | First fix step |
|---|---------|--------|----------------|
| B1 | Vitest suites crash pre-run (Tinypool poolOptions, working tree) | All CI-gated test feedback locally | Fix `poolOptions` in both vitest configs (drop `forks` block or add matching `minForks`) |
| B6 | OAuth callback behind auth/tenant middleware + broken X PKCE | All OAuth connects | Mount callback outside `protectedApp`; use state-only verification; fix PKCE verifier |
| B7 | 47 vulns incl. 1 critical (vitest <3.2.6) | Security posture / prod | `bun update` workspaces; pin vitest ≥3.2.6, sharp ≥0.35, kit ≥2.69.x |

---

## 39. P2 Requirements

(Product depth — needed to be credible, not to unblock.)

1. Mastra persistence (Postgres `PostgresStore`, tenant-scoped threads) + real duplicate check (wire `duplicate-check.ts`) + tenant/cost scoping (F17-F19, D5).
2. Analytics: schedule `collectAllMetrics()`; fix `/analytics/posts/:postId` tenant filter; fix analytics page.
3. OAuth: refresh strategies for tiktok/youtube/telegram (F16); document/verify Threads fallback (F15); set `status="expired"` on refresh failure (ARCHITECTURE:317).
4. SSE feedback path: wire `broadcastEvent` from the publisher; make the endpoint cookie-compatible.
5. Webhook: audit-middleware coverage for webhook path (§7.6); FK guard for unknown `tenantId`.
6. E2E suite against a running stack (postgres/redis + API + app; `HIAI_POST_E2E_SKIP` semantics documented).
7. Frontend: fix all `_`-prefix identifiers + response-shape reads (§27); typecheck-gate pages in CI (`svelte-check`).
8. Add tests for posts/oauth/generate/analytics/webhook routes; contract tests for the hiai-kit surface.

---

## 40. P3 Cleanup

1. Docs: README test count (58→69), ARCHITECTURE dead components (scheduler/publisher/error-reporter), `.env.example:46` webhook claim (HMAC vs raw secret), `SENTRY_DSN` vs `HIAI_OBSERVE_SENTRY_DSN` naming, `hiai-obsee` typo (`secureHeaders.ts:4`).
2. Dead code removal or explicit "wire later" markers (§32) — publisher switch, SSE, collector, rate-limiter/retry, orphaned workflows/tools, store-listener.
3. CI hardening: make `bun audit` fail on criticals (today `|| true`), add DB-drift check for migration journal, add `svelte-check` to frontend typecheck.
4. Env/secret hygiene: remove optional-but-unset vars from local `.env` docs; decide `HOST_PACKAGES_DIR` (internal-only); keep `changeme` dev secrets out of prod compose.
5. Archive `carusel/` and `script/` repos (or mark read-only) once hiai-kit ownership is confirmed (Q1).
6. HTTP hygiene: strip hop-by-hop headers in the proxy (F22); remove legacy Stripe origins from the meta CSP (F20).

---

## 41. What We Should NOT Build

1. **Do not re-implement carousel/script pipelines in hiai-post** while hiai-kit owns them (Q1) — keep thin HTTP clients, fix auth/cookies instead.
2. **Do not build a new queue/dead-letter system** — unify the existing two, don't add a third.
3. **Do not self-host object storage again** (MinIO was deliberately removed in `957522f`) — hiai-post only stores media URLs; keep it that way until a real upload need exists.
4. **Do not bolt a second auth system** on top of Better Auth — fix the header/session bridging (P0-B0) rather than adding JWT endpoints.
5. **Do not add per-tenant AI cost dashboards** until the hiai-observe contract (Q4) and Mastra persistence (D5) are settled.
6. **Do not ship the `forks` poolOptions** — it's the working-tree vitest breaker (E3/E4); fix, don't propagate.
7. **Do not start new frontend pages that call hiai-kit directly** until cookie/RBAC auth across hosts is solved (§7.5).

---

## 42. Recommended Target Architecture

(Recommended direction — **not implemented**; presented as a target, not a claim of current state.)

```
[Frontend SvelteKit] ──session cookie──▶ [Elysia API]
  ├─ auth: session-derived identity → tenant from verified membership (no client-asserted header)
  ├─ RBAC enforced with tenant_members (journal-fixed migration)
  ├─ [Queue (single impl, Redis ZSET, tenantId:postId)] ──▶ [Publisher worker process]
  │     ──adapters──▶ platforms ──▶ SSE events back to frontend
  ├─ [Dead-letter] single mechanism; re-enqueue with retry 1/5/15min
  ├─ [Mastra] Postgres storage, tenant-scoped threads, real duplicate-check (pgvector)
  ├─ [Analytics collector] scheduled job → post_analytics → read via tenant-scoped routes
  ├─ OAuth callbacks mounted outside protectedApp (state-only verification)
  ├─ [hiai-observe] wire SENTRY_DSN after contract fix (Authorization header)
  └─ hiai-kit: keep carousel/scriptforge as peer services (HTTP/SSE), auth via shared session domain
```

Key principles: single queue implementation; publisher as a separate worker (or flagged in-process first); tenant identity derived from the session, never from the client; all background jobs started explicitly at bootstrap; dead code removed or wired (§32); CI gates that actually fail.

---

## 43. Recommended Development Phases

Phase order is dependency-driven; each phase is independently shippable.

- **Phase 0 — Unblock CI/test feedback (½ day):** fix `poolOptions` in `backend/vitest.config.ts` + `app/vitest.config.ts`; re-run E3-E6 to green. → unblocks everything else (P0-B1).
- **Phase 1 — Runtime-critical fixes (2-3 days):**
  1. Unify queue implementation (F5/F6) and wire the scheduler `Publisher` into `api/index.ts` with registered adapters (F1-F4).
  2. Tenant: derive identity from verified session/JWT, validate membership, remove query-string `tenantId` from queue routes (F7/F9/F10).
  3. Regenerate the migration journal so `0001_rbac.sql` applies (F23); add a DB-drift CI check.
  4. Frontend→backend bridging: session/tenant headers via `hooks.server.ts`, fix identifiers + response shapes (P0-B0, §27).
- **Phase 2 — OAuth + AI (2-3 days):** mount callback outside `protectedApp` with state-only auth (F13); fix X PKCE (F14); add Mastra Postgres storage + real duplicate check (F17/F18).
- **Phase 3 — Security & observability (2 days):** dependency remediation (E8, vitest ≥3.2.6, sharp, kit); frontend headers via `hooks.server.ts` + tighten meta CSP (F20); wire hiai-observe/Sentry after contract decision (D7, Q4).
- **Phase 4 — Product completion (3-5 days):** decisions D1-D6; analytics collector + tenant filters; webhook audit wiring; SSE feedback; E2E suite against running stack; update README/ARCHITECTURE (F27).

---

## 44. Parallel Work Plan

**Parallel work (independent worktrees, zero cross-deps):**

- WT-A: vitest config fix + README/docs updates (Phases 0/4).
- WT-B: queue unification + scheduler wiring (Phase 1.1).
- WT-C: tenant/RBAC hardening + migration journal (Phase 1.2-1.3) — overlaps WT-B only on `queue.ts` (coordinate).
- WT-D: OAuth callback + PKCE + refresh strategies (Phase 2, touches `oauth.ts` + `auth.ts`).
- WT-E: dependency bumps (Phase 3, touches both `package.json`/`bun.lock` — do last, in its own worktree).
- WT-F: frontend headers + proxies + page fixes (Phases 1.4/3, touches only `app/`).
- WT-G: hiai-kit contract work (auth cookies, pin refresh, observability auth fix) — lives in hiai-kit/hiai-observe repos, coordinates with WT-D/WT-F (Q1, Q4, Q5).

---

## 45. Questions for hiai-kit Team

1. **Carousel/Script ownership:** are `/api/v1/carousel` and `/api/v1/scriptforge` permanently owned by the hiai-kit backend, or should hiai-post host them? If hiai-kit is being retired, what is the migration path for `app/src/lib/features/*`?
2. **URL/defaults:** is `PUBLIC_HIAI_KIT_URL` (default `http://localhost:3000`) correct for production? Is `language="ru"` the intended default for the scripts pipeline?
3. **Auth bridging:** does hiai-kit honor the same session cookie (`credentials: "include"`) as hiai-post, or does it need the HS256 admin-JWT bridge (`HIAI_ADMIN_JWT_SECRET`)? The feature clients send no `Authorization` header today.
4. **Observability contract:** what is the canonical env var — `SENTRY_DSN` or `HIAI_OBSERVE_SENTRY_DSN` — and which DSN value(s) should hiai-post send (errors only, or also traces/metrics per ARCHITECTURE.md:94-95)? Also: hiai-observe's auth only reads `Authorization`/`X-Api-Key` while hiai-kit's Sentry client sends `X-Sentry-Auth` → all error reports 401 (fix the client or the server; §3.2).
5. **@hiai/ui versioning:** `@hiai-gg/hiai-ui@^0.0.8` (npm) is referenced in `app/package.json:28` while `docker-compose.yml:47-48` still documents a `HOST_PACKAGES_DIR` workspace override — which path is canonical for OSS users and CI?
6. **Webhook contract:** is `X-Webhook-Secret` plain-shared-secret (current code) or HMAC-SHA-256 of the body (`.env.example:46`)? Which does hiai-store actually send?
7. **`@hiai-gg/hiai-observe` pin:** hiai-kit pins `0.2.0` exact while the repo ships `0.2.1` — bump or intentional?

---

## 46. Product Decisions Needed

| # | Decision | Options | Recommended |
|---|----------|---------|-------------|
| D1 | Publish model | (a) In-process `setInterval` Publisher (current design), (b) external worker process, (c) BullMQ/Queues-as-a-service | (b) separate worker for scale + restarts; ship (a) behind a flag first |
| D2 | Queue unification | Keep Redis ZSET impl, DB-status impl, or both (Redis primary + DB audit) | Redis primary; DB status = audit only |
| D3 | Tenant identity source | Header-only (current) vs JWT claim vs session-membership lookup | Session/JWT-derived with RBAC membership check; header allowed only for admin bridge |
| D4 | OAuth callback UX | Direct browser callback vs frontend-proxied callback vs PKCE in-app popup | Frontend-proxied callback (reuses session cookie) |
| D5 | AI persistence scope | None / Postgres (Mastra `PostgresStore`) / per-tenant store | Postgres store, tenant-scoped threads, cost metrics into audit_logs or analytics tables |
| D6 | Carousel/Script pages | Ship as-is (external hiai-kit), port into hiai-post, or hide until hiai-kit is stable | Hide behind feature flag; port only if hiai-kit is EOL |
| D7 | Observability | Wire `@sentry/node` now vs after hiai-observe contract fixed | Fix contract first (Q4), then wire SDK |
| D8 | Test-runner version | Stay vitest 2.1 (fix pool config) vs upgrade to vitest 3.x (fixes GHSA-5xrq) | Upgrade vitest ≥3.2.6 during dependency remediation (P1-B7) |
| D9 | Analytics collection | In-process interval vs worker job vs external | Worker job alongside publisher (D1) |
| D10 | Frontend bridge | `hooks.server.ts` session→header bridge vs SvelteKit `handleFetch` vs API-keys | hooks.server.ts session bridge (P0-B0) |

---

## 47. Final Recommendation

**Verdict: NOT READY — BLOCKED** for production / multi-tenant launch. Approve for **continued POC/development only**, with the following conditions:

1. **Unblock first:** fix the vitest `poolOptions` (P1-B1) and the frontend→backend bridge (P0-B0) — without these, no engineer or E2E test can exercise the product.
2. **Make the spine real:** start the scheduler + wire adapters (P0-B2), unify the queue (P0-B3), derive tenant identity from the session (P0-B4), fix the migration journal (P0-B5).
3. **Then security:** OAuth callback + PKCE (P1-B6) and dependency remediation incl. the critical vitest advisory (P1-B7).
4. **Concurrently decide:** D1/D2/D3 before Phase 1 code; D4-D10 before Phase 2-4; Q1-Q7 before touching hiai-kit-facing code.

**Risk register (Likelihood × Impact, from M2):**

| Risk | Likelihood | Impact | ID(s) |
|---|---|---|---|
| Cross-tenant data exposure via self-asserted `X-Tenant-Id` + query-string tenantId | High | High | F9, F7, F10 |
| Scheduled/published posts never delivered (pipeline dead) | Certain | High | F1, F2 |
| Fresh-install RBAC broken (migration not in journal) | High (fresh DB) | High | F23, F10 |
| OAuth connect unusable for all platforms (callback 401) | Certain | High | F13 |
| X/Twitter connect specifically broken (PKCE) | Certain | Medium | F14 |
| Queue corruption from dual member formats | Medium | Medium | F5, F6 |
| Supply-chain: 1 critical + 20 high advisories | Certain (currently) | Medium-High | E8 |
| AI runs lost on restart / no cost isolation | High | Medium | F17, F19 |
| hiai-kit dependency missing → carousel/scripts broken in prod | Medium | Medium | F25 |
| Error telemetry black hole (no Sentry wiring) | Certain | Medium | F26 |
| Frontend CSP bypass via unsafe-inline/eval + no HSTS | Medium | Medium | F20 |

**Bottom line:** the codebase is a well-organized POC whose core loop (queue → scheduler → publisher → platform) is entirely unwired, whose tenancy is client-asserted, and whose frontend cannot currently talk to its own API. With ~2-4 weeks of focused work (estimates in §36) and the decisions in §46, it can become a credible multi-tenant publishing platform. Every recommendation above is **a proposal, not implemented state** — nothing in this report was changed in code.

---

## Appendix — Commands & Key Outputs

```
$ bun lint                       → hiai-post-frontend: 47 files OK (exit 0); hiai-post-api: 87 files OK (exit 0)
$ bun typecheck                  → both workspaces exit 0
$ cd backend && bunx vitest run  → RangeError: options.minThreads and options.maxThreads must not conflict
                                     at new Tinypool (tinypool@1.1.1 …/index.js:745:120)
                                     at createForksPool (vitest …/resolveConfig.rBxzbVsl.js:6756:16)
                                   → Test Files: no tests · Tests: no tests · Errors: 1 error (exit 1)
$ cd app && bunx vitest run      → identical error (exit 1)
$ cd backend && bunx vitest run --pool=threads → 8 files, 69 tests passed
$ cd app && bunx vitest run --pool=threads    → 1 file, 14 tests passed
$ bun test (bun:test runner)     → 90 tests / 10 files: 83 pass, 7 fail (E2E: "Frontend is not reachable at
                                     http://localhost:50301 … or set HIAI_POST_E2E_SKIP=1")
$ bun audit                      → 47 vulnerabilities (1 critical, 20 high, 21 moderate, 5 low)
$ git ls-files backend/dist/index.js → (empty)      # F28: not tracked
$ git check-ignore backend/dist/index.js → backend/dist/index.js   # F28: gitignored
```

Key source references: `backend/src/api/index.ts`, `backend/src/api/middleware/{auth,tenant,rbac,secureHeaders}.ts`, `backend/src/api/routes/{oauth,posts,queue,webhooks,generate,analytics,campaigns,content-plans,templates,youtube,events,health}.ts`, `backend/src/core/scheduler/{publisher,queue,dead-letter,retry,rate-limiter}.ts`, `backend/src/core/publisher/index.ts`, `backend/src/core/analytics/{aggregator,collector}.ts`, `backend/src/core/events/store-listener.ts`, `backend/src/mastra/{index.ts,agents/*,workflows/*,tools/web-search.ts}`, `backend/src/workers/*.ts`, `backend/src/lib/{redis,db,config,encryption,oauth-state,platform-rules}.ts`, `backend/src/db/{schema.ts,index.ts}`, `backend/src/db/migrations/meta/_journal.json`, `backend/src/db/migrations/0001_rbac.sql`, `app/src/{app.html,config.ts via lib}`, `app/src/routes/{+layout.server.ts,api/v1/[...path]/+server.ts,api/auth/[...path]/+server.ts}`, `app/src/routes/*` (26 files), `app/src/lib/{config.ts,plugin.ts,features/**,components/*,stores/*}`, `app/vitest.config.ts`, `backend/vitest.config.ts`, `docker-compose.yml`, `backend/Dockerfile`, `app/Dockerfile`, `.github/workflows/ci.yml`, `README.md`, `docs/ARCHITECTURE.md`, `.env.example`, `.gitignore`; adjacent repos read-only: `hiai-kit/` (`src/api/routes/{carousel,scriptforge}.ts`, `src/modules/{carousel,scriptforge}/`, `src/observe/*`, `package.json`), `hiai-observe/` (`src/middleware/auth.ts`, `src/lib/auth.ts`, `docs/api.md`), `carusel/`, `script/`.
