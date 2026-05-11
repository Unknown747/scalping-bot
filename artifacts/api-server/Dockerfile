FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Copy workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/ ./lib/
COPY artifacts/api-server/package.json ./artifacts/api-server/

# Install deps (production only)
RUN pnpm install --frozen-lockfile --filter @workspace/api-server --filter @workspace/api-zod

# Copy source
COPY artifacts/api-server/ ./artifacts/api-server/

# Build
WORKDIR /app/artifacts/api-server
RUN node ./build.mjs

# ── Runtime ──────────────────────────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /app

COPY --from=base /app/artifacts/api-server/dist ./dist
COPY --from=base /app/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=base /app/artifacts/api-server/node_modules ./node_modules

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
