# HiAi-Post — Consolidation Phase Final Delivery Report

- **Repo:** `/home/hiai/projects/hiai-post` (bun workspaces: `backend/` Elysia API, `app/` SvelteKit frontend)
- **Report date:** 2026-08-13 (supersedes the 2026-08-10 edition of this file; unchanged history is preserved below)
- **Report type:** Documentation-only. This report describes **actual implemented state** verified against the working tree and live command output — it is a delivery record, not a proposal.
- **Companion baseline:** `audit-report.md` (untracked, same workspace) documents the pre-consolidation state (findings F1–F28, decisions D1–D10, phases). This report supersedes its status columns for the findings this phase addressed.
- **Companion remediation record:** `docs/SECURITY-REMEDIATION-2026-08-13.md` (untracked, same workspace) documents the 2026-08-13 dependency remediation (Vitest 3, advisory pins, removed global overrides). §12/§13/§15 reconcile its recorded state against the **live** audit output captured for this edition.

---

## 1. Canonical Git State

| Item | Value |
|---|---|
| Branch | `master` |
| HEAD | `30a54be` (`fix(tests): exclude E2E from vitest (bun:test suite) + scope test script to backend`, 2026-07-07) — **unchanged** since the audit baseline and the 2026-08-10 edition; all work since remains uncommitted working-tree state |
| Upstream | up to date with `origin/master` |
| Worktree | **main checkout** — `hiai_worktree_status`: no linked worktree exists for this phase |
| Working tree | **NOT clean**: 73 tracked files modified vs HEAD (`3300 insertions(+), 881 deletions(-)`) + **47 untracked entries** (2026-08-10 edition recorded 66 modified + 39 untracked) |
| Staged | none (`git diff --cached` empty) |

### Working-tree delta, distinguished by provenance

**(a) Pre-existing dirty at audit baseline (2026-08-10, already uncommitted before the consolidation phase touched the repo):**
- Modified: `app/package.json`, `app/src/lib/config.ts`, `app/src/lib/plugin.ts`, `app/src/routes/+error.svelte`, `app/src/routes/+layout.svelte`, `app/src/routes/dashboard/+page.svelte`, `app/vitest.config.ts`, `backend/vitest.config.ts`, `bun.lock`
- Untracked: `.opencode/`, `app/src/lib/features/`, `app/src/routes/carousels/`, `app/src/routes/scripts/`, `audit-report.md`

**(b) Consolidation phase (2026-08-10):** as listed in the 2026-08-10 edition — `api/app.ts` production composition, `api/mcp/`, shared services, migrations 0002/0003, hiai-kit + Postiz integrations, observe emitter, writer/carousel products, frontend bridge, docs. Unchanged since; still uncommitted.

**(c) Hardening phase (2026-08-12/13) — new since the 2026-08-10 edition:**
- Migrations: `backend/src/db/migrations/0004_shared_context.sql` + `meta/0004_snapshot.json` (shared project/brand context fields, `content_source` enum, `content_items.source` + `current_revision_number` — see §4).
- Migration integrity tooling: `backend/scripts/migration-check.ts` (+ `db:check` npm script in `backend/package.json`) — journal validation, disposable-DB apply, snapshot/drift checks (§13 R8). Wired as the new **`migration-check` CI job** on a fresh Postgres 16 service container (`.github/workflows/ci.yml`).
- `bunfig.toml` (root, new): scopes bare `bun test` to the E2E suite only via `pathIgnorePatterns` (`**/*.test.*` are all vitest unit suites and are excluded); E2E skips only with `HIAI_POST_E2E_SKIP=1` and fails (never silently skips) when servers are unreachable.
- CI (`ci.yml`, modified): new `e2e` job (runs the E2E suite with `HIAI_POST_E2E_SKIP=1` — skip-mechanism + syntax gate), new `migration-check` job, `security` job rebuilt as a **hard gate** (`bun audit --audit-level=high`, no `continue-on-error`) plus a full always-visible `bun audit` with `|| true` bounded to the documented residuals. Frontend vitest job no longer `|| echo`-tolerated.
- Dependency remediation (2026-08-13): `vitest`/`@vitest/coverage-v8` `2.1.9 → 3.2.7` (both workspaces), `better-auth`/`@better-auth/drizzle-adapter` → `1.6.27`, `vite 6.4.2 → 6.4.3`, `@sveltejs/kit 2.66.0 → 2.70.2`, `@sveltejs/adapter-node → 5.5.7`, **`sharp` removed** (declared but never imported), plus lockfile pins within declared parent ranges (hono, js-yaml, ip-address, fast-uri, nanoid, postcss, brace-expansion, @hono/node-server, body-parser); unsafe global `overrides` (esbuild/cookie) removed. Recorded in `docs/SECURITY-REMEDIATION-2026-08-13.md`. **Live audit state today matches that record's final state: 3 sub-high residuals, high-gate green (§12).**
- hiai-observe coverage extension (2026-08-12): `services/content.ts` (`content.create`), `services/approval.ts` (`content.<action>`), `integrations/postiz/client.ts` (`postiz.submit`/`postiz.status_sync`), `api/routes/webhooks.ts` (`webhook.store_product` outcomes) instrumented; observe event-kind union extended (`content`/`postiz`/`webhook`); new `src/api/routes/webhooks.test.ts` (6 tests).
- Carousel slide-document persistence (2026-08-12): `PUT /api/v1/carousels/:id/slides/:index/json` + `slideDocumentSchema` + `saveCarouselSlideDocument` (observe op `carousel.slideDoc.save`) + frontend save button (`buildSlideDocument`) — see §6.
- MCP provenance (2026-08-12): MCP writer/carousel tool closures pass `{ source: "chatgpt" }`; session principals resolve to `web`, machine principals to `api` (§4, §8).
- Root `package.json` scripts normalized: `test:backend`, `test:frontend`, `test:e2e`, `test:coverage`, `db:check`, `audit`; `test` = vitest per workspace (bun:test no longer a unit runner).
- Docs: `README.md` test-count/architecture claims fixed (F27 partial), `docs/API.md` (+~299 ln) and `docs/ARCHITECTURE.md` (+~145 ln) updated for 0004, slide-doc persistence, observe coverage, chatgpt source; `MEMORY.md` extended (2026-08-12/13 entries); this delivery report.

Note: the pre-existing dirty `vitest.config.ts` files keep the working `poolOptions.forks = { minForks: 1, maxForks: 9 }` form; the full suites run green under vitest 3.2.7 (§13).

**Adjacent repositories (verified live 2026-08-13):**
- `hiai-observe/` — **clean** (0 changes), HEAD `5e2c5a5` (unchanged from audit baseline). Not touched by this phase; hiai-post only implements the client-side OTLP contract.
- `hiai-kit/` — HEAD moved `fa0f017` → `405ca53` (2 commits: durable-execution + docsmint ADR docs, internal hiai-kit work), working tree **dirty (18 files)** (MEMORY.md, ADR docs) — internal hiai-kit restructuring, unrelated to hiai-post. This phase only **read** hiai-kit contracts (capability/carousel routes, validation, registry, runner, job-store, `generate-slide-json.ts`). **External handoff pending: hiai-kit `content.post` capability does not exist yet** (§17).
- `carusel/`, `script/`, `hiai-dashboard/` — working trees still carry the pre-existing dirty state documented in the audit; untouched.

---

## 2. Architecture After Consolidation

```
app/ (SvelteKit :50301)
  hooks.server.ts ── resolves Better Auth session cookie + HIAI_TENANT_ID
  routes/api/v1/[...path]/+server.ts ── SSR proxy: injects Authorization: Bearer <session> + X-Tenant-Id
  routes/{writer,carousels,scripts}/ ── product pages (feature clients via same-origin proxy)
        │
        ▼ HTTP /api/v1/*  (backend :50300)
backend/src/api/app.ts ── createApiApp() production composition (side-effect-free, integration-tested)
  public: cors → secureHeaders → apiLogger → health | openapi.json | .well-known/ai-plugin.json
          | webhooks (outside protected chain; observe-instrumented outcomes)
          | oauthCallbackRoutes (header-less, state-derived)
          | authRoutes (Better Auth)
  protectedApp: authGuard → tenantGuard → auditAfterHandle → routes
    principals: ① Better Auth session (tenant via tenant_members membership, 403 TENANT_ACCESS_DENIED)
                ② admin-minted HS256 JWT (HIAI_ADMIN_JWT_SECRET; tenant from verified claim)
                ③ machine API key (Bearer hpk_<key>; tenant exclusively from the key row; X-Tenant-Id ignored)
    routes: projects · content · carousels (incl. PUT /:id/slides/:index/json) · writer
            · api-keys · mcp(JSON-RPC) · posts · content-plans · campaigns · templates
            · analytics · oauth · youtube · generate · queue · events
  onError(handleError) — inline global error handler (preserves 4xx preset status)
        │
        ├── services/  writer · carousels · content · projects · revisions · approval · apiKeys
        │     (runtime zod validation, DomainError → 400/404/409 envelopes, tenant from ctx.tenantId only,
        │      observeCall-wrapped: writer/carousels/content/approval emit start/success/failure)
        ├── integrations/hiai-kit/  the ONLY backend module building hiai-kit URLs
        │     capabilities.ts (research.general / content.article / content.carousel)
        │     carousel.ts (job create/get/slide JSON/regenerate/cover) · schemas.ts (slideDocumentSchema)
        │     http.ts (single HTTP boundary)
        ├── integrations/postiz/    typed publication boundary ONLY (observe-wrapped, not wired into publishing)
        ├── lib/observe.ts          single telemetry emitter → hiai-observe OTLP /v1/logs (Bearer key)
        │     events: writer.* · carousel.* · content.create · content.<action> (approval)
        │             postiz.submit/status_sync · webhook.store_product · mcp.* · api.request · hiai-kit.http
        ├── db/                     Drizzle schema + migrations 0000–0004 (journal complete,
        │     drift-checked by backend/scripts/migration-check.ts → CI migration-check job)
        └── core/                   scheduler/publisher/analytics — legacy (see §11)
```

Key architectural moves actually shipped (consolidation phase, unchanged):

1. **Testable production composition.** `index.ts` is now only the process entrypoint (Redis connect, listen, OAuth-refresh + dead-letter workers). The full app (public + protected) is built by `createApiApp()`/`createProtectedApp()` in `app.ts`, deliberately side-effect-free so `production-composition.test.ts` imports the real composition and proves every route reaches its handler.
2. **Three-principal auth** in `authGuard` + `tenantGuard` (session / admin-JWT / api-key), with tenant scope derivation per principal type (MEMORY.md "Tenant scope derivation" ADR).
3. **Elysia 1.4 hook discipline**: guards/audit/error composed **inline** (plain `onBeforeHandle`/`onAfterHandle`/`onError`), per-route RBAC via local `{ beforeHandle }` hooks.
4. **Shared product layer** (projects/brands/content/revisions/approval) + product services (writer/carousels) + machine surface (api-keys/MCP) all mounted in the protected app; **migrations now through 0004** with automated drift detection.
5. **Frontend session bridge** (`hooks.server.ts` + `lib/server/bridge.ts` + both proxies) — implemented; `bridge.test.ts` (8 tests) covers header building and tenant resolution.

---

## 3. Audit Findings Addressed

Status vocabulary: **FIXED** (implemented + tested) · **ADDRESSED** (implemented, live verification still environment-bound) · **PARTIAL** · **UNCHANGED** (out of phase scope).

| ID | Severity | Status | What actually shipped |
|----|----------|--------|------------------------|
| F9 | CRIT | **FIXED** | `X-Tenant-Id` no longer trust-on-header. `tenantGuard` requires an authenticated principal; session principals are validated against `tenant_members` (403 `TENANT_ACCESS_DENIED`), tenant must exist + be `active`; admin-JWT principals use the verified `tenant_id`/`tenantId` claim (mismatch → 403 `TENANT_MISMATCH`); api-key principals use only the key row's tenant. Covered by `__tests__/tenant.test.ts` (15) + `tests/integration/tenant-isolation.test.ts` (10) |
| F10 | HIGH | **FIXED** | RBAC is no longer bypassable-by-missing-ids: `checkRbac` consumes a pre-resolved `tenantRole`; viewer floor is instance-level on campaigns/content-plans/templates/queue/analytics/events/generate; editor/admin via local hooks. Backing tables (`tenant_members`, `tenant_role`) are in the migration journal (F23) |
| F7 | HIGH | **FIXED** | Query/body `tenantId` removed from queue/analytics/events; all scope comes from `ctx.tenantId`; analytics `/posts/:postId` scoped via `posts.tenantId` |
| F12 | LOW | **FIXED** | `posts` schedule/publish UPDATEs now re-scope by `tenantId` in the same statement (IDOR race closed) |
| F13 | CRIT | **FIXED** | `oauthCallbackRoutes` mounted **outside** `protectedApp`; callback derives identity from the signed one-time state (header-less). `oauth.ts` rewritten; `api/routes/oauth.test.ts` (6) + `lib/oauth-state.test.ts` (15) |
| F14 | HIGH | **FIXED** | X/Twitter PKCE fixed: `oauth-state.ts` now signs/generates the code verifier/state consistently (15 tests) |
| F17 | HIGH | **ADDRESSED (writer path)** | Mastra-generated content is **persisted**: writer service creates `content_items` + append-only `content_item_revisions` via `createContentItem`/`createRevision`; since 2026-08-12 persistence also carries `source` provenance and advances `current_revision_number` (§4). Mastra itself still runs in-memory; duplicate-check workflow (F18) remains unwired |
| F18 | MED | **UNCHANGED** | `duplicate-check.ts` workflow still not imported (writer-local adapter reuses the mastra `content-generate` workflow without the dedup step) |
| F20 | MED | **FIXED** | `hooks.server.ts` + bridge inject `Authorization`/`X-Tenant-Id` server-side; both proxies forward only explicit response headers (content-type, cache-control, set-cookie) — also addresses F22 |
| F21 | MED | **FIXED** | `+layout.server.ts` no longer logs session JSON; only scoped error messages |
| F22 | MED | **FIXED** | Proxy builds upstream headers via `buildUpstreamHeaders()` and filters hop-by-hop response headers (no blind forwarding) |
| F23 | CRIT | **FIXED** | Migration journal complete **through 0004** (`0000_initial_schema` … `0004_shared_context`). Since 2026-08-12 the journal is also **automatically drift-checked**: `backend/scripts/migration-check.ts` validates journal integrity (sequential idx, tag/file/snapshot match, no orphan SQL), applies 0000→current on a disposable DB via the Drizzle migrator, verifies core tables, compares the migrated DB against the latest committed snapshot (tables/columns/enums), and runs `drizzle-kit generate` against a throwaway copy to prove `schema.ts` has not drifted. Wired as the **CI `migration-check` job**. **Verified live 2026-08-13: PASS** (see §13 R8) |
| F24 | MED | **PARTIAL** | `.env.example` updated for the new env surface (hiai-kit / observe / Postiz / API-key / tenant vars, observe event coverage comment); **the webhook comment at `.env.example:70` still claims "HMAC SHA-256 of body" while code compares a raw shared-secret header** (`webhooks.ts` `timingSafeEqual`) — unchanged |
| F25 | MED | **PARTIAL** | Carousels have a **backend-owned product surface** (`/api/v1/carousels` + service + MCP) proxied through the session bridge, now incl. slide-document save (§6); the Scripts page remains a direct-hiai-kit feature client (`PUBLIC_HIAI_KIT_URL`) — still environment-dependent, ownership external (§7, §17) |
| F26 | MED | **ADDRESSED** | `lib/observe.ts` implements the hiai-observe OTLP `/v1/logs` emitter with the **verified Bearer API-key contract**; no-op when unconfigured. **Coverage extended 2026-08-12** to content/approval/Postiz/webhooks (§10). Live ingest remains environment-dependent |
| F27 | LOW | **PARTIAL → improved** | `docs/ARCHITECTURE.md` + `docs/API.md` updated to actual state (incl. 0004 fields, slide-doc persistence, observe event map, chatgpt source); **README test counts/architecture claims fixed 2026-08-13** (no more "58 tests" claims; documents `bun run test`/`test:e2e`/`db:check`). Remaining drift: `api/routes/writer.ts:20` stale "registration is serialized separately" comment (routes are mounted in `app.ts`), `features/carousel` vs `features/carousels` client duplication, `.env.example:70` HMAC comment (F24) |
| F28 | LOW | **RESOLVED** | `backend/dist/index.js` is gitignored + untracked; confirmed `git check-ignore` |
| F1–F6, F15, F16 | — | **UNCHANGED** | Native publish pipeline (scheduler/adapters/queue duality), analytics collector, refresh strategies for tiktok/youtube/telegram: explicitly out of this phase's scope; legacy publishing classified in §11, disposition unchanged in §17 |

---

## 4. Shared Product Foundation

Implemented in `backend/src/db/migrations/0002_shared_foundation.sql` + `0003_api_keys.sql` + **`0004_shared_context.sql`** + `backend/src/services/` + `api/routes/{projects,content}.ts`:

- **Schema (0002):** `projects`, `brands`, `content_items` (status enum `draft → in_review → approved` terminal, `changes_requested ↔ in_review`), `content_item_revisions` (immutable, append-only; restore copies snapshot + appends). Migration `0002` also finally creates the Better Auth `user`/`session`/`account`/`verification` tables missing on fresh DBs.
- **Schema (0004 — shared context, 2026-08-12):**
  - **Shared Project/Brand fields:** `projects` gains `default_language`, `target_audience`, `tone`, `content_guidelines`, `business_context`, `references` (jsonb, default `[]`); `brands` gains the same minus `tone` (brand `voice` is the tone/voice). All optional; `references` is a bounded jsonb array (max 20). Writer `resolveContext` folds the full brand context (incl. references rendering) into prompts.
  - **`content_items.source`** (`content_source` pgEnum: `web | api | chatgpt | automation | webhook | import`, default `web` NOT NULL) — **provenance is NEVER client input**: routes derive it via `contentSourceForContext(ctx)` (session → `web`, machine/api-key + admin-JWT → `api`), MCP tools pass `"chatgpt"` (`{ source: "chatgpt" }` in writer/carousel run closures), service default `"web"`.
  - **`content_items.current_revision_number`** (int, default 1) — the current-revision pointer; advanced in the SAME transaction by `createRevision`/`restoreRevision` (restore computes the revision number BEFORE the single item update so the returned row is fresh); `createContentItem` initializes 1.
- **Services** (`services/projects.ts`, `content.ts`, `revisions.ts`, `approval.ts`, `errors.ts`): runtime-validated (zod in-service), throw `DomainError` → `{error, code, message?, details?}` envelopes (400/404/409) via `handleServiceError`; injectable `db` for unit tests; tenant only from `ctx.tenantId`; approval + content-create wrapped in `observeCall` (§10). `referencesSchema` deliberately has NO `.default([])` so `partial()` updates distinguish omitted vs cleared.
- **Routes:** `GET/POST /api/v1/projects` (+ `/context`, `/brands`), `GET/POST /api/v1/content` (+ `/:id`, `/:id/revisions`, `/:id/revisions/:revisionId/restore`, `/:id/submit-review`, `/:id/request-changes`, `/:id/approve`). Viewer floor instance-level; editor+/admin via local hooks.
- **Test infra:** `__tests__/helpers/fake-db.ts` (in-memory drizzle-chain fake decoding `where` predicates); unit suites `projects.test.ts` (12), `content.test.ts` (19, incl. observe-enriched create), integration `content-routes.test.ts` (17 — incl. source override, pointer advance on revision + restore, cross-tenant revision 404s).

---

## 5. Writer Product

| Layer | Actual implemented state |
|---|---|
| Service | `services/writer.ts`: `generateWriterContent` / `rewriteWriterContent`. `article` → hiai-kit `content.article` capability via the centralized `integrations/hiai-kit` client (failures surface normalized `HiaiKitError` envelopes with correlationId — never silently degraded). `social_post` → `services/writer-local.ts`, a **temporary adapter** over the pre-existing mastra `content-generate` workflow (**hiai-kit `content.post` is not implemented** — external handoff, §17; adapter lazy-imported so unit tests never evaluate `@mastra/core`) |
| Persistence | Generate persists via `createContentItem` (revision #1 snapshot); rewrite via `createRevision` (append-only, prior revisions preserved). `contentType`/`tone`/`backend`/`correlationId` stored in `content_items.body_json`; rewrite derives content type from stored bodyJson (default `article`). Since 0004: **`source` provenance** (session→web / machine→api / MCP→chatgpt) recorded per item and **`current_revision_number`** advanced by the shared revision service |
| Context | `resolveContext` folds project + brand context incl. `references` rendering into generation prompts (0004 fields, §4) |
| Routes | `api/routes/writer.ts` — `POST /api/v1/writer/generate` (201) + `POST /api/v1/writer/rewrite`, **mounted in `createProtectedApp`** via `app.ts` (editor+ local hook, `generate` rate tier). (The `writer.ts:20` "registration is serialized separately" comment is stale — see §15 #9.) |
| Frontend | `app/src/routes/writer/+page.svelte` + `lib/features/writer/{api.ts, WriterEditor.svelte}` — same-origin SvelteKit proxy only; reads/revisions/approval reuse `/api/v1/content` |
| Tests | `__tests__/services/writer.test.ts` (13, fake db + mocked capability boundary); `tests/integration/writer-routes.test.ts` (13, real middleware chain + module-mocked hiai-kit/local writer) |
| MCP | `writer_generate`, `writer_rewrite` tools (§8; run closures pass `source: "chatgpt"`) |
| Telemetry | `writer.generate` / `writer.rewrite` via `observeCall` (§10) |

---

## 6. Carousel Product

| Layer | Actual implemented state |
|---|---|
| Service | `services/carousels.ts`: `createCarousel` (dispatches hiai-kit carousel job + snapshots revision #1), `regenerateCarousel` (appends revision), `regenerateSlide`, job status polling, slide-JSON fetch — all proxying hiai-kit through the centralized adapter and persisting `{ kind: "carousel", ... }` bodyJson with immutable revisions |
| **Slide-document persistence (2026-08-12)** | `PUT /api/v1/carousels/:id/slides/:index/json` (editor+): the request body IS the hiai-kit slide document, validated by the new `slideDocumentSchema` in `integrations/hiai-kit/schemas.ts` (mirrors `hiai-kit/src/modules/carousel/generate-slide-json.ts` 1:1 — canvas width/height required, element id/type/x/y required, `type` union text/image/rect/circle/line/arrow/group, group children via `z.lazy` with explicit `z.ZodType` annotations, `.passthrough()` so shadow/dash/future fields round-trip). Service `saveCarouselSlideDocument` (observe op `carousel.slideDoc.save`) replaces ONLY the selected slide's `doc` (+ `savedAt` on `CarouselSlideData`), leaves other slides/deck/jobState untouched, appends an immutable revision (`changeNote: "Slide N document saved"`, advances `current_revision_number`), returns `{ item, revision, slide }`. Invalid doc/index → 400 VALIDATION, nothing persisted. Frontend: `saveCarouselSlideDocument()` in `features/carousels/api.ts`; `+page.svelte` "Save slide document" button — `buildSlideDocument(slide, w, h, preset)` composes a renderable `{version:1, width, height, background, elements:[text…]}` doc (no canvas editor ported) |
| Routes | `api/routes/carousels.ts` — GET `/`, `/:id`, `/:id/revisions`, `/:id/job`, `/:id/slides/:index/json` (viewer+); POST `/`, `/:id/regenerate`, `/:id/slides/:index/regenerate`, `PUT /:id/slides/:index/json`, `/:id/submit-review`, `/:id/request-changes` (editor+); `/:id/approve` (admin+). OpenAPI `put` entry added |
| Frontend | `app/src/routes/carousels/+page.svelte` + `lib/features/carousels/api.ts` (typed client over the same-origin `/api/v1/carousels` proxy; slide-document save wired). A pre-existing `lib/features/carousel/` client (direct hiai-kit) also remains on disk (§11) |
| Tests | `tests/integration/carousels-routes.test.ts` (**21**, incl. PUT save/read-back, invalid doc/index 400, viewer 403, cross-tenant 404) + `__tests__/services/carousels.test.ts` unit suite (17) |
| MCP | `carousel_generate`, `carousel_get`, `carousel_regenerate`, `carousel_regenerate_slide`, `carousel_submit_review`, `carousel_request_changes`, `carousel_approve` tools (§8) |
| Telemetry | `carousel.create` / `carousel.regenerate` / `carousel.regenerateSlide` / `carousel.job.status` / `carousel.slideDoc.save` events |

---

## 7. Script Status

- **Frontend only.** `app/src/routes/scripts/+page.svelte` + `lib/features/scriptforge/api.ts` — a typed client for hiai-kit's `/api/v1/scriptforge/*` endpoints (`run-pipeline`, `continue-pipeline`, `re-polish`, `re-polish-saved`) via `PUBLIC_HIAI_KIT_URL` (default `http://localhost:3000`). **Unchanged since 2026-08-10.**
- **No backend route/service in hiai-post** — script generation is not part of the consolidated backend surface. The legacy `script/` repo's implementation was absorbed into hiai-kit (`src/modules/scriptforge/*`).
- **Status: PARTIAL (external peer-service dependency).** The page renders and the client is typed/unit-covered indirectly (sse tests), but live generation requires a running, authenticated hiai-kit and was **not** verified end-to-end in this environment. **Ownership of the pipeline is hiai-kit**; hiai-post deliberately keeps a thin client and does not re-implement it (§17).

---

## 8. ChatGPT Work / MCP Surface

| Surface | Actual implemented state |
|---|---|
| JSON-RPC endpoint | `POST /api/v1/mcp` (`api/routes/mcp.ts`; registry `api/mcp/tools.ts`; `api/mcp/jsonrpc.ts` protocol core). Registered with `{ parse: "none" }` so the raw body stays readable for protocol-valid `-32700` errors. **Machine principals only** — local guard rejects session tokens (`MACHINE_AUTH_REQUIRED`) |
| **Tools — 16, confirmed by live inventory (2026-08-12)** | `writer_generate`, `writer_rewrite`, `carousel_generate`, `carousel_get`, `carousel_regenerate`, `carousel_regenerate_slide`, `carousel_submit_review`, `carousel_request_changes`, `carousel_approve`, `content_get`, `content_list`, `content_submit_review`, `content_request_changes`, `content_approve`, `project_list`, `project_get` — thin wrappers over the shared services with per-tool scope checks + zod `argsSchema` pre-validation; failures → MCP tool results with `isError: true` (never protocol errors). Carousel review tools REUSE the `content:*` review scopes (a carousel IS a content item; shared approval state machine) and verify the target is a carousel first. `project_list`/`project_get` gated by `content:read` (project resolution for generation). **Since 0004: run closures pass `{ source: "chatgpt" }` so MCP-created content is provenance-tagged** |
| Discovery | `GET /api/v1/openapi.json` — canonical spec built from actually-mounted routes (`api/openapi.ts`, securitySchemes sessionBearer / adminJwt / machineApiKey). `GET /.well-known/ai-plugin.json` — honest ChatGPT manifest (`ai-plugin.ts`): declares `service_http` bearer auth because machine auth is integration-tested; points at the OpenAPI spec |
| API keys | `services/apiKeys.ts` + `api/routes/apiKeys.ts` + migration `0003_api_keys.sql`: `hpk_<secret>` keys stored as SHA-256 hex (`key_hash` unique) + visible `prefix`; plaintext returned exactly once; list (no hashes), revoke (tombstone), expiry, scopes (jsonb), last-used touch; scope constants + `apiKeyRoleForScopes` |
| Tests | `tests/integration/mcp-api-keys.test.ts` (**28 tests**): hash-only storage, revocation/expiry 401, cross-tenant denial (lying `X-Tenant-Id` ignored for key principals), protocol errors (`-32700/-32600/-32601/-32602`), real service invocation for writer/carousel/content/approval/review/project tools (incl. `chatgpt` source on created items), review round-trip, `INSUFFICIENT_SCOPE`, `MACHINE_AUTH_REQUIRED` |
| Telemetry | `mcp.request` per RPC + `mcp.tools.call:<tool>` via `observeCall` (§10) |

**Honest readiness claim:** the MCP/API-key surface is verified at the **local application layer** (unit + integration tests against the real composition with mocked hiai-kit boundaries). **No live ChatGPT/OpenAI action end-to-end was performed** — that requires a deployed backend with real credentials and an OpenAI Actions configuration, which is outside this environment (§17).

---

## 9. Postiz Boundary

`backend/src/integrations/postiz/` — **typed integration boundary ONLY** (not wired into publishing, no queue, no consumer):

- `config.ts` (`POSTIZ_API_URL` / `POSTIZ_API_KEY` / `POSTIZ_TIMEOUT_MS` via `getConfig`; log-safe summary that never prints the key), `schemas.ts` (generic `externalProvider`/`externalItemId`/`scheduledAt`/`status` (scheduled|published|failed|cancelled)/`url`/`error`), `errors.ts` (`PostizError`: `NOT_CONFIGURED`/`TIMEOUT`/`VALIDATION_ERROR`/`POSTIZ_ERROR`), `client.ts` (`createPostizClient`: `submitPublication` + `syncStatus`; Bearer + `x-trace-id` + `AbortSignal.timeout`; unconfigured → throw `NOT_CONFIGURED` → 503 — never fabricated success). **Since 2026-08-12 both methods are `observeCall`-wrapped** (`postiz.submit` / `postiz.status_sync`, §10).
- Endpoint paths (`/api/v1/publications`, `/api/v1/publications/status`) are boundary expectations — **verify against the actual Postiz deployment before enabling live use** (§17). No live Postiz credentials or service exist in this environment; live behavior is unverified by design.
- Tests: `postiz.test.ts` (**17**, incl. +4 observe coverage) mock only `fetch`.
- The pre-existing `core/publisher/` adapters were **not touched** and remain the current (legacy) publishing owners (§11).

---

## 10. hiai-observe

- **Single emitter:** `backend/src/lib/observe.ts` sends structured start/success/failure events to hiai-observe's OTLP `/v1/logs` with the **verified Bearer API-key contract** (`Authorization: Bearer <HIAI_OBSERVE_API_KEY>`; verified against `hiai-observe/src/middleware/auth.ts` — `/v1/logs` is not in `PUBLIC_PATHS`; `X-Sentry-Auth` is deliberately never used).
- **Config:** `HIAI_OBSERVE_URL` / `HIAI_OBSERVE_API_KEY` / `HIAI_OBSERVE_PROJECT` / `HIAI_OBSERVE_TIMEOUT_MS` (default `http://localhost:8001`/unset/unset/2000). Reads `process.env` **directly** (not the strict config singleton) so telemetry can never fail startup; **no-op when unconfigured** (zero network).
- **Guarantees:** fire-and-forget `observeEvent()` + `observeCall(opts, fn)` wrapper (returns/rethrows the op's own result); bounded `AbortSignal.timeout`; correlationId → OTLP traceId (32 hex); sanitized metadata only (secret-shaped keys dropped, strings ≤500, primitives only); never serializes the API key.
- **Instrumented points (extended 2026-08-12):**
  - `services/writer.ts` — `writer.generate` / `writer.rewrite`
  - `services/carousels.ts` — `carousel.create` / `carousel.regenerate` / `carousel.regenerateSlide` / `carousel.job.status` / `carousel.slideDoc.save`
  - `services/content.ts` — **`content.create`** (success enriched with contentItemId/status/**source**)
  - `services/approval.ts` — **`content.<action>`** around `transition` (submit_review/approve/request_changes; invalid transition → failure `INVALID_TRANSITION`, not-found → failure)
  - `integrations/postiz/client.ts` — **`postiz.submit` / `postiz.status_sync`** (failure enriched with provider/itemId)
  - `api/routes/webhooks.ts` — **`webhook.store_product`** terminal outcomes: `NOT_CONFIGURED`/`INVALID_SIGNATURE`/`TENANT_NOT_FOUND`/`TENANT_SUSPENDED` failures + success with postId/deduplicated
  - `integrations/hiai-kit/http.ts` requestCore — `hiai-kit.http` (carries the run correlationId)
  - `api/routes/mcp.ts` — `mcp.request` per RPC + `mcp.tools.call:<tool>` via `observeCall` around tool.run
  - `api/middleware/apiLogger.ts` — `api.request` per `/api/*` request (skipping health/CORS)
  - Event-kind union extended with `content` / `postiz` / `webhook`. `SENTRY_DSN` remains declared-only legacy.
- **Tests:** `src/lib/observe.test.ts` (13), `src/__tests__/services/content.test.ts` (19, incl. +3 observe), `src/integrations/postiz/postiz.test.ts` (17, incl. +4 observe), **`src/api/routes/webhooks.test.ts` (6, new)** — all mock only `fetch`; integration suites stay green because observe is disabled there (no env).
- **Live ingest is unverified** — no hiai-observe credentials/service in this environment (hiai-observe's own container stack is present on the host but its API key is environment-dependent). External handoff for a real API key + ingest validation (§17).

---

## 11. Legacy Code

Classification vocabulary: **DEPRECATED** (still present, no longer the target) · **REPLACED** (a shipped replacement exists) · **DELETE LATER** (safe removal candidate once the replacement is proven in live use).

| Legacy / dead code | Location | Classification | Notes |
|---|---|---|---|
| Native platform publishing adapters (11 platforms) | `core/publisher/index.ts` + per-platform files | **DEPRECATED / REPLACED — DELETE LATER** | Superseded in intent by the Postiz boundary (`integrations/postiz/`). Still zero runtime callers (pipeline never started — audit F1–F3, unchanged). Retain only until Postiz-backed publishing is wired and live-verified (§17) |
| `Publisher.start()` / `registerPublisher` / scheduler | `core/scheduler/publisher.ts` | **DEPRECATED — DELETE LATER** | Zero callers; no scheduler/worker service in compose. Postiz boundary is the replacement target |
| Mastra `content-generate` workflow | `mastra/workflows/content-generate.ts` (+ agents/tools) | **REPLACED for `article`; retained as temporary `social_post` adapter** | `services/writer-local.ts` lazy-imports it until hiai-kit implements `content.post` (§17); then **DELETE LATER** |
| `duplicate-check.ts` / `platform-format.ts` workflows, `web-search` tool | `mastra/workflows/`, `mastra/tools/` | **DELETE LATER or wire** | Still unused (F17/F18 unchanged) |
| `broadcastEvent` / SSE feedback, analytics collector, scheduler rate-limiter/retry, dead-letter variants, `store-listener` scaffold | `api/routes/events.ts`, `core/analytics/*`, `core/scheduler/{rate-limiter,retry,dead-letter}.ts`, `core/events/store-listener.ts` | **DELETE LATER or wire** | Out of phase scope; documented in audit §32 |
| `SENTRY_DSN` declared-only value | `backend/src/lib/config.ts` | **DEPRECATED / REPLACED** | Real emitter is `lib/observe.ts` (OTLP); Sentry-style ingest deliberately not used |
| `carusel/`, `script/` legacy repos | adjacent repos | **REPLACED — DELETE LATER** | Implementations absorbed into hiai-kit (`modules/carousel`, `modules/scriptforge`); hiai-post has zero references; archive once hiai-kit ownership is confirmed (§17) |
| Legacy `features/carousel/` client (direct hiai-kit) | `app/src/lib/features/carousel/` | **DEPRECATED** | Superseded for the product surface by `features/carousels/api.ts` (backend-proxied, incl. slide-document save); retained for the scripts-style direct feature pattern |
| E2E suite (not legacy — reference) | `app/tests/e2e/post.spec.ts` (7 scenarios, tracked at HEAD) | **scaffold, env-gated** | Drives the running stack through the repository's gated accessibility-tree automation CLI (the mainstream browser-automation framework is banned per AGENTS.md); skips with `HIAI_POST_E2E_SKIP=1` (verified live: 7 skip, exit 0, §13 R9); requires running dev servers otherwise. No browser run performed in this delivery (§13, §15 #1) |

---

## 12. Security / Tenant Verification

Implemented and test-verified (all local):

1. **Tenant scope derivation** — 3 principal types; session → `tenant_members` membership; admin-JWT → verified claim; api-key → key row only (`X-Tenant-Id` ignored). Lying headers are rejected (cross-tenant denial tested in `mcp-api-keys.test.ts` and `tenant-isolation.test.ts`).
2. **Query/body tenantId removed** from queue/analytics/events; posts write-scoped.
3. **Machine credentials are hash-only** (SHA-256 `key_hash` + prefix; plaintext once; apiLogger logs method/url only; audit never logs create responses).
4. **RBAC** consumes pre-resolved role; viewer floor everywhere on the protected surface; admin gates on approvals/api-key management.
5. **Webhooks** remain outside the protected chain (shared `X-Webhook-Secret`, constant-time compare, body `tenantId` validated against `tenants` — 400 `TENANT_NOT_FOUND`/`TENANT_SUSPENDED` instead of FK 500); terminal outcomes now observe-instrumented (§10).
6. **Audit logging** (POST/PUT/PATCH/DELETE on success) with secret redaction + 500-char truncation, best-effort.
7. **OAuth callbacks** header-less, state-derived identity (F13/F14 fixed; tested).
8. **Frontend** no longer trusts the browser for identity — headers injected server-side from the session cookie.

**Dependency remediation (2026-08-13) — what shipped and its honest live status:**

- Shipped and **verified live in this edition**: `vitest` + `@vitest/coverage-v8` **3.2.7** (both workspaces; the critical GHSA-5xrq-8626-4rwp advisory is gone), `better-auth`/`@better-auth/drizzle-adapter` **1.6.27**, `vite` **6.4.3**, `@sveltejs/kit` **2.70.2**, `@sveltejs/adapter-node` **5.5.7**, `sharp` **removed** (no imports anywhere); lockfile pins within declared parent ranges (hono 4.13.1, js-yaml 3.15.1, ip-address 10.5.0, fast-uri 3.1.5, nanoid 5.1.16 + **3.x copies at 3.3.18** via the same-day follow-up pin, postcss 8.5.26, brace-expansion 2.1.4+5.0.9, @hono/node-server 1.19.17, body-parser 2.3.0); **no root `overrides` remain** (the unsafe esbuild/cookie global pins were removed after critic review; consumers resolve their own in-range copies: esbuild 0.18.20/0.25.12/0.28.2, cookie 0.6.0/0.7.2/1.1.1). Full record: `docs/SECURITY-REMEDIATION-2026-08-13.md`.
- **Live `bun audit` today (this edition): 3 vulnerabilities (1 moderate, 2 low); `bun audit --audit-level=high` exits 0 — the CI `security` hard gate is GREEN.** The nanoid advisory (GHSA-2v37-7h3g-55p8) is **resolved**: the lockfile's 3.x copies were pinned **3.3.17 → 3.3.18** (the same-day follow-up recorded in `docs/SECURITY-REMEDIATION-2026-08-13.md`; verified in bun.lock as `@ai-sdk/provider-utils/nanoid@3.3.18` and `postcss/nanoid@3.3.18`, within each consumer's declared `^3.3.x` range; the 5.x copy stays at 5.1.16). The three remaining residuals match the documented set exactly: moderate `esbuild ≤0.24.2` (0.18.20 via `@esbuild-kit/core-utils` under drizzle-kit's dev-time CLI transform path — no in-range patched version exists; vite 0.25.12 / tsx 0.28.2 copies are patched), low `@ai-sdk/provider-utils ≤3.0.97` (via `@mastra/core` — no stable patched 3.x), low `cookie <0.7.0` (0.6.0 copy via `@sveltejs/kit`; elysia/express resolve patched 1.1.1/0.7.2). All three are below the high gate and remain visible-by-design in the full audit. See §15 #1 (now resolved) and §16.

Live multi-tenant hardening beyond local tests (production `HIAI_ADMIN_JWT_SECRET`, real membership provisioning, deployed migration state) remains **environment-dependent**.

---

## 13. Runtime Verification

All commands run **locally on 2026-08-13** against the current working tree (this delivery record). Postgres (`hiai-post-pg` :5436) and Redis (`hiai-post-redis` :6383) containers were running for the db:check and migration-state checks. Versions: bun 1.3.14, vitest 3.2.7, biome 2.5.

| # | Command | Result | Status |
|---|---------|--------|--------|
| R1 | `bun run lint` (biome 2.5, both workspaces) | `hiai-post-frontend: Checked 57 files … exit 0`; `hiai-post-api: Checked 131 files … exit 0` | **PASS** |
| R2 | `bun run typecheck` | `hiai-post-frontend typecheck: exit 0` (`svelte-kit sync && tsc --noEmit`); `hiai-post-api typecheck: exit 0` (`tsc --noEmit`) | **PASS** |
| R3 | `bun run test` → backend `vitest run` | **24 files / 311 tests passed** (4.20s, vitest 3.2.7). Key files: `mcp-api-keys` (28), `carousels-routes` (21), `content-routes` (17), `writer-routes` (13), `carousels` unit (17), `content` unit (19), `postiz` (17), `tenant` (15), `oauth-state` (15), `writer` unit (13), `projects` unit (12), `rbac` (11), `scheduler` (11), `tenant-isolation` (10), `auth` (10), `queue` (9), `platform-rules` (9), `production-composition` (6), `webhooks` (6, new), `oauth` routes (6), `encryption` (4) — exit 0 | **PASS** |
| R4 | `bun run test` → app `vitest run` | **2 files / 22 tests passed** — `src/lib/server/bridge.test.ts` (8), `src/lib/features/shared/sse.test.ts` (14) — exit 0 | **PASS** |
| R5 | Backend coverage — `cd backend && bunx vitest run --coverage` | **24 files / 311 tests passed; All files: 52.31% statements, 79.43% functions, 67.25% branches** (services 91.11% stmts: carousels 93.86, content 95.53, projects 94.8, apiKeys 99.26, approval 100, revisions 100; writer-local 23.72 — temporary adapter) — exit 0 | **PASS** |
| R6 | Frontend coverage — `cd app && bunx vitest run --coverage` | **2 files / 22 tests passed; All files: 1.34% statements** (bridge + sse only — no frontend component coverage exists) — exit 0 | **PASS** |
| R7 | `bun run build` | `hiai-post-api: Bundled 1539 modules … index.js … exit 0`; `hiai-post-frontend: ✓ built in 15.35s / 28.01s … adapter-node ✔ done … exit 0` | **PASS** |
| R8 | `bun run db:check` (migration integrity, disposable DB `hiai_post_check` on the running `hiai-post-pg` container, dropped afterwards) | **PASS, exit 0**: journal integrity ✓ (0000–0004 sequential, tag/file/snapshot matched, no orphans); 5 migrations applied via the Drizzle migrator; core tables ✓ (`tenant_members`, `user`, `session`, `account`, `verification`, `content_items`, `api_keys`); **18 tables + 18 table column sets + 3 enum types match `meta/4_snapshot.json`**; `drizzle-kit generate` against a throwaway copy → **no schema drift** (`schema.ts` in sync) | **PASS** |
| R9 | E2E suite — `cd app && HIAI_POST_E2E_SKIP=1 bun test tests/e2e/` | **0 pass / 7 skip / 0 fail**, exit 0 — proves the skip mechanism and suite discoverability (bunfig.toml scoping) only; **no browser was driven** | **SKIP MECHANISM VERIFIED** |
| R10 | `bun audit --audit-level=high` | **exit 0 — no high/critical advisories.** nanoid resolved (3.x copies pinned to 3.3.18, GHSA-2v37-7h3g-55p8 cleared). **The CI `security` hard gate is GREEN** (§12, §15 #1) | **PASS (gate green)** |
| R11 | `bun audit` (full) | **exit 1 — 3 vulnerabilities (1 moderate, 2 low), all documented sub-high residuals:** esbuild ≤0.24.2 (moderate, via `@esbuild-kit/core-utils` — no in-range patched version); `@ai-sdk/provider-utils ≤3.0.97` (low, via `@mastra/core`); cookie <0.7.0 (low, 0.6.0 copy via `@sveltejs/kit`). Resolved copies present: nanoid 3.3.18+5.1.16, esbuild 0.18.20/0.25.12/0.28.2, cookie 0.6.0/0.7.2/1.1.1, vitest 3.2.7, better-auth 1.6.27, vite 6.4.3, kit 2.70.2 | **3 ADVISORIES (all sub-high, documented)** |
| R12 | Dev DB migration state — `hiai_post` (`drizzle.__drizzle_migrations`) | **1 entry (0000 only)** — migrations 0001–0004 apply cleanly on fresh DBs (R8) but **have not been applied to the running dev DB**; deployment step pending (§15 #5) | **INFO (deploy step)** |
| R13 | `bun test` (bare, bun:test runner) | **Not a unit-test runner** — all `*.test.*` files are vitest suites using `vi.*` globals. `bunfig.toml` now excludes them via `pathIgnorePatterns`, so bare `bun test` discovers only the E2E `*.spec.ts` (needs dev servers; fails rather than silently skips without `HIAI_POST_E2E_SKIP=1`). Canonical unit command: `bun run test` (vitest) → R3/R4 green | **NOT A UNIT RUNNER (by design)** |

**Explicitly NOT verified (environment-dependent):** live hiai-kit capability/carousel/scriptforge calls (needs running hiai-kit + valid session credentials), live Postiz submission/status sync, live hiai-observe ingest, live ChatGPT/OpenAI action invocation, deployed/migrated production DBs, real platform OAuth + publishing. **No Writer/Carousel browser E2E and no remote ChatGPT/Postiz readiness is claimed** — the E2E suite exists but was only exercised via its skip mechanism (R9), and the local application-layer / API / MCP paths above are the extent of verified behavior.

---

## 14. Writer and Carousel Feature Parity Matrices

### 14.1 Backend service / route parity

| Capability | Writer | Carousel |
|---|---|---|
| Generate (new item + revision #1) | ✅ `POST /api/v1/writer/generate` (`writer.generate`) | ✅ `POST /api/v1/carousels` (`carousel.create`, job-dispatch) |
| Regenerate / rewrite (append revision) | ✅ `POST /api/v1/writer/rewrite` (`writer.rewrite`) | ✅ `POST /api/v1/carousels/:id/regenerate` |
| Per-part regenerate | — (whole-item only) | ✅ `POST /api/v1/carousels/:id/slides/:index/regenerate` (persists slide doc) |
| **Slide-document save** | — | ✅ `PUT /api/v1/carousels/:id/slides/:index/json` (validated doc → persisted + revision appended; `carousel.slideDoc.save`) |
| Get one | ✅ via `/api/v1/content/:id` | ✅ `GET /api/v1/carousels/:id` |
| List | ✅ via `/api/v1/content` | ✅ `GET /api/v1/carousels` |
| Revision history (immutable, `current_revision_number` pointer) | ✅ `/api/v1/content/:id/revisions` | ✅ `GET /api/v1/carousels/:id/revisions` |
| Restore (snapshot + append) | ✅ `…/revisions/:revisionId/restore` | ✅ same shared revisions service |
| Approval workflow (submit-review / request-changes / approve) | ✅ shared content routes (admin+ approve) | ✅ carousel routes (admin+ approve) |
| Async job status | — (synchronous article run / local adapter) | ✅ `GET /api/v1/carousels/:id/job` |
| Slide JSON export | — | ✅ `GET /api/v1/carousels/:id/slides/:index/json` |
| MCP tools | `writer_generate`, `writer_rewrite` | `carousel_generate`, `carousel_get`, `carousel_regenerate`, `carousel_regenerate_slide`, `carousel_submit_review`, `carousel_request_changes`, `carousel_approve` |
| Provenance | `source` recorded (session→web / machine→api / MCP→chatgpt) | `source` recorded (same derivation) |
| Generation backend | `article` → hiai-kit `content.article`; `social_post` → local mastra adapter (temporary, §17) | hiai-kit carousel jobs (`integrations/hiai-kit/carousel.ts`) |
| Telemetry events | `writer.generate`, `writer.rewrite` | `carousel.create/regenerate/regenerateSlide/job.status/slideDoc.save` |
| Guard floor | editor+ (write), viewer+ (reads) | editor+ (write), admin+ (approve), viewer+ (reads) |

### 14.2 Frontend parity

| Capability | Writer | Carousel |
|---|---|---|
| Page | `app/src/routes/writer/+page.svelte` | `app/src/routes/carousels/+page.svelte` |
| Editor component | `features/writer/WriterEditor.svelte` | inline in page (carousel canvas/slides) |
| Typed API client | `features/writer/api.ts` (same-origin proxy) | `features/carousels/api.ts` (same-origin proxy) |
| Project context picker | ✅ (listProjects) | ✅ |
| Revision history + restore | ✅ | ✅ |
| Approval actions | ✅ (submit/request/approve) | ✅ (submit/request/approve) |
| Job status polling | — | ✅ (`/:id/job`) |
| Slide-level JSON edit/regenerate | — | ✅ (regenerate + **save slide document** via `buildSlideDocument`) |
| E2E (page render → proxy → backend → hiai-kit) | **NOT verified** (no browser run in this delivery; no live hiai-kit session) | **NOT verified** (same; live hiai-kit job runner + credentials environment-dependent) |
| Local application-layer tests | ✅ 13 unit + 13 integration | ✅ 17 unit + 21 integration |

**Parity gap summary:** Carousel is the deeper product (job lifecycle, per-slide regeneration, slide JSON, async status, slide-document save); Writer's only functional gap is the temporary `social_post` local adapter (until hiai-kit `content.post` exists). Both share the identical revision/approval foundation, provenance tagging, and MCP exposure; **neither has browser-E2E or live coverage in this environment**.

---

## 15. Remaining Known Issues

Classified honestly against the live evidence in §13:

1. **CI security gate GREEN — nanoid advisory RESOLVED (2026-08-13).** Live `bun audit --audit-level=high` exits 0: the lockfile's nanoid **3.x copies are pinned to 3.3.18** (3.3.17 → 3.3.18, the same-day follow-up recorded in `docs/SECURITY-REMEDIATION-2026-08-13.md`; verified in bun.lock as `@ai-sdk/provider-utils/nanoid@3.3.18` + `postcss/nanoid@3.3.18`, both within their consumers' declared `^3.3.x` ranges; GHSA-2v37-7h3g-55p8 cleared; the 5.x copy stays at 5.1.16). The three documented sub-high residuals remain visible-by-design in the full audit (R11): moderate esbuild 0.18.20 via `@esbuild-kit/core-utils` (drizzle-kit dev-time CLI transform path only; no in-range patched version), low cookie 0.6.0 via `@sveltejs/kit`, low @ai-sdk/provider-utils via `@mastra/core`. No further action required to keep the gate green; re-check after any dependency change.
2. **Browser/E2E not performed in this delivery.** No browser-automation CLI run was executed; the E2E suite (`app/tests/e2e/post.spec.ts`, 7 scenarios) was only exercised via `HIAI_POST_E2E_SKIP=1` (7 skip, exit 0). Writer/Carousel pages remain verified at typecheck/build/unit/integration level only. Delegating to vision/general in a gated environment is required for real browser flows.
3. **Live peer services unverified — external handoffs** (§17): hiai-kit capability/carousel/scriptforge calls, Postiz submission/sync, hiai-observe ingest all require environment credentials/services not present here; the boundaries fail honestly (401 `HIAI_KIT_ERROR`, 503 `NOT_CONFIGURED`, no-op telemetry) but live behavior is unproven.
4. **No ChatGPT remote readiness claim** — MCP verified locally (28 integration tests incl. chatgpt source provenance); OpenAI Actions deployment + live invocation not performed.
5. **Dev DB not migrated forward** — local `hiai_post` is at 0000 (1 journal entry); run `bun run db:migrate` (+ seed + provision `tenant_members`) before using the new surfaces; 0001–0004 are proven clean on fresh DBs (R8).
6. **Native publishing still dead** (audit F1–F6) — scheduler/adapters unwired; legacy adapters DEPRECATED/REPLACED; Postiz boundary not yet wired into publishing. P0 decision (D1/D2) still open.
7. **`social_post` uses a temporary local mastra adapter** until hiai-kit implements `content.post` (external handoff).
8. **`bun test` (bun:test) is not a unit-test runner** — bunfig.toml scopes it to E2E only; use `bun run test` (vitest, green) or `bun run test:e2e` (needs dev servers; `HIAI_POST_E2E_SKIP=1` in CI).
9. **Docs drift (minor, F27 remainder):** `api/routes/writer.ts:20` comment still says registration is "serialized separately (see backend/src/api/index.ts)" — routes are mounted via `app.ts`; `.env.example:70` webhook comment still claims HMAC (F24); duplicate `features/carousel` vs `features/carousels` clients.
10. **OAuth refresh gaps** (tiktok/youtube/telegram) and **analytics collector unwired** — unchanged, out of scope (F15/F16, F3).
11. **RBAC/tenant live enforcement** depends on migrated DBs + provisioned membership (fail-closed 403 until then, by design).
12. **Frontend coverage is minimal** — 1.34% statements (bridge + sse only); no component-level tests exist.

---

## 16. Next Recommended Phase

Sequenced after this delivery (each independently shippable):

1. **~~Restore the security gate~~ — DONE (2026-08-13).** nanoid 3.x pinned 3.3.17 → 3.3.18 within declared ranges; `bun audit --audit-level=high` re-verified live at **exit 0**; CI `security` hard gate is **green**; the three documented sub-high residuals remain visible-by-design (R10/R11, §15 #1).
2. **Deploy & provision (½–1 day).** Apply migrations 0001–0004 to dev/staging DBs (`bun run db:migrate`; local `hiai_post` is still at 0000); seed; provision `tenant_members` for the demo tenant (currently fail-closed 403 until membership exists — by design); document `HIAI_TENANT_ID` per workspace.
3. **Publishing decision (D1/D2) + wire.** Either start the legacy publisher in-process behind a flag or implement Postiz-backed publication through `integrations/postiz` (typed, sanitized, observe-instrumented, tested path already exists); delete/wire remaining dead code per §11; unify queue impls.
4. **Live integration validation (external handoffs — §17).** hiai-kit capability/carousel/scriptforge with real session credentials (incl. `HIAI_KIT_COOKIE`/`HIAI_KIT_TOKEN`); hiai-observe ingest with a real API key; Postiz against the actual deployment (verify endpoint paths).
5. **ChatGPT surface hardening.** Deploy with machine API keys; validate the OpenAPI spec + plugin manifest against an actual OpenAI Actions config; add server-side request validation for `-32700` at the edge.
6. **Browser-gated E2E.** Run `app/tests/e2e/post.spec.ts` against running dev servers (HIAI_POST_E2E_SKIP unset) with the gated accessibility-tree automation CLI; extend to Writer/Carousel/Scripts pages and the OAuth + approve flows.
7. **Cleanup.** Fix F24 webhook docs, `writer.ts` stale comment, `features/carousel` vs `features/carousels` consolidation; archive `carusel/`/`script/` once hiai-kit ownership confirmed.

---

## 17. External Handoffs (Open Ownership)

Explicitly external work this delivery does **not** claim and that blocks the corresponding live claims:

| # | Handoff | Owner | Blocked claim / dependency | What hiai-post has ready |
|---|---|---|---|---|
| H1 | **hiai-kit `content.post` capability** | hiai-kit team | `social_post` writer path still runs the temporary local mastra adapter (`services/writer-local.ts`); once `content.post` exists, delete the adapter (lazy-imported so it never affects unit tests) | `integrations/hiai-kit/capabilities.ts` central client; normalized `HiaiKitError` envelopes; `writer.ts` routes `article` already through the capability boundary |
| H2 | **Script pipeline ownership** | hiai-kit (`modules/scriptforge`) | Live script generation + `scripts/` page E2E (page is a thin `PUBLIC_HIAI_KIT_URL` client; hiai-post deliberately does not re-implement the pipeline) | Typed `features/scriptforge/api.ts` SSE/JSON client; docs/API.md endpoint contract |
| H3 | **Live Postiz verification + wiring** | Postiz deployment owner (verify `/api/v1/publications` + `/status` paths) + hiai-post (wire publishing) | `postiz.submit`/`status_sync` live behavior; native publishing disposition (D1/D2) | `integrations/postiz/` typed, sanitized, observe-instrumented boundary (17 tests); `NOT_CONFIGURED → 503` honesty; legacy publisher untouched (§11) |
| H4 | **hiai-observe ingest validation** | hiai-observe deployment owner (provision `HIAI_OBSERVE_API_KEY`) | Live OTLP `/v1/logs` ingest; telemetry dashboard visibility | `lib/observe.ts` emitter with the verified Bearer contract; events for writer/carousels/content/approval/postiz/webhooks/mcp/api; no-op when unconfigured |
| H5 | **ChatGPT/OpenAI Actions remote validation** | OpenAI Actions config owner + deployed backend | Live MCP invocation from ChatGPT; manifest/spec acceptance | `POST /api/v1/mcp` JSON-RPC (16 tools), `openapi.json`, `.well-known/ai-plugin.json`, hash-only machine API keys; 28 local integration tests |

---

*Documentation-only update (2026-08-13). No production code, config, migration, or test was modified by this edition; all evidence above is captured from live command output and the working tree.*
