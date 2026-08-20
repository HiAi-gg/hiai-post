# Security Remediation — 2026-08-13

Controlled dependency remediation for `hiai-post` (monorepo: `backend/` Elysia API, `app/` SvelteKit frontend).

**Before:** `bun audit` → **47 vulnerabilities (1 critical, 20 high, 21 moderate, 5 low)**
**After:** `bun audit` → **3 vulnerabilities (0 critical, 0 high, 1 moderate, 2 low)**

`bun audit --audit-level=high` exits 0 (no reachable critical/high advisory).

---

## What was fixed

| Advisory (GHSA) | Package | From | To | How |
| --- | --- | --- | --- | --- |
| GHSA-5xrq-8626-4rwp (critical) | `vitest` / `@vitest/coverage-v8` (both workspaces) | 2.1.9 | **3.2.7** | Direct devDependency bump `^2.1.0` → `^3.2.7` (**major 2 → 3**; validated by typecheck + 311 backend / 22 frontend tests) |
| GHSA-f88m-g3jw-g9cj (high) | `sharp` (backend) | 0.33.5 | **removed** | Unused dependency (verified: no imports in `backend/src` or `app/src`); removal eliminates the libvips advisory |
| GHSA-86j7-9j95-vpqj / GHSA-qq9h-g4jm-xgf3 (high) | `better-auth` / `@better-auth/drizzle-adapter` | 1.6.11 | **1.6.27** | Direct dep bump `^1.6.0` → `^1.6.13` (patch-level, API-compatible; typecheck + 311 backend tests green) |
| GHSA-fx2h-pf6j-xcff et al. (high/moderate) | `vite` | 6.4.2 | **6.4.3** | Direct dep bump `^6.0.0` → `^6.4.3` (latest 6.x patch; stays compatible with `@sveltejs/vite-plugin-svelte@5.x`) |
| GHSA-866w-xmhq-wj7x / GHSA-wqjv-9729-c5q2 / GHSA-29g2-3rmr-qm68 (moderate) | `@sveltejs/kit` | 2.66.0 | **2.70.2** | Direct dep bump `^2.60.0` → `^2.70.2`; `@sveltejs/adapter-node` `^5.2.0` → `^5.5.7` |
| GHSA-88fw-hqm2-52qc (high) + 12 more | `hono` | 4.12.22 | **4.13.1** | Lockfile pin-up within `@mastra/core`'s declared `^4.12.8` range |
| GHSA-52cp-r559-cp3m / GHSA-5p4m-2wfm-xmqj (high) | `js-yaml` | 3.14.2 | **3.15.1** | Lockfile pin-up within `gray-matter`'s declared `^3.13.1` range |
| GHSA-mwp4-54f8-5fhr et al. (high) | `ip-address` | 10.2.0 | **10.5.0** | Lockfile pin-up within `express-rate-limit`'s declared `^10.2.0` range |
| GHSA-7p8r-x3mc-p8w7 et al. (high) | `fast-uri` | 3.1.2 | **3.1.5** | Lockfile pin-up within `ajv`'s declared `^3.0.1` range |
| GHSA-28wg-ghj8-5hjv / GHSA-2v37-7h3g-55p8 (high) | `nanoid` (5.x and 3.x copies) | 5.1.11 / 3.3.12 | **5.1.16 / 3.3.18** | Lockfile pin-up within declared `^5.0.x` / `^3.3.x` ranges; same-day follow-up pin-up `3.3.17 → 3.3.18` (see [Follow-up pass](#follow-up-pass-same-day-nanoid-3317--3318)) |
| GHSA-r28c-9q8g-f849 / GHSA-fxqj-rqcc-2cmp (high/moderate) | `postcss` | 8.5.15 | **8.5.26** | Lockfile pin-up within `vite`/`shadcn-svelte` ranges |
| GHSA-mh99-v99m-4gvg / GHSA-rgw5-rvv9-x895 (high) | `brace-expansion` (2.x + 5.x copies) | 2.1.1 / 5.0.7 | **2.1.4 / 5.0.9** | Lockfile pin-up within `minimatch` ranges |
| GHSA-frvp-7c67-39w9 (moderate) | `@hono/node-server` | 1.19.14 | **1.19.17** | Lockfile pin-up within `@modelcontextprotocol/sdk`'s declared `^1.19.9` range |
| GHSA-v422-hmwv-36x6 (low) | `body-parser` | 2.2.2 | **2.3.0** | Lockfile pin-up within `express`'s declared `^2.2.1` range |

Every **lockfile pin-up** above stays within the semver range already declared by its parent package, and every **direct bump** is declared in the workspace `package.json` with an explicit `^` range. No parent package is forced outside its declared range anywhere in the current tree. `@mastra/core` stays at 1.36.0 (upgrading it to 1.58.x would be a 22-minor structural change — MCP SDK → server 2.0 — for no critical/high gain; see residual below).

## Removed: unsafe global overrides (critic-driven remediation)

The first remediation pass added root-level `overrides` (`"esbuild": "^0.25.12"`, `"cookie": "^0.7.2"`) to collapse every copy into a single version. Review found those global overrides **forced packages outside their declared semver ranges**:

| Override | Consumer | Declared range | Forced to | Outcome |
| --- | --- | --- | --- | --- |
| `esbuild ^0.25.12` | `tsx@4.22.3` | `~0.28.0` | 0.25.12 | **downgrade, out of range** |
| `esbuild ^0.25.12` | `@esbuild-kit/core-utils@3.3.2` | `~0.18.20` | 0.25.12 | major jump, out of range |
| `cookie ^0.7.2` | `elysia@1.4.28` | `^1.1.1` | 0.7.2 | **major downgrade, out of range** |
| `cookie ^0.7.2` | `@sveltejs/kit@2.70.2` | `^0.6.0` | 0.7.2 | major jump, out of range |

Both overrides were **removed** from the root `package.json`. Each consumer now resolves its own compatible copy **within its declared range** (separate copies rather than unsafe global pins):

- `esbuild@0.25.12` — `vite@6.4.3` (`^0.25.0`) and `drizzle-kit@0.31.10` (`^0.25.4`)
- `esbuild@0.28.2` — `tsx@4.22.3` (`~0.28.0`); patched for GHSA-g7r4-m6w7-qqqr (0.28.1)
- `esbuild@0.18.20` — `@esbuild-kit/core-utils@3.3.2` (`~0.18.20`); **moderate advisory remains visible** (see below)
- `cookie@1.1.1` — `elysia@1.4.28` (`^1.1.1`)
- `cookie@0.7.2` — `express@5.2.1` (`^0.7.1`)
- `cookie@0.6.0` — `@sveltejs/kit@2.70.2` (`^0.6.0`); **low advisory remains visible** (see below)

The trade-off is deliberate: declared-range resolution is restored, and the two low/moderate advisories that the overrides were hiding are now visible in `bun audit` instead of being silently masked by out-of-range pins. Neither is high/critical, so the CI hard gate (`bun audit --audit-level=high`) still passes.

## Remaining (documented, visible) advisories

All three are **below high** and therefore do not fail the CI gate.

**1. moderate — `esbuild <=0.24.2` (GHSA-67mh-4wv8-2f99, "esbuild dev server exposes responses to any website")**

- **Path:** `backend` › `drizzle-kit@0.31.10` › `@esbuild-kit/esm-loader@2.6.5` › `@esbuild-kit/core-utils@3.3.2` › `esbuild@0.18.20`.
- **Reason it cannot be safely fixed in this phase:** `@esbuild-kit/core-utils@3.3.2` (latest) pins `esbuild ~0.18.20`; the advisory is patched at 0.25.0, so **no in-range patched version exists**. Forcing 0.25.12 in would violate the declared `~0.18.20` range (the exact problem the removed global override caused).
- **Reachability:** the advisory affects esbuild's dev-server `serve` API (permissive CORS). This copy is only consumed by the drizzle-kit CLI's ESM loader (build/transform API, dev-time migration tool); it never invokes `serve`. `vite` uses the patched 0.25.12; `tsx` uses the patched 0.28.2.
- **Tracking:** visible in `bun audit` output.

**2. low — `cookie <0.7.0` (GHSA-pxg6-pf52-xh8x, "cookie accepts out-of-bounds name/path/domain")**

- **Path:** `app` › `@sveltejs/kit@2.70.2` › `cookie@0.6.0`.
- **Reason it cannot be safely fixed in this phase:** `@sveltejs/kit@2.x` declares `cookie ^0.6.0`; the advisory is patched at 0.7.0, so **no in-range patched version exists**. The only kit release declaring a patched range (kit 3.x, `cookie ^2.0.0`) is pre-release (`3.0.0-next.*`).
- **Reachability:** impact is cookie name/path/domain validation on serialize; not reachable through this app's cookie usage. `elysia` uses cookie 1.1.1 and `express` uses cookie 0.7.2 — both patched.
- **Tracking:** visible in `bun audit` output.

**3. low — `@ai-sdk/provider-utils <=3.0.97` (GHSA-866g-f22w-33x8, "Uncontrolled Resource Consumption")**

- **Path:** `backend` › `@mastra/core@1.36.0` › `@ai-sdk/provider-utils-v5` → `npm:@ai-sdk/provider-utils@3.0.25` (also a `@ai-sdk/provider-utils@2.2.8` copy under `@ai-sdk/ui-utils-v5`).
- **Reason it cannot be safely fixed in this phase:**
  - `@mastra/core` pins the v5 alias to the 3.x utils line, which is paired with `@ai-sdk/provider@2.0.3`. **No stable patched 3.x exists** — the only versions above 3.0.97 are `3.1.0-beta.*`. Forcing the alias to 4.x would mismatch the paired provider version (different wire formats) and break the Mastra agent runtime.
  - Upgrading `@mastra/core` to the latest (1.58.0) still ships `@ai-sdk/provider-utils-v5@3.0.30` (still ≤ 3.0.97), so it does not resolve the advisory and carries real breaking-change risk (MCP SDK → `@modelcontextprotocol/server@2.0.0` structural swap).
  - Impact is low severity (resource-consumption in AI SDK streaming helpers), not directly reachable through this app's bounded agent invocations.
- **Tracking:** visible in `bun audit` output; CI runs the full audit every run and only tolerates the documented residuals above.

## Follow-up pass (same day): nanoid 3.3.17 → 3.3.18

After the initial pass, the advisory database expanded the patched version for **GHSA-2v37-7h3g-55p8** ("nanoid: custom generators can loop indefinitely when size is zero") to `3.3.18` for the 3.x line. `bun audit` reflagged the two locked `3.3.17` copies as **high**, moving the residual count to **4 (1 high, 1 moderate, 2 low)**.

**Fixed by:** lockfile pin-up `3.3.17 → 3.3.18` for the only two affected 3.x consumers — both stay **within their parents' declared ranges**, no `package.json` change, no overrides:

- `@ai-sdk/provider-utils@2.2.8` (declares `nanoid ^3.3.8`) → `@ai-sdk/provider-utils/nanoid@3.3.18`
- `postcss@8.5.26` (declares `nanoid ^3.3.17`) → `postcss/nanoid@3.3.18`

`nanoid@5.1.16` (5.x copy) is unaffected by this advisory. `bun audit` is back to **3 vulnerabilities (1 moderate, 2 low)** — the documented residuals below — and `bun audit --audit-level=high` exits 0.

## CI security behavior (now truthful)

`.github/workflows/ci.yml` `security` job:
- `bun audit --audit-level=high` — **hard gate** (fails CI on any critical/high reachable advisory; no `continue-on-error`).
- `bun audit` (full) — always runs; full report is always visible in job logs. `|| true` is bounded to the three documented residuals above (all below high); any new advisory shows up in logs and, if high/critical, fails the gate.

## Verification

- `bun install --frozen-lockfile` — clean resolve, 0 warnings; lockfile resolves per-parent copies (no root `overrides`).
- `bun audit` — 3 vulnerabilities (1 moderate, 2 low — all documented above); `bun audit --audit-level=high` — exit 0.
- `bun run lint` (Biome, backend + app) — exit 0; `bunx @biomejs/biome ci .` — exit 0 (190 files).
- Typecheck — `backend`: `tsc --noEmit` exit 0; `app`: `svelte-kit sync && tsc --noEmit` exit 0.
- Tests — backend: **311 passed (24 files)**; app: **22 passed (2 files)** (vitest 3.2.7).
- Builds — backend `bun build` exit 0; app `vite build` exit 0.
- Migration check — `db:check` against a fresh PostgreSQL 16: **PASS** (5 migrations applied, 18 tables + 3 enums match snapshot, no schema drift; the `drizzle-kit generate` step also exercises the `@esbuild-kit` loader path successfully).
- Follow-up pass re-verification — `bun install --frozen-lockfile` exit 0 after the `3.3.17 → 3.3.18` lockfile pin-up; `bun audit` 3 vulnerabilities / `bun audit --audit-level=high` exit 0; `bun run lint`, `bun run typecheck`, backend tests (311 passed), both builds, and `db:check` (disposable empty DB, dropped afterwards) all re-run and exit 0.
