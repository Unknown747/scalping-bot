# BASE Scalper

Bot scalping meme coin otomatis untuk **Base Network**. Dilengkapi AI filter (Gemini / OpenRouter), MEV protection berlapis (dRPC + Flashbots backup), security audit system, trailing stop canggih, multi-DEX, dan dashboard real-time berbasis web.

---

## Daftar Isi

1. [Fitur Utama](#fitur-utama)
2. [Keamanan — Baca Ini Dulu](#keamanan--baca-ini-dulu)
3. [Tutorial Install VPS — Docker](#tutorial-install-vps--docker)
4. [Tutorial Install VPS — Manual / PM2](#tutorial-install-vps--manual--pm2)
5. [Environment Variables](#environment-variables)
6. [MEV Protection](#mev-protection)
7. [Cara Pakai Dashboard](#cara-pakai-dashboard)
8. [Arsitektur & Stack](#arsitektur--stack)
9. [Development di Replit](#development-di-replit)
10. [Troubleshooting](#troubleshooting)

---

## Fitur Utama

| Fitur | Keterangan |
|---|---|
| **Bot Scalping Otomatis** | Scan token baru Base Network tiap 8 detik via DexScreener + GeckoTerminal |
| **AI Filter** | Gemini 2.5 Flash → Groq/Llama → HuggingFace — validasi setiap entry sebelum beli |
| **Safety Check** | GoPlus Labs: honeypot detection, sell tax, renounce ownership, deployer check |
| **MEV Protection Berlapis** | dRPC MEV Blocker (primary) → Flashbots (backup) — anti sandwich attack |
| **MEV Tracking** | Trade History: badge MEV per transaksi, % terlindungi, P&L per jalur |
| **Security Audit** | 7 check keamanan otomatis — bot diblokir masuk live mode jika gagal |
| **Trailing Stop** | Aktif setelah profit minimum, mengunci keuntungan terkunci |
| **Multi-DEX** | Uniswap V3, Aerodrome, BaseSwap — otomatis pilih fee tier terbaik |
| **TP Bertahap** | TP1 / TP2 / TP3 dengan persentase jual berbeda |
| **TWAP Execution** | Pecah order besar jadi beberapa slice |
| **Telegram Notifikasi** | Alert buy / sell / stop-loss ke Telegram |
| **Dashboard Real-time** | WebSocket, format IDR, live P&L, log bot, posisi aktif |
| **Paper Trading** | Mode simulasi tanpa dana nyata untuk testing |
| **Semua Setting dari Web** | Tidak perlu edit file — semua konfigurasi dari Settings panel |

---

## Keamanan — Baca Ini Dulu

> ⚠️ **Pelajaran penting:** Private key yang disimpan di kode atau file yang ter-commit ke GitHub bisa langsung terbaca bot drainer. Gunakan selalu environment variables / file `.env` yang tidak di-commit.

### Praktik Keamanan yang Diterapkan

- `PRIVATE_KEY` tidak pernah dikirim ke frontend — hanya dipakai di server untuk sign transaksi
- Session cookie: `httpOnly`, `secure` (production), TTL 7 hari
- Semua route API dilindungi session authentication — 401 jika belum login
- Tab **🔑 Secrets** di dashboard hanya tampilkan nilai ter-mask (4 karakter + bintang)
- Security Audit System — bot diblokir masuk live mode jika ada konfigurasi kritis salah
- MEV Protection berlapis: dRPC → Flashbots backup → standard RPC
- File `.env` dan `*.db` ada di `.gitignore` — tidak akan pernah masuk ke repository

### Checklist Sebelum Go-Live

- [ ] Buat **wallet baru** khusus untuk bot — jangan pakai wallet utama
- [ ] Set `SESSION_SECRET` dengan nilai acak ≥ 32 karakter (`openssl rand -hex 32`)
- [ ] Ganti `DASHBOARD_PASSWORD` dari nilai default
- [ ] Gunakan RPC berbayar dari Alchemy atau Infura (bukan public RPC)
- [ ] Set `MEV_PROTECTION_RPC=https://mev-blocker.drpc.org`
- [ ] Set `MEV_PROTECTION_RPC_BACKUP=https://rpc.flashbots.net/fast`
- [ ] Pastikan `PRIVATE_KEY` hanya ada di `.env` — tidak di tempat lain
- [ ] Cek endpoint `/api/security-audit` — semua critical check harus passed
- [ ] Test Paper mode minimal 24 jam sebelum switch ke Live

---

## Tutorial Install VPS — Docker

> **Rekomendasi.** Docker menangani semua dependency, isolasi, restart otomatis, dan manajemen data. Cocok untuk siapapun.

### Spesifikasi VPS Minimum

| Komponen | Minimum | Rekomendasi |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Storage | 10 GB | 20 GB |
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| Network | 100 Mbps | 1 Gbps |

Provider yang bagus: **Contabo**, **Hetzner**, **DigitalOcean**, **Vultr**, **Linode**.

---

### Langkah 1 — Siapkan Server

Login ke VPS via SSH:

```bash
ssh root@IP_VPS_KAMU
```

Update sistem dan buat user non-root (opsional tapi direkomendasikan):

```bash
# Update
apt update && apt upgrade -y

# Buat user baru (opsional)
adduser scalper
usermod -aG sudo scalper
su - scalper
```

---

### Langkah 2 — Install Docker

```bash
# Install Docker via script resmi
curl -fsSL https://get.docker.com | sh

# Tambahkan user ke grup docker (agar tidak perlu sudo tiap kali)
sudo usermod -aG docker $USER

# Aktifkan perubahan grup (atau logout dan login ulang)
newgrp docker

# Verifikasi Docker berjalan
docker --version
docker compose version
```

Contoh output yang benar:
```
Docker version 27.x.x, build xxxxx
Docker Compose version v2.x.x
```

---

### Langkah 3 — Clone Repository

```bash
# Clone repo
git clone https://github.com/YOUR_USERNAME/base-scalper.git
cd base-scalper
```

---

### Langkah 4 — Buat File `.env`

```bash
# Salin template
cp artifacts/api-server/.env.example artifacts/api-server/.env

# Edit dengan nano (atau vim jika kamu familiar)
nano artifacts/api-server/.env
```

Isi nilai-nilai berikut di dalam file `.env`:

```env
# ── Server ───────────────────────────────────────────────────────────────────
PORT=8080
NODE_ENV=production

# ── Auth (WAJIB — generate dulu!) ────────────────────────────────────────────
# Jalankan: openssl rand -hex 32
SESSION_SECRET=HASIL_OPENSSL_RAND_HEX_32_DISINI
DASHBOARD_PASSWORD=password_kuat_kamu

# ── Wallet (WAJIB untuk live trading) ────────────────────────────────────────
# GUNAKAN WALLET BARU KHUSUS BOT — bukan wallet utama kamu!
PRIVATE_KEY=0xPRIVATE_KEY_WALLET_BOT_KAMU
WALLET_ADDRESS=0xALAMAT_WALLET_BOT_KAMU

# ── RPC ──────────────────────────────────────────────────────────────────────
# Daftar gratis di https://alchemy.com → buat app → copy Base Mainnet URL
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY

# ── MEV Protection ───────────────────────────────────────────────────────────
MEV_PROTECTION_RPC=https://mev-blocker.drpc.org
MEV_PROTECTION_RPC_BACKUP=https://rpc.flashbots.net/fast

# ── AI Filter (opsional) ─────────────────────────────────────────────────────
# Daftar di https://aistudio.google.com/app/apikey → copy API key
AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com
AI_INTEGRATIONS_GEMINI_API_KEY=AIza_YOUR_GEMINI_KEY
```

Cara generate `SESSION_SECRET`:
```bash
openssl rand -hex 32
# Output contoh: a3f8c2b14d9e7f06a1b5c8d3e2f4a9b7c6d1e0f3a8b5c2d9e6f1a4b7c0d3e8f2
```

Simpan dan keluar dari nano: `Ctrl+X` → `Y` → `Enter`

---

### Langkah 5 — Setup Firewall

```bash
# Aktifkan UFW (Uncomplicated Firewall)
sudo ufw enable

# Izinkan SSH agar tidak terkunci
sudo ufw allow ssh

# Izinkan port dashboard (port 80)
sudo ufw allow 80/tcp

# Port API (8080) — opsional, hanya jika mau akses API langsung
# sudo ufw allow 8080/tcp

# Cek status
sudo ufw status
```

---

### Langkah 6 — Build dan Jalankan

```bash
# Build image dan jalankan semua container
docker compose up -d --build
```

Proses build pertama membutuhkan waktu 3–10 menit (unduh dependency, compile TypeScript, build React).

Setelah selesai, cek status:

```bash
# Lihat semua container
docker compose ps

# Output yang diharapkan:
# NAME                STATUS          PORTS
# base-scalper-api-1          Up (healthy)    0.0.0.0:8080->8080/tcp
# base-scalper-dashboard-1    Up              0.0.0.0:80->80/tcp
```

---

### Langkah 7 — Verifikasi Bot Berjalan

```bash
# Test API health
curl http://localhost:8080/api/healthz
# Output: {"status":"ok","uptime":...}

# Cek security audit (semua harus "passed": true)
curl http://localhost:8080/api/security-audit | python3 -m json.tool

# Lihat log bot secara live
docker compose logs -f api
```

Buka browser dan akses:
- **Dashboard:** `http://IP_VPS_KAMU`
- **API:** `http://IP_VPS_KAMU:8080/api/healthz`

Login dengan `DASHBOARD_PASSWORD` yang sudah kamu set.

---

### Langkah 8 — Jalankan Bot

1. Buka `http://IP_VPS_KAMU` di browser
2. Login dengan password kamu
3. Cek **Security Audit** — semua item harus ✅
4. Cek **Settings → 🔑 Secrets** — `PRIVATE_KEY` dan `WALLET_ADDRESS` harus ✅
5. Mulai dengan **Paper mode** untuk testing
6. Jika sudah yakin → **Settings → Trading → Mode → LIVE** → **START BOT**

---

### Perintah Docker yang Sering Dipakai

```bash
# Lihat log real-time (Ctrl+C untuk stop)
docker compose logs -f api
docker compose logs -f dashboard

# Restart bot saja (tanpa rebuild)
docker compose restart api

# Stop semua container
docker compose stop

# Start ulang semua container
docker compose start

# Stop dan hapus container (data SQLite tetap aman di volume)
docker compose down

# Update ke versi terbaru
git pull && docker compose up -d --build

# Cek penggunaan resource
docker stats
```

---

### Backup Database

Data trading (SQLite) disimpan di Docker volume `scalping_data` — aman saat rebuild. Untuk backup manual:

```bash
# Backup ke file tar.gz dengan timestamp
docker run --rm \
  -v scalping_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/scalping-backup-$(date +%Y%m%d-%H%M).tar.gz /data

# Restore dari backup
docker run --rm \
  -v scalping_data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/scalping-backup-YYYYMMDD-HHMM.tar.gz -C /
```

---

## Tutorial Install VPS — Manual / PM2

> Pilih cara ini jika tidak mau pakai Docker, atau jika kamu ingin lebih banyak kontrol atas proses.

### Langkah 1 — Install Node.js 22+ dan pnpm

```bash
# Install Node.js via nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Reload terminal
source ~/.bashrc

# Install Node.js 22 LTS
nvm install 22
nvm use 22
nvm alias default 22

# Verifikasi
node --version   # v22.x.x
npm --version

# Install pnpm
npm install -g pnpm

# Install PM2 (process manager)
npm install -g pm2
```

---

### Langkah 2 — Install Build Tools untuk better-sqlite3

```bash
# Dependency native compile
sudo apt install -y python3 make g++ libsqlite3-dev
```

---

### Langkah 3 — Clone dan Install

```bash
git clone https://github.com/YOUR_USERNAME/base-scalper.git
cd base-scalper
pnpm install
```

Jika ada error saat install `better-sqlite3`:
```bash
pnpm install --force
# atau
cd node_modules/.pnpm/better-sqlite3*/node_modules/better-sqlite3 && npm run build-release
```

---

### Langkah 4 — Buat File `.env`

```bash
cp artifacts/api-server/.env.example artifacts/api-server/.env
nano artifacts/api-server/.env
# Isi semua nilai seperti di bagian Docker di atas
```

---

### Langkah 5 — Build Semua Package

```bash
# Build API server
pnpm --filter @workspace/api-server run build

# Build dashboard (BASE_PATH=/ untuk production)
BASE_PATH=/ PORT=80 pnpm --filter @workspace/scalping-dashboard run build
```

---

### Langkah 6 — Jalankan dengan PM2

Buat file `ecosystem.config.cjs` (jangan commit file ini ke git):

```bash
nano ecosystem.config.cjs
```

Isi:
```js
module.exports = {
  apps: [
    {
      name: "scalper-api",
      script: "./artifacts/api-server/dist/index.mjs",
      node_args: "--enable-source-maps",
      env_file: "./artifacts/api-server/.env",
      restart_delay: 3000,
      max_restarts: 10,
      watch: false,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
```

Jalankan:
```bash
# Start bot
pm2 start ecosystem.config.cjs

# Lihat log
pm2 logs scalper-api

# Status
pm2 status

# Set auto-start saat VPS reboot
pm2 save
pm2 startup
# Jalankan perintah yang muncul dari output pm2 startup
```

---

### Langkah 7 — Install dan Konfigurasi Nginx

```bash
sudo apt install -y nginx

# Buat config Nginx
sudo nano /etc/nginx/sites-available/scalper
```

Isi file config:
```nginx
server {
    listen 80;
    server_name IP_VPS_ATAU_DOMAIN_KAMU;

    # Serve dashboard (React SPA)
    root /home/USERMU/base-scalper/artifacts/scalping-dashboard/dist/public;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 1024;

    # SPA routing — semua route ke index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy REST API ke bot
    location /api/ {
        proxy_pass http://localhost:8080/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
    }

    # WebSocket proxy untuk Socket.io (WAJIB untuk real-time dashboard)
    location /socket.io/ {
        proxy_pass http://localhost:8080/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400s;
    }
}
```

Aktifkan dan test:
```bash
# Aktifkan site
sudo ln -s /etc/nginx/sites-available/scalper /etc/nginx/sites-enabled/

# Hapus default site (opsional)
sudo rm /etc/nginx/sites-enabled/default

# Test config
sudo nginx -t
# Output: syntax is ok / test is successful

# Reload nginx
sudo systemctl reload nginx

# Auto-start nginx saat boot
sudo systemctl enable nginx
```

---

### Langkah 8 — Setup Firewall

```bash
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw status
```

---

### Perintah PM2 yang Sering Dipakai

```bash
pm2 status                    # Lihat status semua process
pm2 logs scalper-api          # Lihat log real-time
pm2 logs scalper-api --lines 100  # Lihat 100 baris log terakhir
pm2 restart scalper-api       # Restart bot
pm2 stop scalper-api          # Stop bot
pm2 start scalper-api         # Start bot
pm2 delete scalper-api        # Hapus dari PM2
pm2 monit                     # Monitor CPU & RAM real-time
```

### Update ke Versi Terbaru (Manual)

```bash
cd base-scalper
git pull
pnpm install
pnpm --filter @workspace/api-server run build
BASE_PATH=/ PORT=80 pnpm --filter @workspace/scalping-dashboard run build
pm2 restart scalper-api
sudo systemctl reload nginx  # jika ada perubahan config nginx
```

---

## Environment Variables

| Variable | Wajib | Default | Keterangan |
|---|---|---|---|
| `PORT` | Ya | — | Port API server (8080) |
| `NODE_ENV` | Ya | `development` | Set ke `production` di VPS |
| `SESSION_SECRET` | **Ya** | — | String acak ≥ 32 karakter |
| `DASHBOARD_PASSWORD` | Ya | `scalper2024` | Password login — **wajib ganti!** |
| `PRIVATE_KEY` | Live only | — | Private key wallet Base Network |
| `WALLET_ADDRESS` | Live only | — | Alamat wallet Base Network |
| `BASE_RPC_URL` | Opsional | `mainnet.base.org` | RPC Base — gunakan Alchemy/Infura |
| `MEV_PROTECTION_RPC` | Opsional | `mev-blocker.drpc.org` | MEV primary (dRPC) |
| `MEV_PROTECTION_RPC_BACKUP` | Opsional | `rpc.flashbots.net/fast` | MEV backup (Flashbots) |
| `SQLITE_PATH` | Opsional | `./scalping.db` | Path database SQLite |
| `AI_INTEGRATIONS_GEMINI_BASE_URL` | Opsional | — | Base URL Gemini |
| `AI_INTEGRATIONS_GEMINI_API_KEY` | Opsional | — | API key Gemini |
| `AI_INTEGRATIONS_OPENROUTER_BASE_URL` | Opsional | — | Base URL OpenRouter |
| `AI_INTEGRATIONS_OPENROUTER_API_KEY` | Opsional | — | API key OpenRouter |
| `TELEGRAM_BOT_TOKEN` | Opsional | — | Token bot Telegram |
| `TELEGRAM_CHAT_ID` | Opsional | — | Chat ID Telegram |
| `LOG_LEVEL` | Opsional | `info` | `debug` / `info` / `warn` / `error` |

---

## MEV Protection

Bot menggunakan sistem MEV protection berlapis untuk melindungi semua transaksi swap dari sandwich attack dan front-running.

### Urutan Fallback

```
Transaksi Swap
     │
     ▼
┌─────────────────────────────┐
│  1. dRPC MEV Blocker        │  https://mev-blocker.drpc.org
│     (primary)               │  ← Bundle private, tidak masuk mempool publik
└─────────────┬───────────────┘
              │ gagal / timeout
              ▼
┌─────────────────────────────┐
│  2. Flashbots               │  https://rpc.flashbots.net/fast
│     (backup MEV)            │  ← MEV protection tetap aktif, badge ✓ MEV
└─────────────┬───────────────┘
              │ gagal / timeout
              ▼
┌─────────────────────────────┐
│  3. BASE_RPC_URL            │  Alchemy / Infura kamu
│     (standard RPC)          │  ← Tidak ada MEV protection, badge — STD
└─────────────┬───────────────┘
              │ gagal
              ▼
┌─────────────────────────────┐
│  4. Public RPCs             │  mainnet.base.org, dll
│     (last resort)           │  ← Paling lambat, tidak ada MEV protection
└─────────────────────────────┘
```

### Cara Cek Status MEV di Dashboard

- **Trade History** — setiap baris trade punya badge:
  - `✓ MEV` (hijau) — transaksi masuk via dRPC atau Flashbots, terlindungi
  - `— STD` (abu-abu) — transaksi via RPC standar, tidak terlindungi
- **Ringkasan bar** di atas tabel — persentase trade terlindungi MEV
- **Bot Log** — setiap transaksi mencatat jalur RPC yang dipakai

### Cara Cek di Log Bot

```
INFO: MEV protection active — dRPC MEV Blocker (primary)   ← dRPC aktif ✓
WARN: MEV protection active — Flashbots (backup, primary down)  ← Flashbots backup ✓
WARN: MEV protection unavailable — both MEV RPCs down, using standard RPC  ← tidak terlindungi
```

---

## Cara Pakai Dashboard

### Login
Buka `http://IP_VPS` → masukkan `DASHBOARD_PASSWORD`

### Panel Utama

| Panel | Keterangan |
|---|---|
| **Control Panel** | START / STOP bot, pilih risk level, Emergency Stop |
| **Security Audit** | Status 7 check keamanan — harus semua ✅ sebelum live |
| **Wallet** | Saldo ETH real-time, harga ETH, nilai IDR |
| **Posisi Aktif** | Posisi terbuka, P&L live, tombol close manual |
| **Token Scanner** | Token yang baru di-scan beserta skornya |
| **Trade History** | Riwayat trade + status MEV per transaksi + export CSV |
| **P&L Chart** | Grafik profit/loss harian |
| **AI Decision Log** | Log keputusan AI filter per token |
| **Bot Log** | Log real-time semua aktivitas |

### Settings Panel

| Tab | Isi |
|---|---|
| **Optim** | Dynamic Sizing, Break-Even Stop, TWAP, Multi-DEX, Auto-Compound |
| **Trading** | Mode (Live/Paper), TP1/TP2/TP3, Stop Loss, Trailing Stop, Anti-FOMO |
| **Safety** | Min Safety Score, Max Sell Tax, filter likuiditas & volume |
| **AI** | Toggle AI Filter, provider (Gemini/Groq/HF), min confidence |
| **Telegram** | Bot token + Chat ID |
| **RPC/Gas** | Gas price, slippage, TWAP interval |
| **Secrets** | Status semua env var — ✅/❌, nilai ter-mask |

### Switch ke Live Trading

1. Cek panel **Security Audit** — semua item harus ✅
2. Cek **Settings → 🔑 Secrets** — `PRIVATE_KEY` dan `WALLET_ADDRESS` harus ✅
3. **Settings → Trading → Mode → LIVE (Mainnet)**
4. **START BOT**

> Bot tidak bisa masuk live mode jika Security Audit melaporkan kegagalan kritis.

---

## Arsitektur & Stack

```
┌─────────────────────────────┐
│   Dashboard (React + Vite)  │  port 80
│   Tailwind + Framer Motion  │
└──────────┬──────────────────┘
           │ REST + WebSocket (Socket.io)
┌──────────▼──────────────────┐
│   API Server (Express 5)    │  port 8080
│   Session Auth + Socket.io  │
│                             │
│  ┌──────────────────────┐   │
│  │   ScalpingBot.ts     │   │
│  │  ┌────────────────┐  │   │
│  │  │ TokenScanner   │──│───── DexScreener / GeckoTerminal
│  │  │ SafetyChecker  │──│───── GoPlus Labs API
│  │  │ AIAnalyzer     │──│───── Gemini / OpenRouter
│  │  │ SwapExecutor   │──│───── Uniswap V3 + dRPC / Flashbots
│  │  │ PriceMonitor   │──│───── DexScreener prices
│  │  │ SecurityAudit  │  │
│  │  └────────────────┘  │   │
│  └──────────────────────┘   │
│                             │
│  SQLite (better-sqlite3)    │
└─────────────────────────────┘
```

**Stack:**
- Node.js 24, TypeScript 5.9, pnpm workspaces
- Express 5 + Socket.io (same HTTP server)
- SQLite via `better-sqlite3`
- React 19 + Vite 7 + Tailwind CSS + Framer Motion
- Zod validation, Orval codegen dari OpenAPI spec
- esbuild (ESM bundle API), Docker multi-stage + nginx

---

## Development di Replit

```bash
# Install dependencies
pnpm install

# Jalankan API server (port 8080)
pnpm --filter @workspace/api-server run dev

# Jalankan dashboard (port 18432)
pnpm --filter @workspace/scalping-dashboard run dev

# Build API untuk produksi
pnpm --filter @workspace/api-server run build

# Build dashboard untuk produksi
BASE_PATH=/ PORT=80 pnpm --filter @workspace/scalping-dashboard run build

# Typecheck
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/scalping-dashboard run typecheck

# Regenerate API hooks dari OpenAPI spec
pnpm --filter @workspace/api-spec run codegen
```

**Set secrets di Replit → Tools → Secrets:**

| Secret | Nilai |
|---|---|
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `DASHBOARD_PASSWORD` | password kuat |
| `PRIVATE_KEY` | private key wallet baru (bukan wallet utama!) |
| `WALLET_ADDRESS` | alamat wallet |
| `BASE_RPC_URL` | URL dari Alchemy/Infura |

AI keys (Gemini, OpenRouter) di-set otomatis via Replit AI Integrations.

---

## Troubleshooting

### Container tidak mau start

```bash
docker compose logs api
# Cek apakah SESSION_SECRET ada di .env
# Cek format PRIVATE_KEY (harus 0x + 64 karakter hex)
# Cek BASE_RPC_URL bisa diakses
```

### Security audit gagal

```bash
curl http://localhost:8080/api/security-audit | python3 -m json.tool
# Baca pesan "message" di setiap check yang "passed": false
# Ikuti langkah perbaikan yang tertera
```

### Dashboard tidak bisa connect ke API

```bash
# Cek container jalan
docker compose ps

# Cek firewall
sudo ufw status
sudo ufw allow 80/tcp

# Test API langsung dari VPS
curl http://localhost:8080/api/healthz
```

### Bot jalan tapi tidak ada trade

- Cek **Bot Log** di dashboard — lihat pesan warn / error
- Test koneksi RPC:
  ```bash
  # Ganti URL dengan BASE_RPC_URL kamu
  curl -X POST https://base-mainnet.g.alchemy.com/v2/YOUR_KEY \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
  ```
- Cek `minSafetyScore`, `minMemeScore`, `min5mVolumeUsd` di Settings — mungkin terlalu ketat untuk kondisi pasar saat ini

### Swap gagal / transaksi error

- Cek saldo ETH wallet cukup untuk gas (minimal 0.01 ETH untuk beberapa trade)
- Naikkan `maxPriorityFeeGwei` dan `maxFeePerGasGwei` di Settings → RPC/Gas
- Pastikan `PRIVATE_KEY` dan `WALLET_ADDRESS` sesuai

### `better-sqlite3` native build error (manual install)

```bash
sudo apt install -y python3 make g++ libsqlite3-dev
pnpm install --force
```

### AI Filter tidak jalan

- Cek tab **🔑 Secrets** — `AI_INTEGRATIONS_GEMINI_API_KEY` harus ✅
- Jika semua AI key kosong, bot tetap jalan tanpa AI filter
- Cek log untuk pesan `AI [Gemini]` atau `AI filter error`

### Dashboard tidak bisa akses setelah update

```bash
# Docker
docker compose up -d --build

# Manual — rebuild dashboard
BASE_PATH=/ PORT=80 pnpm --filter @workspace/scalping-dashboard run build
sudo systemctl reload nginx
```

---

## Struktur File

```
base-scalper/
├── artifacts/
│   ├── api-server/
│   │   ├── src/scalping/
│   │   │   ├── ScalpingBot.ts       # Orchestrator utama
│   │   │   ├── RpcProvider.ts       # MEV fallback chain
│   │   │   ├── SecurityAudit.ts     # 7 security checks
│   │   │   ├── SwapExecutor.ts      # Uniswap V3 + MEV
│   │   │   ├── AIAnalyzer.ts        # Gemini / OpenRouter
│   │   │   ├── SafetyChecker.ts     # GoPlus honeypot
│   │   │   ├── TokenScanner.ts      # DexScreener scanner
│   │   │   ├── PriceMonitor.ts      # Real-time price
│   │   │   ├── database.ts          # SQLite + migrasi
│   │   │   └── config.ts            # Config type + defaults
│   │   ├── .env.example             # Template env vars
│   │   └── Dockerfile
│   └── scalping-dashboard/
│       ├── src/components/
│       │   ├── TradeHistory.tsx      # + MEV tracking
│       │   ├── SecurityAuditCard.tsx
│       │   ├── ControlPanel.tsx
│       │   └── FullSettingsPanel.tsx
│       └── Dockerfile
├── lib/api-spec/openapi.yaml         # OpenAPI spec
├── docker-compose.yml                # Deploy Docker
├── .gitignore                        # Secrets + DB dikecualikan
└── README.md
```
