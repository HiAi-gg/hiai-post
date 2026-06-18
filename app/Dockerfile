FROM oven/bun:1.3.14 AS builder
WORKDIR /repo

COPY package.json bun.lock* ./
COPY packages/hiai-ui/package.json ./packages/hiai-ui/package.json
COPY projects/hiai-post/app/package.json ./projects/hiai-post/app/package.json
COPY projects/hiai-post/app/bun.lock* ./projects/hiai-post/app/

RUN bun install

COPY projects/hiai-post/app/ ./projects/hiai-post/app/
COPY packages/hiai-ui/ ./packages/hiai-ui/

WORKDIR /repo/projects/hiai-post/app
RUN bun run build

FROM oven/bun:1.3.14-alpine
WORKDIR /app
COPY --from=builder /repo/projects/hiai-post/app/build ./build
COPY --from=builder /repo/projects/hiai-post/app/package.json ./
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages/hiai-ui ./packages/hiai-ui
COPY --from=builder /repo/package.json ./package.json
EXPOSE 3000
CMD ["bun", "run", "build/index.js"]
