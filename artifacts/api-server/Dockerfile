FROM node:24-bookworm-slim

# Install pnpm directly (lebih reliable di Docker daripada corepack)
RUN npm install -g pnpm@9

# Build tools for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/

# --ignore-scripts: skip preinstall guard (hanya untuk dev environment)
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @workspace/api-server...

# Build setelah install selesai
RUN node artifacts/api-server/build.mjs

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
