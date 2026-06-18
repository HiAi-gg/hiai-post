# Changelog — hiai-post

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
