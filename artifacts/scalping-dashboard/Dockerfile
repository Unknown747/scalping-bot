FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/ ./lib/
COPY artifacts/scalping-dashboard/package.json ./artifacts/scalping-dashboard/

RUN pnpm install --frozen-lockfile --filter @workspace/scalping-dashboard --filter @workspace/api-client-react --filter @workspace/api-zod

COPY artifacts/scalping-dashboard/ ./artifacts/scalping-dashboard/

WORKDIR /app/artifacts/scalping-dashboard
RUN pnpm run build

# ── Runtime: nginx ────────────────────────────────────────────
FROM nginx:alpine AS runtime
COPY --from=build /app/artifacts/scalping-dashboard/dist /usr/share/nginx/html

# Rewrite all routes to index.html (SPA)
RUN printf 'server { \n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / { try_files $uri $uri/ /index.html; }\n\
  location /api/ { proxy_pass http://api:8080/api/; proxy_set_header Host $host; }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
