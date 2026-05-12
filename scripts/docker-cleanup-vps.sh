#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Hapus semua Docker dari VPS (container, image, volume, network, dan Docker itu sendiri)
# Jalankan di VPS: bash scripts/docker-cleanup-vps.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

echo "=== Membersihkan semua Docker ==="

# Stop container yang sedang jalan
echo "[1/6] Stop semua container yang berjalan..."
docker compose down --remove-orphans 2>/dev/null || true
docker stop $(docker ps -aq) 2>/dev/null || echo "  (tidak ada container aktif)"

# Hapus semua container
echo "[2/6] Hapus semua container..."
docker rm -f $(docker ps -aq) 2>/dev/null || echo "  (tidak ada container)"

# Hapus semua image
echo "[3/6] Hapus semua image..."
docker rmi -f $(docker images -aq) 2>/dev/null || echo "  (tidak ada image)"

# Hapus semua volume
echo "[4/6] Hapus semua volume..."
docker volume rm $(docker volume ls -q) 2>/dev/null || echo "  (tidak ada volume)"

# Hapus semua network custom
echo "[5/6] Hapus semua network custom..."
docker network prune -f 2>/dev/null || true

# Uninstall Docker Engine
echo "[6/6] Uninstall Docker Engine..."
apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin 2>/dev/null || \
apt-get purge -y docker.io docker-compose 2>/dev/null || \
echo "  (Docker tidak ditemukan via apt)"

# Hapus file sisa Docker
rm -rf /var/lib/docker
rm -rf /var/lib/containerd
rm -rf /etc/docker

# Hapus group docker
groupdel docker 2>/dev/null || true

echo ""
echo "=== Docker sudah bersih! ==="
echo "Lanjut install PM2 dengan panduan INSTALL_VPS.md"
