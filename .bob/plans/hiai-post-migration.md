# Plan: hiai-post Ecosystem Migration
**Objective:** Bring hiai-post to full HIAI_CONVENTIONS.md compliance, fix critical bugs, unify UI via @hiai/ui, and integrate as a module into hiai-admin with `comingSoon` removed.
**Phases:** 5 · **Total effort:** ~12–18h serial, ~3 days parallelized
**Effort key:** S = <1h · M = 2–4h · L = 1 day · XL = 2+ days

---

## Phase 0 — Critical Bug Fixes (parallel: 0.1, 0.2, 0.3, 0.4 — all independent)
_These fixes unblock all subsequent phases. None depend on each other — they touch disjoint files._

### [0.1] Fix Svelte 5 `class:/` syntax in 3 files → use `class={{}}` object syntax
- **Owner:** coder
- **Effort:** S (<1h) — 6 occurrences across 3 files
- **Parallel:** yes (disjoint frontend files, independent of backend/package work)
- **Deps:** none
- **Risk:** low — straightforward syntax change, no logic affected

**Files & changes:**

**A) `app/src/routes/campaigns/+page.svelte`** (lines 136–140)
- Replace the 5 `class:` directives with a single `class={{}}` object on the `<button>`:
```svelte
class={{
  'bg-yellow-500/10': campaign.status === 'active',
  'text-yellow-600': campaign.status === 'active',
  'bg-green-500/10': campaign.status === 'paused',
  'text-green-600': campaign.status === 'paused',
  'opacity-50': toggling[campaign.id],
}}
```

**B) `app/src/routes/campaigns/new/+page.svelte`** (lines 232, 273)
- Two occurrences of `class:bg-primary/5={...}` → replace each with `class={{ 'bg-primary/5': condition }}`

**C) `app/src/lib/components/PostEditor.svelte`** (lines 142, 157)
- `class:bg-red-500/10={over}` → `class={{ 'bg-red-500/10': over }}`
- `class:bg-primary/5={dragActive}` → `class={{ 'bg-primary/5': dragActive }}`

**Verification:** `cd app && bun run build` passes (no svelte parse errors)

---

### [0.2] Populate @hiai/ui package from hiai-store's working version
- **Owner:** coder
- **Effort:** M (2–3h) — copy 13 files, create tokens.css, update index.ts + package.json
- **Parallel:** yes (isolated to `packages/ui/`, independent of app/backend)
- **Deps:** none
- **Risk:** medium — need to ensure version compatibility and correct exports

**Files to create/copy from `/mnt/ai_data/projects/hiai-store/packages/ui/`:**

```
packages/ui/
├── index.ts                   # UPDATE: barrel exports (see below)
├── package.json               # UPDATE: version + peer deps + scripts
├── tsconfig.json              # COPY from hiai-store
├── src/
│   ├── api.ts                 # COPY — createApi HTTP client
│   ├── types.ts               # COPY — NavItem, NavGroup, User, AuthState, etc.
│   ├── svelte-runes.d.ts      # COPY — Svelte 5 rune declarations
│   ├── styles/
│   │   └── tokens.css         # CREATE NEW — canonical tokens (see 0.2a below)
│   ├── stores/
│   │   ├── auth.svelte.ts     # COPY — authStore
│   │   ├── sidebar.svelte.ts  # COPY — sidebarStore
│   │   └── theme.svelte.ts    # COPY — themeStore
│   └── components/
│       ├── AdminSidebar.svelte     # COPY
│       ├── AdminHeader.svelte      # COPY
│       ├── ThemeToggle.svelte      # COPY
│       ├── StatsCard.svelte        # COPY
│       └── StatusBadge.svelte      # COPY
```

**Sub-task [0.2a]: Create `packages/ui/src/styles/tokens.css`** with canonical palette from HIAI_CONVENTIONS.md §4.1:
```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0.013 285.82);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0.013 285.82);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0.013 285.82);
  --primary: oklch(0.205 0.042 265.76);
  --primary-foreground: oklch(0.985 0.002 247.86);
  --secondary: oklch(0.97 0.004 264.54);
  --secondary-foreground: oklch(0.205 0.042 265.76);
  --muted: oklch(0.97 0.004 264.54);
  --muted-foreground: oklch(0.556 0.019 270.87);
  --accent: oklch(0.97 0.004 264.54);
  --accent-foreground: oklch(0.205 0.042 265.76);
  --destructive: oklch(0.577 0.245 27.33);
  --border: oklch(0.922 0.007 264.54);
  --input: oklch(0.922 0.007 264.54);
  --ring: oklch(0.708 0.165 254.62);
  --radius: 0.625rem;
}
.dark {
  --background: oklch(0.145 0.013 264.54);
  --foreground: oklch(0.985 0.002 247.86);
  --card: oklch(0.205 0.042 265.76);
  --card-foreground: oklch(0.985 0.002 247.86);
  --popover: oklch(0.205 0.042 265.76);
  --popover-foreground: oklch(0.985 0.002 247.86);
  --primary: oklch(0.922 0.007 264.54);
  --primary-foreground: oklch(0.205 0.042 265.76);
  --secondary: oklch(0.269 0.027 265.52);
  --secondary-foreground: oklch(0.985 0.002 247.86);
  --muted: oklch(0.269 0.027 265.52);
  --muted-foreground: oklch(0.708 0.165 254.62);
  --accent: oklch(0.269 0.027 265.52);
  --accent-foreground: oklch(0.985 0.002 247.86);
  --destructive: oklch(0.704 0.191 22.22);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0.019 270.87);
}
```

**Update `packages/ui/index.ts`** to export all modules:
```ts
export { AdminSidebar } from './src/components/AdminSidebar.svelte';
export { AdminHeader } from './src/components/AdminHeader.svelte';
export { ThemeToggle } from './src/components/ThemeToggle.svelte';
export { StatsCard } from './src/components/StatsCard.svelte';
export { StatusBadge } from './src/components/StatusBadge.svelte';
export { authStore } from './src/stores/auth.svelte';
export { sidebarStore } from './src/stores/sidebar.svelte';
export { themeStore } from './src/stores/theme.svelte';
export { createApi, ApiClient, ApiRequestError, ApiError } from './src/api';
export type { User, AuthState, NavGroup, NavItem, StatusKind, DashboardTrend, ApiMode } from './src/types';
```

**Update `packages/ui/package.json`:**
- version: `"0.0.0"` → `"1.0.0"`
- add `"exports"` subpaths for `./styles/tokens.css`, `./types`, `./api`, `./components/*`, `./stores/*`
- add peer dep: `"svelte": "^5.55.0"`

**Verification:** `cd packages/ui && bun tsc --noEmit` passes (if tsconfig exists); all exports resolve

---

### [0.3] Fix encrypted token bug in collector.ts + aggregator.ts
- **Owner:** coder
- **Effort:** S (<1h) — add import + decryptToken wraps at 6 call sites in 2 files
- **Parallel:** yes (backend-only, independent of frontend/ui)
- **Deps:** none
- **Risk:** medium — analytics code is untested, must not break existing publisher flow

**File: `backend/src/core/analytics/collector.ts`**

1. Add import at top: `import { decryptToken } from '../../lib/encryption.js';`
2. At lines ~196–206, wrap `account.accessTokenEncrypted` with `decryptToken()` before every platform call:
```ts
const token = decryptToken(account.accessTokenEncrypted);
// Then pass `token` instead of `account.accessTokenEncrypted`:
metrics = await fetchInstagramMetrics(post.platformPostId, token);
metrics = await fetchXMetrics(post.platformPostId, token);
metrics = await fetchLinkedInMetrics(post.platformPostId, token);
```

**File: `backend/src/core/analytics/aggregator.ts`**

1. Add import: `import { decryptToken } from '../../lib/encryption.js';`
2. At lines ~343–375, decrypt before passing:
```ts
const token = decryptToken(account.accessTokenEncrypted);
// Then pass `token` instead of `account.accessTokenEncrypted`:
const result = await fetchInstagramInsights(post.platformPostId, token);
const result = await fetchXAnalytics(post.platformPostId, token);
const result = await fetchLinkedInAnalytics(post.platformPostId, token);
```

**ALSO FIX — Bug B5**: In `collector.ts`, find `twitter.com` references and replace with `x.com` (Twitter was rebranded to X; the integration module `backend/src/integrations/x/client.ts` already uses x.com endpoints, but collector may have stale references).

**Verification:** Existing `encryption.test.ts` ensures encrypt/decrypt round-trip works; verify no type errors via `cd backend && bun tsc --noEmit`

---

### [0.4] Generate initial Drizzle migrations
- **Owner:** coder
- **Effort:** S (<1h) — run drizzle-kit generate, verify SQL output
- **Parallel:** yes (backend-only, independent of all other tasks)
- **Deps:** none
- **Risk:** medium — must ensure drizzle-kit is configured correctly with PostgreSQL dialect

**Steps:**
1. Verify `backend/drizzle.config.ts` points to correct schema output: `out: './src/db/migrations'`
2. Run: `cd backend && bun run db generate --name initial_schema`
3. Verify migration SQL file is created in `backend/src/db/migrations/`
4. Verify the SQL is valid PostgreSQL DDL (check table definitions, indexes, relations)

**Verification:** `cd backend && bun run db push` applies migrations; PostgreSQL schema matches `schema.ts`

---

## Phase 1 — Frontend Import Fixes & @hiai/ui Connection (serial: 1.1→1.2→1.3, deps on Phase 0.2)
_All tasks in this phase depend on @hiai/ui being populated (0.2). They fix imports so build passes._

### [1.1] Fix broken @hiai/ui import in PostEditor.svelte
- **Owner:** coder
- **Effort:** S (<30min) — one line change
- **Parallel:** no (deps on 0.2 — @hiai/ui must exist; and must complete before 1.2 for full build)
- **Deps:** Phase 0.2
- **Risk:** low

**File:** `app/src/lib/components/PostEditor.svelte` (line ~3)
- Change: `import { TipexEditor } from '@hiai/ui'`
- To: `import TipexEditor from './editor/TipexEditor.svelte'`
- (TipexEditor is a local component, not a shared UI primitive — it should stay local)

### [1.2] Fix auth.svelte.ts and +layout.svelte imports (now @hiai/ui exists)
- **Owner:** coder
- **Effort:** S (<30min) — verify type compatibility, no code changes needed
- **Parallel:** no (deps on 0.2 + 1.1; these must all resolve for build)
- **Deps:** Phase 0.2, Task 1.1
- **Risk:** low

**File:** `app/src/lib/stores/auth.svelte.ts` — `export { authStore } from '@hiai/ui'` now resolves
**File:** `app/src/routes/+layout.svelte` — `import { AdminSidebar, AdminHeader, ThemeToggle, sidebarStore } from '@hiai/ui'` now resolves
**File:** `app/src/lib/api.ts` — `import { createApi } from '@hiai/ui'` now resolves

No code changes needed (imports were correct, package was just empty). But verify no type mismatches between app usage and @hiai/ui types.

### [1.3] Verify frontend build passes
- **Owner:** coder
- **Effort:** S (<30min) — one command
- **Parallel:** no (deps on 1.1, 1.2)
- **Deps:** Tasks 1.1, 1.2
- **Verification:** `cd app && bun run build` → 0 errors, output in `app/build/`

---

## Phase 2 — UI Unification (parallel: 2.1, 2.2, 2.3; deps on Phase 1)
_Replace local tokens, components, and emojis with @hiai/ui canonical equivalents._

### [2.1] Replace app.css theme with @hiai/ui tokens.css import
- **Owner:** coder
- **Effort:** S (<1h) — remove @theme block, add import
- **Parallel:** yes (independent of component replacement — just CSS)
- **Deps:** Phase 0.2 (tokens.css exists)
- **Risk:** medium — visual regression possible; verify with screenshot diff

**File:** `app/src/app.css`
1. Keep `@import "tailwindcss";`
2. Add: `@import "@hiai/ui/styles/tokens.css";` (after tailwind import)
3. Remove the entire `@theme { ... }` block (lines 3–21) — tokens come from @hiai/ui now
4. Remove the `@media (prefers-color-scheme: dark)` block (lines 23–35) — dark tokens in @hiai/ui
5. Keep body styles and reduced-motion (lines 37–51)

**Verification:** Run `cd app && bun run dev` and visually confirm colors match the canonical slate palette

### [2.2] Replace local stat card/badge patterns with @hiai/ui Components
- **Owner:** coder
- **Effort:** M (1–2h) — need to understand StatsCard/StatusBadge prop interfaces
- **Parallel:** yes (independent of 2.1, disjoint files from 2.3)
- **Deps:** Phase 1 (imports resolve)
- **Risk:** medium — StatsCard/StatusBadge props may differ slightly

**File:** `app/src/routes/dashboard/+page.svelte`
- Import: `import { StatsCard, StatusBadge } from '@hiai/ui'`
- Replace inline stat card divs with `<StatsCard>` (match prop interface)
- Replace inline status indicators with `<StatusBadge kind="...">`

**Verification:** Dashboard page renders with StatsCard/StatusBadge from @hiai/ui

### [2.3] Replace emoji icons with lucide-svelte in nav/plugin
- **Owner:** coder
- **Effort:** S (<30min) — rename icon strings
- **Parallel:** yes (independent of 2.1/2.2)
- **Deps:** Phase 1
- **Risk:** low — cosmetic change only

**File:** `app/src/lib/plugin.ts` (nav item icons)
- Replace emoji icons with lucide-svelte icon names:
  - `📊` → `'BarChart3'`, `👤` → `'User'`, `📝` → `'FileText'`
  - `📢` → `'Megaphone'`, `📋` → `'ClipboardList'`, `📄` → `'File'`
  - `📈` → `'TrendingUp'`

**Verification:** Plugin.ts typechecks; nav renders with lucide icons in dev mode

---

## Phase 3 — Backend Conventions Alignment (parallel: 3.1, 3.2, 3.3, 3.4; none depend on each other)
_Tasks touch disjoint backend files — all independent._

### [3.1] Add root-level health check endpoint for SiteAdapter compatibility
- **Owner:** coder
- **Effort:** S (<30min) — add one route definition
- **Parallel:** yes (new route, no file conflicts)
- **Deps:** none
- **Risk:** low — additive

**File:** `backend/src/api/routes/health.ts`
- Add a second route at `GET /health` (current is `GET /api/v1/health`):
```ts
.get('/health', async ({ set }) => {
  const dbOk = await checkDbHealth();
  const redisOk = await checkRedisHealth();
  const status = dbOk && redisOk ? 'ok' : 'degraded';
  if (status !== 'ok') set.status = 503;
  return { status, db: dbOk ? 'connected' : 'disconnected', redis: redisOk ? 'connected' : 'disconnected', timestamp: new Date().toISOString() };
})
```
- This matches the expected response format (`{ status, db, redis }`) for SiteAdapter's `checkHealth()`

**Verification:** `curl http://localhost:50300/health` returns `{"status":"ok","db":"connected","redis":"connected",...}`

### [3.2] Verify lib/config.ts uses Zod for all env vars
- **Owner:** coder
- **Effort:** S (<1h) — audit, possible minor refactoring
- **Parallel:** yes (audit-only, no changes unless violations found)
- **Deps:** none
- **Risk:** low

**File:** `backend/src/lib/config.ts`
- Verify ALL `process.env.X` reads go through Zod schema (no raw `process.env` in service code)
- The file already uses Zod — verify completeness against `.env.example` vars (48 vars)
- If any env vars are read raw in other files, refactor them into config.ts

**Verification:** Grep for `process.env` in `backend/src/` (excluding config.ts); count should be 0

### [3.3] Investigate & fix 7 failing tests (51/58 → 58/58)
- **Owner:** coder
- **Effort:** M (1–3h) — depends on root causes
- **Parallel:** yes (independent of other backend tasks)
- **Deps:** none
- **Risk:** medium — may reveal underlying bugs

**Steps:**
1. Run: `cd backend && bun test` to see which 7 tests fail
2. Investigate each failure's root cause (likely: missing test setup, API contract drift, or undefined mocks)
3. Fix each test (no logic changes to production code unless tests reveal real bugs)

**Verification:** `cd backend && bun test` → all 58 pass

**Note:** Conventions §1 mandate Vitest; current tests use `bun:test`. Migration to Vitest should be tracked as a separate task unless 7 fixes are trivial. If all 7 are trivially fixable with bun:test, fix them; if complex, document known failures for Vitest migration round.

### [3.4] Ensure backend typecheck passes
- **Owner:** coder
- **Effort:** S (<30min) — one command
- **Parallel:** depends on 0.3 (encrypted token fix changes types potentially)
- **Deps:** Task 0.3
- **Verification:** `cd backend && bun tsc --noEmit` → 0 errors

---

## Phase 4 — hiai-admin Integration (serial: 4.1→4.2; deps on Phases 0–3 complete)
_These tasks are in the hiai-admin repo, not hiai-post. hiai-post must be stable first._

### [4.1] Update hiai-admin plugin manifest
- **Owner:** coder
- **Effort:** S (<1h) — remove comingSoon flags, update version
- **Parallel:** no (single file, must be consistent)
- **Deps:** Phase 0 (bugs fixed), Phase 1 (frontend builds), Phase 2 (UI unified)
- **Files:** `/mnt/ai_data/projects/hiai-admin/app/src/lib/plugins/hiai-post.ts`
- **Risk:** medium — must match hiai-post's actual routes

**Changes:**
1. Remove `comingSoon: true` from all 7 nav items (Dashboard, Accounts, Posts, Campaigns, Content Plans, Templates, Analytics)
2. Remove `disabled` flags if present
3. Add `pages?: PluginPage[]` array with native Svelte component references — but note: in the proxy model, pages render from hiai-post's own SvelteKit app via iframe or proxy, so `pages` may be optional if using the proxy-only approach. Clarify which model is used.
4. Update `version: '0.0.0'` → `'1.0.0'`
5. Update `description` to remove "(coming soon)"
6. Ensure `proxy.prefix` = `/api/social` and `proxy.target` = `http://localhost:50300` (matches hiai-post's health endpoint)

### [4.2] Per-tenant scope via SiteAdapter/plugin proxy
- **Owner:** coder
- **Effort:** M (2–3h) — verify/update proxy, tenant isolation, header forwarding
- **Parallel:** no (deps on 4.1)
- **Deps:** Task 4.1, Phase 3 (health endpoint exists)
- **Risk:** medium — requires coordination between hiai-post and hiai-admin auth

**Backend task (hiai-post side):**
- Verify middleware/tenant.ts extracts `X-Tenant-Id` header from proxied requests
- Verify all routes filter by `tenantId` (data isolation per §5)
- Add `modules: ['social']` to SiteAdapter config when registering hiai-post

**Admin task (hiai-admin side):**
- Verify `proxy-post.ts` forwards `x-tenant-id` header along with `authorization` and `content-type`
- Verify `proxy-post.ts` forwards `cookie` header (required by §6)
- Add `social` to module allowlist in SiteAdapter config

**Verification:** When a tenant admin logs into hiai-admin: social media menu items visible; proxy routes show per-tenant data

---

## Phase 5 — Final Verification (serial: 5.1→5.2→5.3; gates everything)
_Final quality gates before considering the project "done."_

### [5.1] Run full CI pipeline
- **Owner:** coder
- **Effort:** S (<1h) — run commands, fix any remaining issues
- **Parallel:** no (sequential CI jobs)
- **Deps:** All prior phases
- **Verification:**
  - `cd backend && bun lint` → 0 errors
  - `cd backend && bun typecheck` → 0 errors
  - `cd backend && bun test` → all pass
  - `cd app && bun lint` → 0 errors
  - `cd app && bun typecheck` → 0 errors
  - `cd app && bun run build` → successful build output

### [5.2] Conventions checklist verification
- **Owner:** critic (or strategist review)
- **Effort:** S (<1h) — audit against checklist
- **Parallel:** no (audit review)
- **Deps:** Task 5.1
- **Check each item from HIAI_CONVENTIONS.md §8:**
  - [ ] Stack from §1 (Elysia, Drizzle, Zod, PostgreSQL, Redis, Svelte 5/SvelteKit, shadcn-svelte, TanStack, LayerChart, Better Auth, Biome) — no React/Next
  - [ ] Structure from §2 (backend/ + app/, thin routes + services)
  - [ ] env only via lib/config.ts (Zod)
  - [ ] Import tokens/components from @hiai/ui, no local :root{} tokens
  - [ ] Port registered in §3 (50300)
  - [ ] Auth/RBAC/audit per §5 (⚠️ RBAC roles + audit middleware deferred → F4)
  - [ ] Plugin manifest per §6 (in hiai-admin, comingSoon removed)
  - [ ] CI green (§7), documents on place (README, AGENTS, todo, SECURITY, CHANGELOG)

### [5.3] Update todo.md and documentation
- **Owner:** writer
- **Parallel:** no (deps on 5.2 review)
- **Deps:** Task 5.2
- **File:** `todo.md` — mark Phase 0 as done, update Phase 1–3 status
- **File:** `CHANGELOG.md` — add v1.0.0 entry documenting migration changes
- **File:** `AGENTS.md` — update if conventions changed how agents should work

---

## Execution Graph — Visual Summary

```
Phase 0 (parallel — all independent)
  ├── [0.1] Svelte class:/ fix  ──────────────────────┐
  ├── [0.2] @hiai/ui population ──┐                    │
  ├── [0.3] Encrypted token fix   │                    │
  └── [0.4] Drizzle migrations    │                    │
                                  ▼                    │
Phase 1 (serial chain, deps on 0.2)                   │
  ├── [1.1] Fix PostEditor import ──► [1.2] Fix auth/layout
  └── [1.3] Verify build passes ◄── (deps on 1.1+1.2) │
                                  │                    │
Phase 2 (parallel, deps on Phase 1) ◄──────────────────┘
  ├── [2.1] Replace app.css with tokens.css
  ├── [2.2] Replace local cards/badges
  └── [2.3] Replace emoji → lucide icons
                                  │
Phase 3 (parallel, all independent) ◄── deps on 0.3 (typecheck)
  ├── [3.1] Add /health endpoint
  ├── [3.2] Verify config.ts Zod coverage
  ├── [3.3] Fix 7 failing tests
  └── [3.4] Backend typecheck
                                  │
Phase 4 (serial, deps on ALL above)
  ├── [4.1] Update hiai-admin manifest
  └── [4.2] Per-tenant scope
                                  │
Phase 5 (serial final gates)
  ├── [5.1] CI pipeline
  ├── [5.2] Conventions checklist
  └── [5.3] Documentation update
```

**Parallelization summary:**
- Phase 0: 4 tasks in parallel (max fan-out)
- Phase 1: 3 tasks serial
- Phase 2: 3 tasks in parallel
- Phase 3: 4 tasks in parallel (max fan-out)
- Phase 4: 2 tasks serial
- Phase 5: 3 tasks serial

---

## Risk Register

| ID | Risk | Probability | Impact | Mitigation |
|----|------|------------|--------|------------|
| R1 | @hiai/ui components have prop mismatches with app usage | Medium | Medium | Test each import; add type-check step after Phase 1 |
| R2 | tokens.css canonical palette causes visual regression | High | Low | Screenshot diff review; rollback to app.css backup if needed |
| R3 | Encrypted token fix reveals downstream auth issues in analytics | Low | High | Reviewer tests in prod-like env with real tokens |
| R4 | Drizzle migrations conflict with existing DB state | Low | Medium | Backup DB before `db push`; test on fresh DB first |
| R5 | 7 failing tests hide real production bugs | Medium | High | Fix tests before any feature work; investigate each root cause |
| R6 | hiai-admin proxy doesn't forward cookies (required by §6) | Medium | Medium | Test proxy with `curl -v`; verify cookie header propagation |
| R7 | Vitest migration (bun:test→vitest) is out of scope but §1 mandates it | High | Medium | Defer to separate task; don't block this migration on it |

---

## Definition of Done per Phase

- **Phase 0 Done:** `app/` builds without svelte errors; `@hiai/ui` exports all components/stores/api; collector/aggregator decrypt tokens; migrations generated
- **Phase 1 Done:** `cd app && bun run build` exits 0; all @hiai/ui imports resolve
- **Phase 2 Done:** `app/src/app.css` imports tokens.css; dashboard uses StatsCard/StatusBadge; nav uses lucide icons
- **Phase 3 Done:** `curl :50300/health` returns `{status:"ok",db:"connected",redis:"connected"}`; all 58 tests pass; no raw `process.env` outside config.ts
- **Phase 4 Done:** hiai-admin nav shows Social Media items without `comingSoon` banner; proxy routes return per-tenant data
- **Phase 5 Done:** CI green; conventions checklist all checked; todo.md/CHANGELOG.md updated

---

## Deferred / Future Tasks (not in this migration)

### [F1] Extract TipexEditor + EditorToolbar to @hiai/ui
- HIAI_CONVENTIONS.md §4.2 explicitly lists `editor/TipexEditor` and `editor/EditorToolbar` as @hiai/ui components. Currently they live in `app/src/lib/components/editor/` and are imported locally (fixed in 1.1). Extract them to `packages/ui/src/components/editor/` in a follow-up.
  - Must ensure the TipTap/svelte-tiptap dependency is either a peer dep of @hiai/ui or properly re-exported.

### [F2] Migrate from bun:test to Vitest
- HIAI_CONVENTIONS.md §1 mandates Vitest as the single test framework ("bun:test выводится из обихода"). Current tests use `bun:test`. This is a ~1-day migration touching test files and CI config. Tracked separately to avoid blocking this migration.

### [F3] Add DataTable (TanStack) + LayerChart
- Conventions §1 require TanStack Table and LayerChart for tables/charts. Current analytics uses a custom `AnalyticsChart.svelte` component. Migrate analytics views to LayerChart and listing pages to DataTable in a follow-up.

### [F4] Add RBAC roles + audit middleware per §5
- HIAI_CONVENTIONS.md §5 requires: roles (`super_admin`, `tenant_admin`, `staff`), RBAC matrix, and audit middleware (actor, action, resource, ip) for all state-changing operations.
- Current state: `audit_logs` table exists in schema, but no `src/api/middleware/audit.ts` middleware is implemented. No RBAC role enforcement in routes.
- This is a significant security feature (~1 day) — scope it as a separate task.

### [F5] Upgrade from bun:test to Vitest (§1 mandate)
- Same as F2 above. Listed twice for searchability. Full Vitest migration including CI config update.

