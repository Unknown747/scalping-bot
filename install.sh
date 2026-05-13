#!/bin/bash
# ============================================================
#  MemeScalper AI Pro v2.0.0 — INSTALL SCRIPT
#  Untuk instalasi pertama kali di VPS / Server Linux
#  Jalankan: sudo bash install.sh
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

APP_NAME="MemeScalper AI Pro"
APP_DIR="/opt/meme-scalper"
SERVICE_NAME="meme-scalper"
BINARY="meme-scalper"
GO_VERSION="1.21.13"
PORT="5000"

print_banner() {
    echo -e "${CYAN}${BOLD}"
    echo "  ╔══════════════════════════════════════════╗"
    echo "  ║      MemeScalper AI Pro v2.0.0           ║"
    echo "  ║         INSTALL SCRIPT — Base Net        ║"
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
    fail "Jalankan sebagai root: sudo bash install.sh"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Cek OS ────────────────────────────────────────────────────────────────────
step "Cek sistem operasi..."
if [ -f /etc/os-release ]; then
    . /etc/os-release
    info "OS: $NAME $VERSION_ID"
else
    warn "Tidak bisa deteksi OS — lanjut dengan asumsi Debian/Ubuntu"
fi

# ── Install dependensi sistem ─────────────────────────────────────────────────
step "Install dependensi sistem..."
apt-get update -qq
apt-get install -y wget curl tar git rsync nano ufw 2>/dev/null || \
    yum install -y wget curl tar git rsync nano 2>/dev/null || true
ok "Dependensi sistem OK"

# ── Install Go ────────────────────────────────────────────────────────────────
install_go() {
    step "Install Go ${GO_VERSION}..."
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64)  GO_ARCH="amd64" ;;
        aarch64) GO_ARCH="arm64" ;;
        armv6l)  GO_ARCH="armv6l" ;;
        *) fail "Arsitektur tidak didukung: $ARCH" ;;
    esac

    cd /tmp
    wget -q --show-progress \
        "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz" \
        || fail "Gagal download Go — cek koneksi internet"

    rm -rf /usr/local/go
    tar -C /usr/local -xzf "go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
    rm -f "go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"

    echo 'export PATH=$PATH:/usr/local/go/bin' > /etc/profile.d/go.sh
    export PATH=$PATH:/usr/local/go/bin
    ok "Go ${GO_VERSION} berhasil diinstall"
}

export PATH=$PATH:/usr/local/go/bin
if ! command -v go &>/dev/null; then
    install_go
else
    CURRENT_GO=$(go version | awk '{print $3}' | sed 's/go//')
    ok "Go sudah terinstall: v${CURRENT_GO}"
fi
export PATH=$PATH:/usr/local/go/bin

# ── Setup direktori ───────────────────────────────────────────────────────────
step "Setup direktori aplikasi (${APP_DIR})..."
mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/web"
mkdir -p "$APP_DIR/internal"

step "Menyalin file aplikasi..."
rsync -a --exclude='.git' --exclude='*.log' --exclude='*.sh' \
    "$SCRIPT_DIR/" "$APP_DIR/" 2>/dev/null \
    || cp -r "$SCRIPT_DIR/." "$APP_DIR/"
ok "File berhasil disalin ke ${APP_DIR}"

# ── Setup file .env ───────────────────────────────────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
    step "Membuat file konfigurasi .env..."
    cat > "$APP_DIR/.env" << 'ENVEOF'
# ================================================================
#  MemeScalper AI Pro v2.0.0 — Konfigurasi Environment
#  Edit file ini sebelum menjalankan bot!
#  Panduan lengkap: lihat .env.example
# ================================================================

# ── Dashboard Login (WAJIB diisi) ────────────────────────────────
BOT_USERNAME=admin
BOT_PASSWORD=ganti_dengan_password_aman_kamu

# ── Wallet Base Network (untuk trading nyata) ────────────────────
WALLET_ADDRESS=0x_alamat_wallet_kamu
WALLET_PRIVATE_KEY=private_key_tanpa_prefix_0x

# ── AI: Gemini (Primary — GRATIS) ────────────────────────────────
# Daftar di: https://aistudio.google.com/app/apikey
GEMINI_API_KEY=ganti_dengan_gemini_api_key
# Opsional: tambah key ke-2 dst untuk rotasi (pisah koma atau pakai GEMINI_API_KEY_2)

# ── AI: Groq (Backup #1 — GRATIS) ────────────────────────────────
# Daftar di: https://console.groq.com
GROQ_API_KEY=ganti_dengan_groq_api_key

# ── AI: OpenRouter (Opsional — GRATIS) ───────────────────────────
# Daftar di: https://openrouter.ai
OPENROUTER_API_KEY=ganti_dengan_openrouter_api_key

# ── AI: Together AI (Opsional — $1 kredit gratis) ────────────────
# Daftar di: https://api.together.ai
TOGETHER_API_KEY=ganti_dengan_together_api_key

# ── AI: Huangfing (Backup #2) ─────────────────────────────────────
HUANGFING_API_KEY=ganti_dengan_huangfing_api_key
HUANGFING_BASE_URL=https://api.huangfing.ai/v1

# ── Telegram Notifikasi (opsional — GRATIS) ───────────────────────
# Cara dapat: chat @BotFather → /newbot  |  Chat ID: @userinfobot
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# ── Bot Behaviour ─────────────────────────────────────────────────
AUTO_START=true
PORT=5000
LOG_LEVEL=info
ENVEOF

    echo ""
    warn "File .env telah dibuat. WAJIB diedit sebelum bot dijalankan!"
    warn "Jalankan: nano ${APP_DIR}/.env"
    echo ""
else
    ok ".env sudah ada — konfigurasi lama dipertahankan"
fi

# ── Build binary ──────────────────────────────────────────────────────────────
step "Build binary Go..."
cd "$APP_DIR"
/usr/local/go/bin/go mod tidy -e 2>/dev/null || true
/usr/local/go/bin/go build -ldflags="-s -w" -o "$BINARY" . \
    || fail "Build gagal — periksa error di atas"
chmod +x "$BINARY"
BINARY_SIZE=$(du -sh "$BINARY" | cut -f1)
ok "Binary berhasil dibuild (${BINARY_SIZE})"

# ── Buat systemd service ──────────────────────────────────────────────────────
step "Mendaftarkan service systemd..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" << SVCEOF
[Unit]
Description=${APP_NAME} — Base Network Trading Bot
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
systemctl enable "$SERVICE_NAME" &>/dev/null
ok "Service systemd terdaftar dan akan auto-start saat reboot"

# ── Firewall ──────────────────────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
    step "Konfigurasi firewall (UFW)..."
    ufw allow ssh &>/dev/null || true
    ufw allow "$PORT"/tcp &>/dev/null || true
    ufw --force enable &>/dev/null || true
    ok "Firewall: port SSH dan ${PORT} dibuka"
fi

# ── Cek apakah .env sudah diisi ──────────────────────────────────────────────
ENV_READY=true
if grep -q "ganti_" "$APP_DIR/.env" 2>/dev/null; then
    ENV_READY=false
fi

# ── Start service ─────────────────────────────────────────────────────────────
if [ "$ENV_READY" = true ]; then
    step "Menjalankan bot..."
    systemctl start "$SERVICE_NAME"
    sleep 3
else
    warn "Bot BELUM dijalankan — isi dulu file .env"
    info "Setelah mengisi .env, jalankan: systemctl start ${SERVICE_NAME}"
fi

# ── Ringkasan instalasi ───────────────────────────────────────────────────────
VPS_IP=$(hostname -I | awk '{print $1}')
echo ""
echo -e "${CYAN}${BOLD}════════════════════════════════════════════${NC}"
echo -e "${BOLD}  INSTALASI SELESAI!${NC}"
echo ""
if [ "$ENV_READY" = true ] && systemctl is-active --quiet "$SERVICE_NAME"; then
    echo -e "  ${GREEN}${BOLD}Status    : BERJALAN ✅${NC}"
    echo -e "  Dashboard : ${CYAN}http://${VPS_IP}:${PORT}${NC}"
else
    echo -e "  ${YELLOW}${BOLD}Status    : Menunggu konfigurasi .env ⚙️${NC}"
    echo ""
    echo -e "  ${BOLD}Langkah selanjutnya:${NC}"
    echo -e "  ${YELLOW}1. nano ${APP_DIR}/.env${NC}  ← isi semua konfigurasi"
    echo -e "  ${YELLOW}2. systemctl start ${SERVICE_NAME}${NC}  ← jalankan bot"
    echo -e "  ${YELLOW}3. Buka http://${VPS_IP}:${PORT}${NC}  ← akses dashboard"
fi
echo ""
echo -e "  ${BOLD}Direktori app :${NC} ${APP_DIR}"
echo -e "  ${BOLD}File config   :${NC} ${APP_DIR}/.env"
echo -e "  ${BOLD}Port dashboard:${NC} ${PORT}"
echo ""
echo -e "  ${BOLD}Perintah berguna:${NC}"
echo "  journalctl -u ${SERVICE_NAME} -f        # Log live"
echo "  systemctl status ${SERVICE_NAME}         # Cek status"
echo "  systemctl restart ${SERVICE_NAME}        # Restart bot"
echo "  systemctl stop ${SERVICE_NAME}           # Stop bot"
echo "  bash /opt/meme-scalper/update.sh         # Update bot"
echo -e "${CYAN}${BOLD}════════════════════════════════════════════${NC}"
