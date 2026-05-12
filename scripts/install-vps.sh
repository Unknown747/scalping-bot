#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  BASE Scalper — Instalasi Otomatis VPS Ubuntu
#  Jalankan: bash scripts/install-vps.sh
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# ─── Warna ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}✔ $1${NC}"; }
info() { echo -e "${CYAN}▶ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
err()  { echo -e "${RED}✘ $1${NC}"; exit 1; }
hr()   { echo -e "${BLUE}────────────────────────────────────────────────────────${NC}"; }

# ─── Header ───────────────────────────────────────────────────────────────────
clear
echo -e "${BOLD}${BLUE}"
echo "  ██████╗  █████╗ ███████╗███████╗    ███████╗ ██████╗ █████╗ ██╗     ██████╗ ███████╗██████╗ "
echo "  ██╔══██╗██╔══██╗██╔════╝██╔════╝    ██╔════╝██╔════╝██╔══██╗██║     ██╔══██╗██╔════╝██╔══██╗"
echo "  ██████╔╝███████║███████╗█████╗      ███████╗██║     ███████║██║     ██████╔╝█████╗  ██████╔╝"
echo "  ██╔══██╗██╔══██║╚════██║██╔══╝      ╚════██║██║     ██╔══██║██║     ██╔═══╝ ██╔══╝  ██╔══██╗"
echo "  ██████╔╝██║  ██║███████║███████╗    ███████║╚██████╗██║  ██║███████╗██║     ███████╗██║  ██║"
echo "  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝    ╚══════╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝     ╚══════╝╚═╝  ╚═╝"
echo -e "${NC}"
echo -e "${BOLD}  Meme Coin Scalping Bot — Instalasi Otomatis VPS Ubuntu${NC}"
hr

# ─── Cek root ─────────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  err "Jalankan sebagai root: sudo bash scripts/install-vps.sh"
fi

# ─── Deteksi direktori project ────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
info "Direktori project: $PROJECT_DIR"
cd "$PROJECT_DIR"

# ─── Kumpulkan konfigurasi ────────────────────────────────────────────────────
hr
echo -e "${BOLD}  Konfigurasi Bot${NC}"
echo -e "  Isi dengan benar. Data ini disimpan di file .env (tidak dikirim ke mana pun)."
hr
echo ""

read_secret() {
  local prompt="$1" var
  while true; do
    read -rsp "  $prompt: " var; echo
    [ -n "$var" ] && break
    warn "  Tidak boleh kosong, coba lagi."
  done
  echo "$var"
}

read_input() {
  local prompt="$1" default="$2" var
  if [ -n "$default" ]; then
    read -rp "  $prompt [$default]: " var
    echo "${var:-$default}"
  else
    while true; do
      read -rp "  $prompt: " var
      [ -n "$var" ] && break
      warn "  Tidak boleh kosong, coba lagi."
    done
    echo "$var"
  fi
}

echo -e "${BOLD}  [1/6] Wallet Bot${NC}"
warn "  Gunakan wallet BARU khusus bot — jangan pakai wallet utama!"
PRIVATE_KEY=$(read_secret "PRIVATE_KEY (0x...)")
WALLET_ADDRESS=$(read_input "WALLET_ADDRESS (0x...)")
echo ""

echo -e "${BOLD}  [2/6] RPC URL${NC}"
echo "  Daftar gratis di https://alchemy.com → pilih Base Mainnet"
BASE_RPC_URL=$(read_input "BASE_RPC_URL (https://base-mainnet.g.alchemy.com/v2/...)")
echo ""

echo -e "${BOLD}  [3/6] Password Dashboard${NC}"
DASHBOARD_PASSWORD=$(read_secret "DASHBOARD_PASSWORD (password login dashboard)")
echo ""

echo -e "${BOLD}  [4/6] AI Filter — opsional (Enter untuk skip)${NC}"
echo "  Daftar key gratis di https://aistudio.google.com/app/apikey"
read -rp "  GEMINI_API_KEY (kosongkan jika tidak pakai): " GEMINI_API_KEY
echo ""

echo -e "${BOLD}  [5/6] Notifikasi Telegram — opsional (Enter untuk skip)${NC}"
read -rp "  TELEGRAM_BOT_TOKEN (kosongkan jika tidak pakai): " TELEGRAM_BOT_TOKEN
read -rp "  TELEGRAM_CHAT_ID (kosongkan jika tidak pakai): " TELEGRAM_CHAT_ID
echo ""

echo -e "${BOLD}  [6/6] Port Nginx${NC}"
NGINX_PORT=$(read_input "Port dashboard" "80")
echo ""

# Generate session secret
SESSION_SECRET=$(openssl rand -hex 32)

# ─── Konfirmasi ───────────────────────────────────────────────────────────────
hr
echo -e "${BOLD}  Ringkasan Konfigurasi${NC}"
hr
echo "  PRIVATE_KEY    : ${PRIVATE_KEY:0:6}...${PRIVATE_KEY: -4} (tersembunyi)"
echo "  WALLET_ADDRESS : $WALLET_ADDRESS"
echo "  BASE_RPC_URL   : ${BASE_RPC_URL:0:40}..."
echo "  DASHBOARD_PASSWORD : (tersembunyi)"
echo "  GEMINI_API_KEY : ${GEMINI_API_KEY:-tidak dipakai}"
echo "  TELEGRAM       : ${TELEGRAM_BOT_TOKEN:-tidak dipakai}"
echo "  PORT           : $NGINX_PORT"
hr
echo ""
read -rp "  Lanjutkan instalasi? [Y/n]: " CONFIRM
[[ "${CONFIRM,,}" == "n" ]] && echo "Instalasi dibatalkan." && exit 0
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
#  MULAI INSTALASI
# ═══════════════════════════════════════════════════════════════════════════════

hr
info "STEP 1/8 — Update sistem & install build tools"
hr

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq git curl python3 make g++ libsqlite3-dev nginx
ok "Sistem dan build tools siap"

# ─── Node.js via nvm ──────────────────────────────────────────────────────────
hr
info "STEP 2/8 — Install Node.js 24 (NVM)"
hr

export NVM_DIR="/root/.nvm"
if [ ! -f "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
source "$NVM_DIR/nvm.sh"
nvm install 24 --no-progress
nvm use 24
nvm alias default 24
ok "Node.js $(node --version) siap"

# ─── pnpm + PM2 ───────────────────────────────────────────────────────────────
hr
info "STEP 3/8 — Install pnpm & PM2"
hr

npm install -g pnpm pm2 --silent
ok "pnpm $(pnpm --version) & PM2 siap"

# ─── Dependencies ─────────────────────────────────────────────────────────────
hr
info "STEP 4/8 — Install dependencies"
hr

pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile
ok "Dependencies terinstall"

# ─── Buat .env ────────────────────────────────────────────────────────────────
hr
info "STEP 5/8 — Buat file .env"
hr

ENV_FILE="$PROJECT_DIR/artifacts/api-server/.env"
cat > "$ENV_FILE" <<EOF
PORT=8080
NODE_ENV=production

# ─── Auth ─────────────────────────────────────────────────────────────────────
SESSION_SECRET=$SESSION_SECRET
DASHBOARD_PASSWORD=$DASHBOARD_PASSWORD

# ─── Wallet ───────────────────────────────────────────────────────────────────
PRIVATE_KEY=$PRIVATE_KEY
WALLET_ADDRESS=$WALLET_ADDRESS

# ─── RPC ──────────────────────────────────────────────────────────────────────
BASE_RPC_URL=$BASE_RPC_URL
MEV_PROTECTION_RPC=https://mev-blocker.drpc.org
MEV_PROTECTION_RPC_BACKUP=https://rpc.flashbots.net/fast
EOF

if [ -n "$GEMINI_API_KEY" ]; then
cat >> "$ENV_FILE" <<EOF

# ─── AI Filter ────────────────────────────────────────────────────────────────
AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com
AI_INTEGRATIONS_GEMINI_API_KEY=$GEMINI_API_KEY
EOF
fi

if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
cat >> "$ENV_FILE" <<EOF

# ─── Telegram ─────────────────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID=$TELEGRAM_CHAT_ID
EOF
fi

chmod 600 "$ENV_FILE"
ok "File .env dibuat (permissions: 600)"

# ─── Build ────────────────────────────────────────────────────────────────────
hr
info "STEP 6/8 — Build (API + Dashboard)"
hr

pnpm --filter @workspace/api-server run build
ok "API server berhasil di-build"

BASE_PATH=/ PORT=$NGINX_PORT pnpm --filter @workspace/scalping-dashboard run build
ok "Dashboard berhasil di-build"

# ─── PM2 ──────────────────────────────────────────────────────────────────────
hr
info "STEP 7/8 — Setup PM2"
hr

# Stop jika sudah ada
pm2 stop scalper-api 2>/dev/null || true
pm2 delete scalper-api 2>/dev/null || true

pm2 start "$PROJECT_DIR/ecosystem.config.cjs"
pm2 save

# Setup auto-start saat reboot
env PATH="$PATH:$(which node)" pm2 startup systemd -u root --hp /root | tail -1 | bash || true
pm2 save

ok "PM2 berjalan dan terdaftar auto-start"

# ─── Nginx ────────────────────────────────────────────────────────────────────
hr
info "STEP 8/8 — Setup Nginx"
hr

DIST_PATH="$PROJECT_DIR/artifacts/scalping-dashboard/dist/public"

cat > /etc/nginx/sites-available/scalper <<NGINXCONF
server {
    listen $NGINX_PORT;
    server_name _;

    root $DIST_PATH;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript;
    gzip_min_length 1024;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:8080/api/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
    }

    location /socket.io/ {
        proxy_pass http://localhost:8080/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400s;
    }
}
NGINXCONF

ln -sf /etc/nginx/sites-available/scalper /etc/nginx/sites-enabled/scalper
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx
systemctl enable nginx
ok "Nginx dikonfigurasi dan berjalan"

# ─── Firewall ─────────────────────────────────────────────────────────────────
ufw allow ssh     2>/dev/null || true
ufw allow "$NGINX_PORT/tcp" 2>/dev/null || true
ufw --force enable 2>/dev/null || true
ok "Firewall dikonfigurasi"

# ─── Verifikasi ───────────────────────────────────────────────────────────────
hr
info "Verifikasi instalasi..."
hr

sleep 3

API_STATUS=$(curl -s http://localhost:8080/api/healthz 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "GAGAL")
if echo "$API_STATUS" | grep -q "ok"; then
  ok "API server: ONLINE"
else
  warn "API server belum merespons. Cek: pm2 logs scalper-api"
fi

NGINX_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$NGINX_PORT 2>/dev/null || echo "000")
if [ "$NGINX_STATUS" = "200" ]; then
  ok "Dashboard: ONLINE (HTTP $NGINX_STATUS)"
else
  warn "Dashboard status: HTTP $NGINX_STATUS — cek: systemctl status nginx"
fi

# ─── Selesai ──────────────────────────────────────────────────────────────────
VPS_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

echo ""
hr
echo -e "${GREEN}${BOLD}"
echo "  ✅  INSTALASI SELESAI!"
echo -e "${NC}"
echo -e "  Dashboard  : ${BOLD}http://$VPS_IP${NC}"
echo -e "  API health : http://localhost:8080/api/healthz"
echo ""
echo -e "  Login dengan DASHBOARD_PASSWORD yang sudah kamu set."
echo ""
echo -e "${BOLD}  Langkah selanjutnya:${NC}"
echo "  1. Buka http://$VPS_IP di browser"
echo "  2. Cek Security Audit — semua harus ✅"
echo "  3. Coba Paper mode dulu minimal 24 jam"
echo "  4. Jika siap → Settings → Mode → LIVE → START BOT"
echo ""
echo -e "${BOLD}  Perintah penting:${NC}"
echo "  pm2 logs scalper-api     — lihat log bot"
echo "  pm2 restart scalper-api  — restart bot"
echo "  pm2 status               — status bot"
hr
echo ""
