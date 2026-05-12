#!/bin/bash
set -e

echo ""
echo "=== [1/6] Reset lockfile lokal ==="
git checkout pnpm-lock.yaml

echo ""
echo "=== [2/6] Git pull ==="
git pull

echo ""
echo "=== [3/6] Install dependencies ==="
pnpm install

echo ""
echo "=== [4/6] Build API server ==="
pnpm --filter @workspace/api-server run build

echo ""
echo "=== [5/6] Build dashboard ==="
pnpm --filter @workspace/scalping-dashboard run build

echo ""
echo "=== [6/6] Reload PM2 ==="
pm2 reload ecosystem.config.cjs --update-env

echo ""
echo "=== SELESAI ==="
pm2 status
