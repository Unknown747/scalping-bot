#!/bin/bash
# ============================================================
#  MemeScalper AI Pro v2.0.0 — UPDATE SCRIPT
#  Untuk memperbarui bot yang sudah terinstall
#  Jalankan: sudo bash update.sh
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

APP_DIR="/opt/meme-scalper"
SERVICE_NAME="meme-scalper"
BINARY="meme-scalper"
BACKUP_DIR="/opt/meme-scalper-backup"
PORT="5000"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')

print_banner() {
    echo -e "${CYAN}${BOLD}"
    echo "  ╔══════════════════════════════════════════╗"
    echo "  ║      MemeScalper AI Pro v2.0.0           ║"
    echo "  ║          UPDATE SCRIPT — Base Net        ║"
    echo "  ╚══════════════════════════════════════════╝"
    echo -e "${NC}"
}

step()  { echo -e "\n${YELLOW}▶ $1${NC}"; }
ok()    { echo -e "${GREEN}  ✅ $1${NC}"; }
info()  { echo -e "${CYAN}  ℹ  $1${NC}"; }
fail()  { echo -e "${RED}  ❌ $1${NC}"; exit 1; }
warn()  { echo -e "${YELLOW}  ⚠️  $1${NC}"; }

print_banner

# ── Root check ────────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
    fail "Jalankan sebagai root: sudo bash update.sh"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Cek apakah sudah terinstall ───────────────────────────────────────────────
step "Cek instalasi sebelumnya..."
if [ ! -d "$APP_DIR" ]; then
    fail "Bot belum terinstall di ${APP_DIR}. Jalankan install.sh terlebih dahulu."
fi
ok "Instalasi ditemukan di ${APP_DIR}"

# ── Backup konfigurasi & binary lama ─────────────────────────────────────────
step "Backup konfigurasi dan binary lama..."
mkdir -p "${BACKUP_DIR}/${TIMESTAMP}"

# Backup .env (konfigurasi paling penting)
if [ -f "$APP_DIR/.env" ]; then
    cp "$APP_DIR/.env" "${BACKUP_DIR}/${TIMESTAMP}/.env"
    ok ".env di-backup ke ${BACKUP_DIR}/${TIMESTAMP}/.env"
fi

# Backup config.json
if [ -f "$APP_DIR/config.json" ]; then
    cp "$APP_DIR/config.json" "${BACKUP_DIR}/${TIMESTAMP}/config.json"
    ok "config.json di-backup"
fi

# Backup binary lama
if [ -f "$APP_DIR/$BINARY" ]; then
    cp "$APP_DIR/$BINARY" "${BACKUP_DIR}/${TIMESTAMP}/${BINARY}.old"
    ok "Binary lama di-backup"
fi

info "Semua backup tersimpan di: ${BACKUP_DIR}/${TIMESTAMP}/"

# Hapus backup lama (simpan 5 terbaru saja)
ls -dt "${BACKUP_DIR}"/20* 2>/dev/null | tail -n +6 | xargs rm -rf 2>/dev/null || true
info "Backup lama dibersihkan (simpan 5 terbaru)"

# ── Stop service ──────────────────────────────────────────────────────────────
step "Menghentikan bot sementara..."
if systemctl is-active --quiet "$SERVICE_NAME"; then
    systemctl stop "$SERVICE_NAME"
    ok "Bot dihentikan"
else
    warn "Bot tidak sedang berjalan — lanjut update"
fi

# ── Update file aplikasi ──────────────────────────────────────────────────────
step "Menyalin file aplikasi terbaru..."
rsync -a \
    --exclude='.git' \
    --exclude='*.log' \
    --exclude='.env' \
    --exclude='config.json' \
    "$SCRIPT_DIR/" "$APP_DIR/" 2>/dev/null \
    || cp -r "$SCRIPT_DIR/." "$APP_DIR/"

# Pulihkan .env yang asli (jangan ditimpa saat update)
if [ -f "${BACKUP_DIR}/${TIMESTAMP}/.env" ] && [ ! -f "$APP_DIR/.env" ]; then
    cp "${BACKUP_DIR}/${TIMESTAMP}/.env" "$APP_DIR/.env"
fi

ok "File aplikasi berhasil diperbarui"

# ── Update Go jika perlu ──────────────────────────────────────────────────────
export PATH=$PATH:/usr/local/go/bin
if ! command -v go &>/dev/null; then
    warn "Go tidak ditemukan — install ulang..."
    GO_VERSION="1.21.13"
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64)  GO_ARCH="amd64" ;;
        aarch64) GO_ARCH="arm64" ;;
        armv6l)  GO_ARCH="armv6l" ;;
        *) fail "Arsitektur tidak didukung: $ARCH" ;;
    esac
    cd /tmp
    wget -q "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
    rm -rf /usr/local/go
    tar -C /usr/local -xzf "go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
    rm -f "go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
    echo 'export PATH=$PATH:/usr/local/go/bin' > /etc/profile.d/go.sh
    export PATH=$PATH:/usr/local/go/bin
    ok "Go berhasil diinstall ulang"
else
    CURRENT_GO=$(go version | awk '{print $3}' | sed 's/go//')
    ok "Go v${CURRENT_GO} sudah OK"
fi

# ── Rebuild binary ────────────────────────────────────────────────────────────
step "Build binary baru..."
cd "$APP_DIR"
/usr/local/go/bin/go mod tidy -e 2>/dev/null || true
/usr/local/go/bin/go build -ldflags="-s -w" -o "$BINARY" . \
    || {
        warn "Build gagal! Mengembalikan binary lama..."
        if [ -f "${BACKUP_DIR}/${TIMESTAMP}/${BINARY}.old" ]; then
            cp "${BACKUP_DIR}/${TIMESTAMP}/${BINARY}.old" "$APP_DIR/$BINARY"
            warn "Binary lama dipulihkan. Periksa error build di atas."
        fi
        fail "Update gagal — binary lama dipulihkan"
    }

chmod +x "$BINARY"
BINARY_SIZE=$(du -sh "$BINARY" | cut -f1)
ok "Binary baru berhasil dibuild (${BINARY_SIZE})"

# ── Update systemd service (jika ada perubahan) ───────────────────────────────
step "Perbarui konfigurasi service..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" << SVCEOF
[Unit]
Description=MemeScalper AI Pro — Base Network Trading Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
ExecStart=${APP_DIR}/${BINARY}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
EnvironmentFile=${APP_DIR}/.env

MemoryMax=512M
CPUQuota=80%

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
ok "Konfigurasi service diperbarui"

# ── Start service ─────────────────────────────────────────────────────────────
step "Menjalankan ulang bot..."
systemctl start "$SERVICE_NAME"
sleep 4

# ── Cek status ────────────────────────────────────────────────────────────────
VPS_IP=$(hostname -I | awk '{print $1}')
echo ""
echo -e "${CYAN}${BOLD}════════════════════════════════════════════${NC}"
echo -e "${BOLD}  UPDATE SELESAI!${NC}"
echo ""
if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo -e "  ${GREEN}${BOLD}Status    : BERJALAN ✅${NC}"
    echo -e "  Dashboard : ${CYAN}http://${VPS_IP}:${PORT}${NC}"
    echo ""
    echo -e "  ${BOLD}Backup tersimpan di:${NC}"
    echo -e "  ${BACKUP_DIR}/${TIMESTAMP}/"
else
    echo -e "  ${RED}${BOLD}Status    : GAGAL START ❌${NC}"
    echo ""
    warn "Cek log untuk melihat error:"
    echo "  journalctl -u ${SERVICE_NAME} -n 50 --no-pager"
    echo ""
    info "Untuk rollback ke versi sebelumnya:"
    echo "  cp ${BACKUP_DIR}/${TIMESTAMP}/${BINARY}.old ${APP_DIR}/${BINARY}"
    echo "  systemctl start ${SERVICE_NAME}"
fi
echo ""
echo -e "  ${BOLD}Perintah berguna:${NC}"
echo "  journalctl -u ${SERVICE_NAME} -f        # Log live"
echo "  systemctl status ${SERVICE_NAME}         # Cek status"
echo "  systemctl restart ${SERVICE_NAME}        # Restart bot"
echo "  systemctl stop ${SERVICE_NAME}           # Stop bot"
echo -e "${CYAN}${BOLD}════════════════════════════════════════════${NC}"
