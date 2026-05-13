#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

APP_NAME="meme-scalper"
APP_DIR="/opt/meme-scalper"
SERVICE_NAME="meme-scalper"
GO_VERSION="1.21.13"
BINARY="meme-scalper"
PORT="5000"

print_banner() {
    echo -e "${CYAN}${BOLD}"
    echo "  ╔══════════════════════════════════════╗"
    echo "  ║     MemeScalper AI Pro — Deploy      ║"
    echo "  ║          Base Network Bot            ║"
    echo "  ╚══════════════════════════════════════╝"
    echo -e "${NC}"
}

step() {
    echo -e "${YELLOW}▶ $1${NC}"
}

ok() {
    echo -e "${GREEN}✅ $1${NC}"
}

fail() {
    echo -e "${RED}❌ $1${NC}"
    exit 1
}

print_banner

# ── Root check ───────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
    fail "Jalankan sebagai root atau gunakan: sudo bash deploy.sh"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Install dependencies ──────────────────────────────────────────────────────
step "Cek dependensi sistem..."
if ! command -v wget &>/dev/null || ! command -v tar &>/dev/null; then
    apt-get update -qq && apt-get install -y wget tar curl
fi
ok "Dependensi sistem OK"

# ── Install Go ────────────────────────────────────────────────────────────────
install_go() {
    step "Install Go ${GO_VERSION}..."
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64)  GO_ARCH="amd64" ;;
        aarch64) GO_ARCH="arm64" ;;
        armv6l)  GO_ARCH="armv6l" ;;
        *)       fail "Arsitektur tidak didukung: $ARCH" ;;
    esac

    cd /tmp
    wget -q "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz" \
        || fail "Gagal download Go"
    rm -rf /usr/local/go
    tar -C /usr/local -xzf "go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
    rm "go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"

    echo 'export PATH=$PATH:/usr/local/go/bin' > /etc/profile.d/go.sh
    export PATH=$PATH:/usr/local/go/bin
    ok "Go ${GO_VERSION} terinstal"
}

export PATH=$PATH:/usr/local/go/bin
if ! command -v go &>/dev/null; then
    install_go
else
    CURRENT_GO=$(go version | awk '{print $3}' | sed 's/go//')
    ok "Go sudah ada: v${CURRENT_GO}"
fi

export PATH=$PATH:/usr/local/go/bin

# ── Setup direktori ───────────────────────────────────────────────────────────
step "Setup direktori ${APP_DIR}..."
mkdir -p "$APP_DIR"

step "Menyalin file aplikasi..."
rsync -a --exclude='.git' --exclude='*.log' \
    "$SCRIPT_DIR/" "$APP_DIR/" 2>/dev/null \
    || cp -r "$SCRIPT_DIR/." "$APP_DIR/"
ok "File disalin ke ${APP_DIR}"

# ── Setup .env ────────────────────────────────────────────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
    step "Membuat file .env..."
    cat > "$APP_DIR/.env" << 'ENVEOF'
# ── Dashboard Login (WAJIB) ───────────────────────────
BOT_USERNAME=admin
BOT_PASSWORD=ganti_password_aman

# ── Wallet ────────────────────────────────────────────
WALLET_ADDRESS=0x_alamat_wallet_kamu
WALLET_PRIVATE_KEY=private_key_tanpa_prefix_0x

# ── AI: Gemini (GRATIS) https://aistudio.google.com ──
GEMINI_API_KEY=ganti_dengan_gemini_key

# ── AI: Groq (GRATIS) https://console.groq.com ───────
GROQ_API_KEY=ganti_dengan_groq_key

# ── AI: OpenRouter (GRATIS) https://openrouter.ai ────
OPENROUTER_API_KEY=ganti_dengan_openrouter_key

# ── AI: Together AI ($1 gratis) https://together.ai ──
TOGETHER_API_KEY=ganti_dengan_together_key

# ── AI: Huangfing ─────────────────────────────────────
HUANGFING_API_KEY=ganti_dengan_huangfing_key
HUANGFING_BASE_URL=https://api.huangfing.ai/v1

# ── Telegram (opsional) ───────────────────────────────
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# ── Behaviour ─────────────────────────────────────────
AUTO_START=true
PORT=5000
LOG_LEVEL=info
ENVEOF
    echo ""
    echo -e "${YELLOW}⚠️  PENTING: Edit file .env sebelum bot dijalankan!${NC}"
    echo -e "   nano ${APP_DIR}/.env"
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
ok "Binary berhasil di-build ($(du -sh "$BINARY" | cut -f1))"

# ── Systemd service ───────────────────────────────────────────────────────────
step "Membuat systemd service..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" << SVCEOF
[Unit]
Description=MemeScalper AI Pro — Base Network Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
ExecStart=${APP_DIR}/${BINARY}
Restart=always
RestartSec=5
RestartPreventExitStatus=0
StandardOutput=journal
StandardError=journal
EnvironmentFile=${APP_DIR}/.env

# Limit resource usage
MemoryMax=256M
CPUQuota=80%

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" &>/dev/null
ok "Service dikonfigurasi"

# ── Firewall (opsional) ───────────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
    step "Buka port ${PORT} di firewall..."
    ufw allow "$PORT"/tcp &>/dev/null || true
    ok "Port ${PORT} dibuka"
fi

# ── Start / Restart service ───────────────────────────────────────────────────
if systemctl is-active --quiet "$SERVICE_NAME"; then
    step "Restart service (update)..."
    systemctl restart "$SERVICE_NAME"
else
    step "Mulai service..."
    systemctl start "$SERVICE_NAME"
fi

sleep 3

# ── Status ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}══════════════════════════════════════${NC}"
STATUS=$(systemctl is-active "$SERVICE_NAME")
if [ "$STATUS" == "active" ]; then
    VPS_IP=$(hostname -I | awk '{print $1}')
    echo -e "${GREEN}${BOLD}  Bot BERJALAN ✅${NC}"
    echo ""
    echo -e "  Dashboard : ${CYAN}http://${VPS_IP}:${PORT}${NC}"
    echo ""
    echo -e "  ${BOLD}Perintah berguna:${NC}"
    echo "  journalctl -u ${SERVICE_NAME} -f        # Lihat log live"
    echo "  systemctl status ${SERVICE_NAME}         # Cek status"
    echo "  systemctl stop ${SERVICE_NAME}           # Stop bot"
    echo "  systemctl restart ${SERVICE_NAME}        # Restart bot"
    echo "  nano ${APP_DIR}/.env                     # Edit config"
    echo "  bash ${SCRIPT_DIR}/deploy.sh             # Update & redeploy"
else
    echo -e "${RED}${BOLD}  Bot GAGAL start ❌${NC}"
    echo ""
    echo "  Cek log dengan:"
    echo "  journalctl -u ${SERVICE_NAME} -n 50 --no-pager"
    echo ""
    echo "  Kemungkinan masalah:"
    echo "  - .env belum diisi dengan key yang benar"
    echo "  - Port ${PORT} sudah dipakai proses lain"
fi
echo -e "${CYAN}${BOLD}══════════════════════════════════════${NC}"
