# Contributing to hiai-post

## Development Setup
1. Clone the repository
2. `bun install`
3. `cp .env.example .env`
4. `docker compose up -d`
5. `bun run db:push`
6. `bun run dev`

## Code Style
- ESM-only, Bun-native
- TypeScript strict mode
- Drizzle ORM (not raw SQL)
- Zod for validation
- Pino for logging

## Testing
- `bun test` for unit tests
- All PRs must pass CI

## Pull Requests
- Create feature branch from main
- Run `bunx tsc --noEmit` before submitting
- Include tests for new features
