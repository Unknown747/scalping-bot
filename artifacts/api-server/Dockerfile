FROM node:24-bookworm-slim
RUN corepack enable && corepack prepare pnpm@latest --activate

# Build tools for better-sqlite3 native compilation (included in bookworm-slim)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/

RUN pnpm install --frozen-lockfile --filter @workspace/api-server...

RUN node artifacts/api-server/build.mjs

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
