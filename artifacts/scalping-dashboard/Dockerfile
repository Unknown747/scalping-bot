FROM node:24-bookworm-slim AS build

# Install pnpm directly (lebih reliable di Docker daripada corepack)
RUN npm install -g pnpm@9

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY lib/ ./lib/
COPY artifacts/scalping-dashboard/package.json ./artifacts/scalping-dashboard/

# --ignore-scripts: skip preinstall guard (hanya untuk dev environment)
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @workspace/scalping-dashboard...

COPY artifacts/scalping-dashboard/ ./artifacts/scalping-dashboard/

WORKDIR /app/artifacts/scalping-dashboard

# PORT and BASE_PATH required by vite.config.ts at build time
ENV PORT=80
ENV BASE_PATH=/
RUN pnpm run build

FROM nginx:stable-alpine AS runtime
COPY --from=build /app/artifacts/scalping-dashboard/dist/public /usr/share/nginx/html

RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
\n\
  gzip on;\n\
  gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;\n\
  gzip_min_length 1024;\n\
\n\
  location /socket.io/ {\n\
    proxy_pass http://api:8080/socket.io/;\n\
    proxy_http_version 1.1;\n\
    proxy_set_header Upgrade $http_upgrade;\n\
    proxy_set_header Connection "upgrade";\n\
    proxy_set_header Host $host;\n\
    proxy_cache_bypass $http_upgrade;\n\
    proxy_read_timeout 86400;\n\
  }\n\
\n\
  location /api/ {\n\
    proxy_pass http://api:8080/api/;\n\
    proxy_set_header Host $host;\n\
    proxy_set_header X-Real-IP $remote_addr;\n\
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\
    proxy_set_header X-Forwarded-Proto $scheme;\n\
  }\n\
\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
