#!/bin/bash
# ============================================================
#  VPS Full Uninstall Script
#  Menghapus: PM2, Node.js, pnpm, nginx config, app directory,
#             snapd
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

APP_DIR="${APP_DIR:-/var/www/app}"
APP_NAME="${APP_NAME:-app}"
NGINX_SITE="${NGINX_SITE:-$APP_NAME}"
REMOVE_NODE="${REMOVE_NODE:-true}"
REMOVE_NGINX="${REMOVE_NGINX:-false}"
REMOVE_SNAP="${REMOVE_SNAP:-true}"

print_step() { echo -e "\n${CYAN}${BOLD}==>${NC} $1"; }
print_ok()   { echo -e "  ${GREEN}✔${NC} $1"; }
print_warn() { echo -e "  ${YELLOW}⚠${NC}  $1"; }
print_err()  { echo -e "  ${RED}✘${NC} $1"; }

confirm() {
    read -rp "$(echo -e "${YELLOW}?${NC} $1 [y/N]: ")" answer
    [[ "$answer" =~ ^[Yy]$ ]]
}

echo -e "\n${BOLD}==============================${NC}"
echo -e "${BOLD}  VPS Full Uninstall Script   ${NC}"
echo -e "${BOLD}==============================${NC}"
echo -e "App Directory : ${CYAN}$APP_DIR${NC}"
echo -e "App Name      : ${CYAN}$APP_NAME${NC}"
echo -e "Nginx Site    : ${CYAN}$NGINX_SITE${NC}"
echo -e "Remove Node   : ${CYAN}$REMOVE_NODE${NC}"
echo -e "Remove Nginx  : ${CYAN}$REMOVE_NGINX${NC}"
echo -e "Remove Snap   : ${CYAN}$REMOVE_SNAP${NC}\n"

if ! confirm "Lanjutkan uninstall? Proses ini tidak bisa dibatalkan"; then
    echo -e "\n${YELLOW}Dibatalkan.${NC}"
    exit 0
fi

# ── 1. PM2 ──────────────────────────────────────────────────
print_step "Menghentikan dan menghapus proses PM2..."

if command -v pm2 &>/dev/null; then
    pm2 stop "$APP_NAME" 2>/dev/null && print_ok "PM2 process '$APP_NAME' dihentikan" || print_warn "Proses '$APP_NAME' tidak ditemukan atau sudah berhenti"
    pm2 delete "$APP_NAME" 2>/dev/null && print_ok "PM2 process '$APP_NAME' dihapus" || print_warn "Tidak ada proses '$APP_NAME' di registry"
    pm2 save --force 2>/dev/null && print_ok "PM2 state disimpan"
    pm2 unstartup 2>/dev/null || true
    print_ok "PM2 startup service dinonaktifkan"
else
    print_warn "PM2 tidak ditemukan, skip"
fi

# ── 2. App Directory ────────────────────────────────────────
print_step "Menghapus direktori aplikasi: ${APP_DIR}..."

if [ -d "$APP_DIR" ]; then
    rm -rf "$APP_DIR"
    print_ok "Direktori '$APP_DIR' berhasil dihapus"
else
    print_warn "Direktori '$APP_DIR' tidak ditemukan, skip"
fi

# ── 3. Nginx Config ─────────────────────────────────────────
print_step "Menghapus konfigurasi nginx..."

NGINX_AVAILABLE="/etc/nginx/sites-available/$NGINX_SITE"
NGINX_ENABLED="/etc/nginx/sites-enabled/$NGINX_SITE"

if [ -f "$NGINX_ENABLED" ]; then
    rm -f "$NGINX_ENABLED"
    print_ok "Symlink nginx dihapus: $NGINX_ENABLED"
else
    print_warn "Symlink nginx tidak ditemukan: $NGINX_ENABLED"
fi

if [ -f "$NGINX_AVAILABLE" ]; then
    rm -f "$NGINX_AVAILABLE"
    print_ok "Config nginx dihapus: $NGINX_AVAILABLE"
else
    print_warn "Config nginx tidak ditemukan: $NGINX_AVAILABLE"
fi

if command -v nginx &>/dev/null; then
    nginx -t 2>/dev/null && systemctl reload nginx && print_ok "Nginx berhasil direload" || print_warn "Gagal reload nginx, periksa config manual"
fi

# ── 4. PM2 Global Package ───────────────────────────────────
print_step "Menghapus PM2 global..."

if command -v pm2 &>/dev/null; then
    npm uninstall -g pm2 2>/dev/null && print_ok "PM2 global diuninstall" || print_warn "Gagal uninstall PM2"
else
    print_warn "PM2 tidak terinstall, skip"
fi

# ── 5. pnpm ─────────────────────────────────────────────────
print_step "Menghapus pnpm..."

if command -v pnpm &>/dev/null; then
    npm uninstall -g pnpm 2>/dev/null || corepack disable pnpm 2>/dev/null || true
    rm -rf ~/.local/share/pnpm ~/.pnpm-store ~/pnpm-lock.yaml 2>/dev/null || true
    print_ok "pnpm dihapus"
else
    print_warn "pnpm tidak terinstall, skip"
fi

# ── 6. Node.js & npm ────────────────────────────────────────
if [ "$REMOVE_NODE" = "true" ]; then
    print_step "Menghapus Node.js dan npm..."

    if command -v node &>/dev/null; then
        NODE_VERSION=$(node -v 2>/dev/null || echo "unknown")
        print_warn "Node.js terdeteksi: $NODE_VERSION"

        # NVM
        if [ -d "$HOME/.nvm" ]; then
            export NVM_DIR="$HOME/.nvm"
            # shellcheck disable=SC1091
            [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
            nvm deactivate 2>/dev/null || true
            rm -rf "$HOME/.nvm"
            sed -i '/NVM_DIR/d' "$HOME/.bashrc" "$HOME/.profile" "$HOME/.zshrc" 2>/dev/null || true
            print_ok "nvm dan Node.js dihapus"

        # NodeSource / apt
        elif command -v apt-get &>/dev/null && dpkg -l nodejs &>/dev/null 2>&1; then
            apt-get remove --purge -y nodejs npm 2>/dev/null && print_ok "nodejs dan npm dihapus via apt"
            apt-get autoremove -y 2>/dev/null || true

        # Manual install
        else
            NODE_BIN=$(which node)
            NPM_BIN=$(which npm)
            rm -f "$NODE_BIN" "$NPM_BIN" 2>/dev/null || true
            print_ok "Node.js binary dihapus secara manual"
        fi

        rm -rf "$HOME/.npm" "$HOME/.node_modules" /usr/local/lib/node_modules 2>/dev/null || true
        print_ok "Direktori npm global dibersihkan"
    else
        print_warn "Node.js tidak ditemukan, skip"
    fi
fi

# ── 7. Nginx (opsional) ─────────────────────────────────────
if [ "$REMOVE_NGINX" = "true" ]; then
    print_step "Menghapus nginx..."
    if command -v nginx &>/dev/null; then
        systemctl stop nginx 2>/dev/null || true
        apt-get remove --purge -y nginx nginx-common 2>/dev/null && print_ok "nginx dihapus" || print_warn "Gagal hapus nginx via apt"
        apt-get autoremove -y 2>/dev/null || true
        rm -rf /etc/nginx 2>/dev/null || true
    else
        print_warn "nginx tidak terinstall, skip"
    fi
fi

# ── 8. Snapd ────────────────────────────────────────────────
if [ "$REMOVE_SNAP" = "true" ]; then
    print_step "Menghapus snapd..."

    if command -v snap &>/dev/null; then
        SNAP_LIST=$(snap list 2>/dev/null | tail -n +2 | awk '{print $1}' || true)
        if [ -n "$SNAP_LIST" ]; then
            echo "$SNAP_LIST" | while read -r pkg; do
                snap remove --purge "$pkg" 2>/dev/null && print_ok "Snap package '$pkg' dihapus" || print_warn "Gagal hapus snap package: $pkg"
            done
        fi
        systemctl stop snapd 2>/dev/null || true
        systemctl disable snapd 2>/dev/null || true
        apt-get remove --purge -y snapd 2>/dev/null && print_ok "snapd dihapus via apt" || print_warn "Gagal hapus snapd via apt"
        apt-get autoremove -y 2>/dev/null || true
        rm -rf /snap /var/snap /var/lib/snapd /var/cache/snapd ~/snap 2>/dev/null || true
        cat > /etc/apt/preferences.d/nosnap.pref <<'EOF'
Package: snapd
Pin: release a=*
Pin-Priority: -10
EOF
        print_ok "snapd di-blacklist agar tidak ter-install ulang otomatis"
    else
        print_warn "snapd tidak terinstall, skip"
    fi
fi

# ── 9. Sisa log & temp files ────────────────────────────────
print_step "Membersihkan log dan file sementara..."

rm -rf "$HOME/.pm2/logs" "$HOME/.pm2/pids" 2>/dev/null || true
rm -rf /tmp/app-* /tmp/npm-* 2>/dev/null || true
print_ok "Log dan temp files dibersihkan"

# ── Done ────────────────────────────────────────────────────
echo -e "\n${GREEN}${BOLD}=============================="
echo -e "  Uninstall selesai! VPS bersih."
echo -e "==============================${NC}\n"
echo -e "Yang sudah dihapus:"
echo -e "  ${GREEN}✔${NC} PM2 processes & startup"
echo -e "  ${GREEN}✔${NC} App directory: $APP_DIR"
echo -e "  ${GREEN}✔${NC} Nginx site config: $NGINX_SITE"
echo -e "  ${GREEN}✔${NC} PM2 & pnpm global packages"
[ "$REMOVE_NODE" = "true" ] && echo -e "  ${GREEN}✔${NC} Node.js & npm"
[ "$REMOVE_NGINX" = "true" ] && echo -e "  ${GREEN}✔${NC} Nginx"
[ "$REMOVE_SNAP" = "true" ] && echo -e "  ${GREEN}✔${NC} Snapd (blacklisted agar tidak balik)"
echo ""
