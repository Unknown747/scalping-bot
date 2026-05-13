#!/bin/bash
# ============================================================
#  MemeScalper AI Pro v2.0.0 — VPS UPDATE SCRIPT
#  Cara pakai:
#    1. Upload folder project terbaru ke VPS (zip/scp/git)
#    2. sudo bash update.sh
#  Atau langsung dari GitHub:
#    sudo bash update.sh --git https://github.com/USER/REPO.git
# ============================================================

set -euo pipefail

# ── Warna ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Konfigurasi ───────────────────────────────────────────────────────────────
APP_DIR="/opt/meme-scalper"
SERVICE_NAME="meme-scalper"
BINARY="meme-scalper"
BACKUP_DIR="/opt/meme-scalper-backup"
PORT="5000"
GO_VERSION="1.21.13"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIT_REPO=""
TEMP_DIR=""

# ── Helper ────────────────────────────────────────────────────────────────────
banner() {
    echo -e "${CYAN}${BOLD}"
    echo "  ╔══════════════════════════════════════════╗"
    echo "  ║   MemeScalper AI Pro — VPS UPDATE        ║"
    echo "  ║   $(date '+%Y-%m-%d %H:%M:%S')                   ║"
    echo "  ╚══════════════════════════════════════════╝"
    echo -e "${NC}"
}
step()  { echo -e "\n${YELLOW}${BOLD}▶ $1${NC}"; }
ok()    { echo -e "${GREEN}  ✅ $1${NC}"; }
info()  { echo -e "${CYAN}  ℹ  $1${NC}"; }
warn()  { echo -e "${YELLOW}  ⚠️  $1${NC}"; }
fail()  { echo -e "${RED}  ❌ $1${NC}"; exit 1; }
hr()    { echo -e "${CYAN}${BOLD}════════════════════════════════════════════${NC}"; }

cleanup() {
    if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR"
    fi
}
trap cleanup EXIT

# ── Parse argumen ─────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --git)
            GIT_REPO="$2"
            shift 2
            ;;
        --help|-h)
            echo ""
            echo "  Cara pakai:"
            echo "    sudo bash update.sh                            # update dari folder ini"
            echo "    sudo bash update.sh --git <URL_REPO>          # update dari git"
            echo ""
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

banner

# ── Root check ────────────────────────────────────────────────────────────────
[ "$EUID" -ne 0 ] && fail "Jalankan sebagai root: sudo bash update.sh"

# ── Cek instalasi ─────────────────────────────────────────────────────────────
step "Memeriksa instalasi..."
[ ! -d "$APP_DIR" ] && fail "Bot belum terinstall di ${APP_DIR}. Jalankan install.sh terlebih dahulu."
ok "Bot terinstall di ${APP_DIR}"

# ── Go binary path ────────────────────────────────────────────────────────────
export PATH=$PATH:/usr/local/go/bin

# ── Ambil source baru ─────────────────────────────────────────────────────────
if [ -n "$GIT_REPO" ]; then
    step "Clone dari git: $GIT_REPO"
    if ! command -v git &>/dev/null; then
        apt-get install -y git -qq &>/dev/null || fail "Gagal install git"
    fi
    TEMP_DIR=$(mktemp -d)
    git clone --depth=1 "$GIT_REPO" "$TEMP_DIR/repo" \
        || fail "Gagal clone repo dari: $GIT_REPO"
    SOURCE_DIR="$TEMP_DIR/repo"
    ok "Source berhasil diclone"
else
    # Cek apakah ini adalah source directory yang valid
    if [ ! -f "$SCRIPT_DIR/main.go" ]; then
        fail "main.go tidak ditemukan di direktori ini (${SCRIPT_DIR}).\nPastikan kamu menjalankan update.sh dari dalam folder project."
    fi
    SOURCE_DIR="$SCRIPT_DIR"
    info "Update dari: ${SOURCE_DIR}"
fi

# Cek versi baru
NEW_VERSION="(tidak diketahui)"
if grep -q 'Version' "$SOURCE_DIR/main.go" 2>/dev/null; then
    NEW_VERSION=$(grep -o 'v[0-9]\+\.[0-9]\+\.[0-9]\+' "$SOURCE_DIR/main.go" | head -1)
fi
info "Versi baru: ${NEW_VERSION}"

# ── Backup ────────────────────────────────────────────────────────────────────
step "Backup konfigurasi dan binary lama..."
BACKUP_PATH="${BACKUP_DIR}/${TIMESTAMP}"
mkdir -p "$BACKUP_PATH"

# Backup .env (WAJIB — jangan sampai hilang)
if [ -f "$APP_DIR/.env" ]; then
    cp "$APP_DIR/.env" "$BACKUP_PATH/.env"
    ok ".env di-backup"
else
    warn ".env tidak ditemukan — konfigurasi mungkin hilang!"
fi

# Backup config.json
[ -f "$APP_DIR/config.json" ] && cp "$APP_DIR/config.json" "$BACKUP_PATH/config.json" && ok "config.json di-backup"

# Backup binary lama
if [ -f "$APP_DIR/$BINARY" ]; then
    cp "$APP_DIR/$BINARY" "$BACKUP_PATH/${BINARY}.old"
    BINARY_OLD_SIZE=$(du -sh "$BACKUP_PATH/${BINARY}.old" | cut -f1)
    ok "Binary lama di-backup (${BINARY_OLD_SIZE})"
fi

info "Backup tersimpan di: ${BACKUP_PATH}"

# Hapus backup lama — simpan 5 terbaru
TOTAL_BACKUPS=$(ls -d "${BACKUP_DIR}"/20* 2>/dev/null | wc -l)
if [ "$TOTAL_BACKUPS" -gt 5 ]; then
    ls -dt "${BACKUP_DIR}"/20* | tail -n +6 | xargs rm -rf 2>/dev/null || true
    info "Backup lama dihapus (tersisa 5 terbaru)"
fi

# ── Stop service ──────────────────────────────────────────────────────────────
step "Menghentikan bot..."
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    systemctl stop "$SERVICE_NAME"
    ok "Bot dihentikan"
else
    warn "Bot tidak berjalan — lanjut update"
fi

# Pastikan port tidak terpakai (fallback)
if lsof -i ":${PORT}" -sTCP:LISTEN &>/dev/null 2>&1; then
    warn "Port ${PORT} masih terpakai, paksa kill..."
    fuser -k "${PORT}/tcp" 2>/dev/null || true
    sleep 2
fi

# ── Salin file baru ───────────────────────────────────────────────────────────
step "Menyalin file aplikasi terbaru..."

# Gunakan rsync jika tersedia, fallback ke cp
if command -v rsync &>/dev/null; then
    rsync -a \
        --exclude='.git' \
        --exclude='*.log' \
        --exclude='.env' \
        --exclude='config.json' \
        --exclude="${BINARY}" \
        "${SOURCE_DIR}/" "${APP_DIR}/"
else
    # Salin semua kecuali file yang dilindungi
    find "$SOURCE_DIR" -maxdepth 1 -not -name '.git' -not -name '.env' \
        -not -name 'config.json' -not -name "$BINARY" -not -name '.' \
        | while read -r item; do
            cp -r "$item" "$APP_DIR/"
        done
fi

# Pulihkan .env jika tidak ada
if [ ! -f "$APP_DIR/.env" ] && [ -f "$BACKUP_PATH/.env" ]; then
    cp "$BACKUP_PATH/.env" "$APP_DIR/.env"
    warn ".env dipulihkan dari backup"
fi

ok "File berhasil disalin"

# ── Cek / Install Go ──────────────────────────────────────────────────────────
step "Memeriksa Go runtime..."
if ! command -v go &>/dev/null || ! /usr/local/go/bin/go version &>/dev/null; then
    warn "Go tidak ditemukan — install Go ${GO_VERSION}..."
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64)  GO_ARCH="amd64" ;;
        aarch64) GO_ARCH="arm64" ;;
        armv6l)  GO_ARCH="armv6l" ;;
        *) fail "Arsitektur tidak didukung: $ARCH" ;;
    esac
    cd /tmp
    wget -q --show-progress "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz" \
        || fail "Gagal download Go"
    rm -rf /usr/local/go
    tar -C /usr/local -xzf "go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
    rm -f "go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
    echo 'export PATH=$PATH:/usr/local/go/bin' > /etc/profile.d/go.sh
    export PATH=$PATH:/usr/local/go/bin
    ok "Go ${GO_VERSION} berhasil diinstall"
else
    CURRENT_GO=$(/usr/local/go/bin/go version | awk '{print $3}')
    ok "Go ${CURRENT_GO} sudah OK"
fi

# ── Build binary baru ─────────────────────────────────────────────────────────
step "Build binary baru..."
cd "$APP_DIR"

# Tidy dependencies
/usr/local/go/bin/go mod tidy -e 2>/dev/null || true

# Build dengan optimasi size
BUILD_START=$(date +%s)
if /usr/local/go/bin/go build -ldflags="-s -w" -o "$BINARY" . 2>&1; then
    BUILD_END=$(date +%s)
    BUILD_TIME=$((BUILD_END - BUILD_START))
    chmod +x "$BINARY"
    BINARY_SIZE=$(du -sh "$BINARY" | cut -f1)
    ok "Binary berhasil dibuild: ${BINARY_SIZE} (${BUILD_TIME}s)"
else
    warn "Build GAGAL! Mengembalikan binary lama..."
    if [ -f "$BACKUP_PATH/${BINARY}.old" ]; then
        cp "$BACKUP_PATH/${BINARY}.old" "$APP_DIR/$BINARY"
        chmod +x "$APP_DIR/$BINARY"
        ok "Binary lama dipulihkan"
    fi
    systemctl start "$SERVICE_NAME" 2>/dev/null || true
    fail "Build gagal — binary lama dipulihkan dan bot direstart"
fi

# ── Perbarui systemd service ──────────────────────────────────────────────────
step "Memperbarui konfigurasi service..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
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

# Batasi resource
MemoryMax=512M
CPUQuota=80%

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
# Pastikan service aktif saat VPS reboot
systemctl enable "$SERVICE_NAME" &>/dev/null
ok "Service diperbarui dan diset auto-start saat reboot"

# ── Restart / Start service ───────────────────────────────────────────────────
step "Merestart bot..."
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    systemctl restart "$SERVICE_NAME"
    ok "Bot direstart"
else
    systemctl start "$SERVICE_NAME"
    ok "Bot dijalankan"
fi
sleep 5

# ── Cek hasil ─────────────────────────────────────────────────────────────────
VPS_IP=$(hostname -I | awk '{print $1}')
echo ""
hr
echo ""
if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo -e "  ${GREEN}${BOLD}STATUS    : BERJALAN ✅${NC}"
    echo -e "  ${BOLD}Dashboard : ${CYAN}http://${VPS_IP}:${PORT}${NC}"
    echo -e "  ${BOLD}Versi baru: ${NC}${NEW_VERSION}"
    echo ""
    echo -e "  ${BOLD}Backup sebelumnya:${NC}"
    echo "  ${BACKUP_PATH}/"
    echo ""
    echo -e "  ${BOLD}Jika ada masalah, rollback cepat:${NC}"
    echo "  ${YELLOW}cp ${BACKUP_PATH}/${BINARY}.old ${APP_DIR}/${BINARY}${NC}"
    echo "  ${YELLOW}systemctl restart ${SERVICE_NAME}${NC}"
else
    echo -e "  ${RED}${BOLD}STATUS    : GAGAL START ❌${NC}"
    echo ""
    echo -e "  Cek log:"
    echo "  ${YELLOW}journalctl -u ${SERVICE_NAME} -n 50 --no-pager${NC}"
    echo ""
    echo -e "  Rollback ke versi sebelumnya:"
    echo "  ${YELLOW}cp ${BACKUP_PATH}/${BINARY}.old ${APP_DIR}/${BINARY}${NC}"
    echo "  ${YELLOW}systemctl start ${SERVICE_NAME}${NC}"
fi
echo ""
echo -e "  ${BOLD}Perintah berguna:${NC}"
echo "  journalctl -u ${SERVICE_NAME} -f          # Log live"
echo "  systemctl status ${SERVICE_NAME}           # Cek status"
echo "  systemctl restart ${SERVICE_NAME}          # Restart"
echo "  systemctl stop ${SERVICE_NAME}             # Stop"
echo ""
hr
