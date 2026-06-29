# Contributing to hiai-post

## Development Setup

### Prerequisites
- **Bun 1.3.14+** (required — do not use npm or yarn)
- **Docker + Docker Compose** (for PostgreSQL, Redis, MinIO)
- **Node.js** (not required for development, but `bunx` may use it for some tools)

### One-time Setup

```bash
# 1. Clone the repository
git clone https://github.com/HiAi-gg/hiai-post.git
cd hiai-post

# 2. Install dependencies (workspace root)
bun install

# 3. Copy environment file
cp .env.example .env

# 4. Edit .env with your configuration
#    - Generate TOKEN_ENCRYPTION_KEY: openssl rand -hex 32
#    - Generate BETTER_AUTH_SECRET: openssl rand -base64 32
#    - Fill in social platform API keys as needed

# 5. Start infrastructure services
docker compose up -d

# 6. Push database schema
bun run db:push

# 7. Start development servers
bun run dev
```

### Daily Development

```bash
# Start infrastructure (if not already running)
docker compose up -d

# Start API + frontend in parallel
bun run dev

# Or start individually
bun run dev:api       # API on port 50300
bun run dev:frontend  # Frontend on port 50301

# Run tests
bun test

# Typecheck
bun run typecheck

# Lint
bun run lint
```

---

## Code Style Conventions

### General
- **ESM-only** — all files use `import`/`export`, never `require()`
- **Bun-native** — do not use Node.js-specific APIs (`process.env` is ok, but prefer `Bun.env`)
- **TypeScript strict mode** — `strict: true` in tsconfig, no `any` unless absolutely necessary
- **No CommonJS** — do not use `module.exports`, `__dirname`, or `require()`

### Backend (Elysia)
- **Zod for validation** — all request bodies and query params must use Zod schemas
- **Elysia patterns** — use `.derive()` for middleware context, `.use()` for plugins
- **Error handling** — throw typed errors; the global error handler in `api/index.ts` catches and formats them
- **Route structure** — each route file exports an Elysia instance with a prefix
- **Middleware** — new middleware should extend `{ name: 'middleware-name' }` pattern

### Frontend (SvelteKit)
- **Svelte 5 runes** — use `$state()`, `$derived()`, `$effect()` instead of stores
- **Component props** — use `$props()` rune API
- **shadcn-svelte** — use shadcn components when available; extend via Tailwind classes
- **CSS** — Tailwind CSS v4, no plain CSS files unless necessary

### Database (Drizzle ORM)
- **No raw SQL** — always use Drizzle ORM query builder
- **Migrations** — use `drizzle-kit generate` to create migrations; review before committing
- **Schema** — every table must have `tenant_id` for multi-tenant isolation
- **Indexes** — add indexes for all foreign keys and frequently queried columns

### AI (Mastra)
- **Mastra workflows** — use `createStep()`/`createWorkflow()` pattern
- **Agents** — defined in `src/mastra/agents/` with Zod output schemas
- **Tools** — add new tools in `src/mastra/tools/` with typed inputs/outputs

### Naming Conventions
- **Files:** `kebab-case.ts` (e.g., `platform-rules.ts`, `content-generate.ts`)
- **Classes/Functions:** `camelCase` (e.g., `getPlatformRule()`, `validateContent()`)
- **Types/Interfaces:** `PascalCase` (e.g., `PlatformRule`, `AuthUser`)
- **Constants:** `UPPER_SNAKE_CASE` (e.g., `DEFAULT_CONFIGS`, `HEARTBEAT_INTERVAL`)
- **Database columns:** `snake_case` (e.g., `content_text`, `post_analytics`)

---

## Testing Requirements

### Test Framework
- Use `bun test` (Bun's built-in test runner, compatible with Jest/Vitest patterns)
- Tests live alongside source files (e.g., `src/db/__tests__/`)

### Test Coverage
- **Unit tests** for all utility functions in `src/lib/`
- **Integration tests** for all API routes (test CRUD + auth + tenant isolation)
- **Database tests** for query correctness and tenant isolation
- **Workflow tests** (optional but encouraged) for Mastra workflows

### Test Patterns

```typescript
// Unit test example
import { describe, expect, it } from 'bun:test';
import { validateContent } from '../platform-rules.js';

describe('validateContent', () => {
  it('should reject content exceeding max length', () => {
    const result = validateContent('x-post', 'a'.repeat(281));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(/exceeds max length/);
  });
});
```

```typescript
// Integration test example
describe('POST /api/v1/posts', () => {
  it('should require auth', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/v1/posts', { method: 'POST' })
    );
    expect(res.status).toBe(401);
  });

  it('should enforce tenant isolation', async () => {
    // Create post under tenant A
    // Verify tenant B cannot access it
  });
});
```

### Running Tests

```bash
bun test                    # Run all tests
bun test src/lib/__tests__/ # Run specific directory
bun test --coverage         # Run with coverage
```

### Pre-submission Checklist
- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes
- [ ] `bun test` passes
- [ ] New code has tests (unit for utils, integration for routes)
- [ ] No `console.log` — use `logger` from `src/lib/logger.ts`
- [ ] No `any` type annotations unless unavoidable

---

## Branching Model

```
main          ← Production-ready, protected branch
  └── feat/*  ← Feature branches (e.g., feat/instagram-reels)
  └── fix/*   ← Bug fix branches (e.g., fix/oauth-refresh)
  └── chore/* ← Maintenance branches (e.g., chore/update-deps)
  └── docs/*  ← Documentation branches (e.g., docs/api-reference)
```

### Branch Rules
- Create feature branches from `main`
- Keep branches short-lived (merge within a few days)
- Rebase onto `main` before merging
- No direct pushes to `main` — use pull requests

---

## Pull Request Process

1. **Create a feature branch** from `main`
2. **Make your changes** with clear, atomic commits
3. **Run the pre-submission checklist** (see above)
4. **Open a pull request** against `main`
5. **Describe your changes** — include motivation, approach, and testing done
6. **Wait for CI checks** — lint, typecheck, test, and build must pass
7. **Address review feedback** — make requested changes and push
8. **Merge** — squash-merge into main with a clean commit message

### PR Title Format
```
<type>(<scope>): <brief description>
```

Examples:
```
feat(posts): add Instagram Reel publishing support
fix(auth): handle expired OAuth tokens gracefully
chore(deps): update Drizzle ORM to 0.45.2
docs(api): add YouTube upload endpoint documentation
```

---

## Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types
| Type | Usage |
|------|-------|
| `feat` | New feature |
| `fix` | Bug fix |
| `chore` | Maintenance, deps, config |
| `docs` | Documentation only |
| `refactor` | Code change with no behavior change |
| `test` | Adding or updating tests |
| `perf` | Performance improvement |
| `style` | Formatting, linting only |
| `ci` | CI/CD configuration |

### Examples
```
feat(posts): add carousel support for Instagram publishing
fix(oauth): handle token refresh race condition
chore(deps): update @elysiajs/cors to 1.4.0
docs(readme): update API endpoint table
refactor(scheduler): extract retry logic to separate module
```

---

## Project Structure Overview

```
hiai-post/
  backend/              # Elysia API (Bun)
    src/
      api/              # HTTP routes, middleware, validation
      core/             # Business logic
      db/               # Drizzle ORM
      integrations/     # Platform API clients
      mastra/           # AI workflows
      lib/              # Shared utilities
      workers/          # Background workers
  app/                  # SvelteKit frontend
  packages/             # Shared workspace packages
  docs/                 # Documentation
```

---

## Additional Resources

- [Architecture Overview](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [Platform Rules](docs/PLATFORM_RULES.md)
- [AGENTS.md](AGENTS.md) — operational instructions for AI agents
- [Docker Compose](docker-compose.yml) — local development infrastructure
