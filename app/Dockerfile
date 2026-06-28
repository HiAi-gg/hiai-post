FROM oven/bun:1.3.14 AS builder
WORKDIR /app

# ── Phase 1 — install ────────────────────────────────────
# Copy manifest only (NOT full source) so bun install is clean
COPY app/package.json app/bun.lock* ./

# packages/ is a symlink -> /mnt/ai_data/packages/ outside the Docker build
# context, so we use the additional_context (packages_host) from compose.
COPY --from=packages_host hiai-ui/ /app/packages/hiai-ui/

# Rewrite @hiai/ui from workspace:* to file: so bun resolves it locally
RUN node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8'));if(p.dependencies&&p.dependencies['@hiai/ui']==='workspace:*'){p.dependencies['@hiai/ui']='file:packages/hiai-ui';}require('fs').writeFileSync('package.json',JSON.stringify(p,null,2));"

RUN bun install

# ── Phase 2 — build ──────────────────────────────────────
# Copy source + configs.  node_modules/ was already installed in phase 1
# and must NOT be copied (host symlinks confuse Docker COPY).
COPY app/src ./src
COPY app/static ./static
COPY app/vite.config.ts app/svelte.config.js app/tsconfig.json ./
COPY app/.svelte-kit ./.svelte-kit
RUN bun run build

# ── Runtime ──────────────────────────────────────────────
FROM oven/bun:1.3.14-alpine
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["bun", "run", "build/index.js"]
