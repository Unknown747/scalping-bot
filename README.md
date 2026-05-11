# BASE Scalper

Bot scalping meme coin otomatis untuk Base Network. Dilengkapi AI filter (Gemini / Groq / HuggingFace), trailing stop canggih, multi-DEX router, dan dashboard real-time berbasis web.

---

## Daftar Isi

1. [Fitur Utama](#fitur-utama)
2. [Install di VPS (Docker)](#install-di-vps-docker)
3. [Install di VPS (Manual / PM2)](#install-di-vps-manual--pm2)
4. [Konfigurasi Environment Variables](#konfigurasi-environment-variables)
5. [Cara Pakai Dashboard](#cara-pakai-dashboard)
6. [Arsitektur & Stack](#arsitektur--stack)
7. [Development (Replit / Lokal)](#development-replit--lokal)
8. [Keamanan](#keamanan)
9. [Troubleshooting](#troubleshooting)

---

## Fitur Utama

- **Bot Scalping Otomatis** — scan token baru Base Network tiap 8 detik via DexScreener + GeckoTerminal
- **AI Filter** — Gemini 2.5 Flash (utama) → Groq/Llama (fallback) → HuggingFace (fallback 2) untuk validasi entry
- **Safety Check** — GoPlus Labs honeypot detection, sell tax, ownership check, deployer reputation
- **Trailing Stop Canggih** — aktif hanya setelah profit minimum, mengunci profit minimum terkunci
- **Multi-DEX** — Uniswap V3, Aerodrome, BaseSwap
- **TP Bertahap** — TP1 / TP2 / TP3 dengan persentase jual berbeda
- **Telegram Notifikasi** — alert buy/sell/stop-loss ke grup Telegram
- **Dashboard Real-time** — WebSocket, format IDR, live P&L, log bot
- **Semua Setting dari Web** — tidak perlu edit file config, semua bisa diatur dari Settings panel

---

## Install di VPS (Docker)

Cara paling mudah dan direkomendasikan. Butuh: **Ubuntu 22.04+**, **Docker**, **Docker Compose**.

### 1. Siapkan VPS

```bash
# Update sistem
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Verifikasi
docker --version && docker compose version
```

### 2. Clone Repo

```bash
git clone https://github.com/YOUR_USERNAME/base-scalper.git
cd base-scalper
```

### 3. Buat File `.env`

```bash
cp artifacts/api-server/.env.example artifacts/api-server/.env
nano artifacts/api-server/.env
```

Isi nilai berikut (wajib):

```env
PORT=8080
NODE_ENV=production

# Auth (WAJIB — ganti sebelum deploy!)
SESSION_SECRET=isi_dengan_string_acak_minimal_64_karakter
DASHBOARD_PASSWORD=password_dashboard_kamu

# Wallet (WAJIB untuk live trading)
PRIVATE_KEY=0x_kunci_privat_wallet_kamu
WALLET_ADDRESS=0x_alamat_wallet_kamu

# RPC — gunakan Alchemy/Infura untuk produksi, bukan public RPC
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
MEV_PROTECTION_RPC=https://rpc.flashbots.net/fast

# AI Filter (opsional — lihat bagian AI Keys di bawah)
AI_INTEGRATIONS_GEMINI_BASE_URL=https://api.replit.com/v1/ai/gemini
AI_INTEGRATIONS_GEMINI_API_KEY=your_key
AI_INTEGRATIONS_OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
AI_INTEGRATIONS_OPENROUTER_API_KEY=your_key
```

> **Cara generate SESSION_SECRET:**
> ```bash
> openssl rand -base64 48
> ```

### 4. Build dan Jalankan

```bash
docker compose up -d --build
```

Bot dan dashboard akan berjalan otomatis. Akses:

- **Dashboard:** `http://IP_VPS` (port 80)
- **API:** `http://IP_VPS:8080`

### 5. Cek Status

```bash
# Lihat semua container
docker compose ps

# Log API (bot)
docker compose logs -f api

# Log dashboard
docker compose logs -f dashboard
```

### 6. Update ke Versi Terbaru

```bash
git pull
docker compose up -d --build
```

### 7. Stop / Restart

```bash
docker compose stop       # stop semua
docker compose restart    # restart semua
docker compose down       # stop + hapus container (data tetap aman di volume)
```

> Data trading (SQLite) disimpan di Docker volume `scalping_data` — aman saat container di-restart atau di-rebuild.

---

## Install di VPS (Manual / PM2)

Jika tidak mau pakai Docker.

### 1. Install Node.js 22+ dan pnpm

```bash
# Install Node.js via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22 && nvm use 22

# Install pnpm
npm install -g pnpm

# Install PM2 (process manager)
npm install -g pm2
```

### 2. Clone dan Install Dependencies

```bash
git clone https://github.com/YOUR_USERNAME/base-scalper.git
cd base-scalper
pnpm install
```

> **Catatan:** `better-sqlite3` butuh native compile. Jika ada error:
> ```bash
> sudo apt install -y python3 make g++
> pnpm install --force
> ```

### 3. Build API Server

```bash
pnpm --filter @workspace/api-server run build
```

### 4. Build Dashboard

```bash
pnpm --filter @workspace/scalping-dashboard run build
```

### 5. Buat File `.env`

```bash
cp artifacts/api-server/.env.example artifacts/api-server/.env
nano artifacts/api-server/.env
# Isi semua nilai seperti di bagian Docker di atas
```

### 6. Jalankan dengan PM2

```bash
# Jalankan API server
pm2 start artifacts/api-server/dist/index.mjs \
  --name "scalper-api" \
  --node-args "--enable-source-maps" \
  --env production

# Baca env dari file
pm2 start artifacts/api-server/dist/index.mjs \
  --name "scalper-api" \
  --node-args "--enable-source-maps" \
  -- --env-file artifacts/api-server/.env

# Atau gunakan ecosystem file (lihat di bawah)
```

**Alternatif: PM2 Ecosystem File**

Buat file `ecosystem.config.cjs`:

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
    },
  ],
};
```

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # auto-start saat reboot
```

### 7. Serve Dashboard (Nginx)

```bash
sudo apt install -y nginx

sudo nano /etc/nginx/sites-available/scalper
```

```nginx
server {
    listen 80;
    server_name IP_VPS_ATAU_DOMAIN;

    root /path/to/base-scalper/artifacts/scalping-dashboard/dist;
    index index.html;

    # SPA routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy ke API
    location /api/ {
        proxy_pass http://localhost:8080/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # WebSocket (Socket.io)
    location /socket.io/ {
        proxy_pass http://localhost:8080/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/scalper /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## Konfigurasi Environment Variables

| Variable | Wajib | Default | Keterangan |
|---|---|---|---|
| `PORT` | Ya | — | Port API server |
| `NODE_ENV` | Ya | `development` | Set ke `production` di VPS |
| `SESSION_SECRET` | **Ya** | — | String acak ≥64 karakter untuk enkripsi session |
| `DASHBOARD_PASSWORD` | Ya | `scalper2024` | Password login dashboard — **wajib ganti!** |
| `PRIVATE_KEY` | Live only | — | Private key wallet Base Network (0x...) |
| `WALLET_ADDRESS` | Live only | — | Alamat wallet Base Network (0x...) |
| `BASE_RPC_URL` | Opsional | `mainnet.base.org` | RPC Base — gunakan Alchemy/Infura untuk produksi |
| `MEV_PROTECTION_RPC` | Opsional | sama dengan BASE_RPC_URL | Flashbots/Beaverbuild untuk anti-sandwich |
| `SQLITE_PATH` | Opsional | `./scalping.db` | Path file database SQLite |
| `AI_INTEGRATIONS_GEMINI_BASE_URL` | Opsional | — | Base URL Gemini (auto di Replit) |
| `AI_INTEGRATIONS_GEMINI_API_KEY` | Opsional | — | API key Gemini (auto di Replit) |
| `AI_INTEGRATIONS_OPENROUTER_BASE_URL` | Opsional | — | Base URL OpenRouter |
| `AI_INTEGRATIONS_OPENROUTER_API_KEY` | Opsional | — | API key OpenRouter (untuk Groq + HuggingFace) |
| `LOG_LEVEL` | Opsional | `info` | Level log: `debug`, `info`, `warn`, `error` |

### Cara Dapat AI Keys untuk VPS

**Gemini (via Replit AI Integrations):**
Di Replit, key di-set otomatis. Untuk VPS, buat Google AI Studio key di [aistudio.google.com](https://aistudio.google.com) dan set:
```
AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_INTEGRATIONS_GEMINI_API_KEY=AIza...
```

**OpenRouter (untuk Groq + HuggingFace fallback):**
Daftar di [openrouter.ai](https://openrouter.ai), buat API key, lalu:
```
AI_INTEGRATIONS_OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
AI_INTEGRATIONS_OPENROUTER_API_KEY=sk-or-...
```

### Rekomendasi RPC

| Provider | URL | Kecepatan | Harga |
|---|---|---|---|
| Public Base | `https://mainnet.base.org` | Lambat | Gratis |
| **Alchemy** | `https://base-mainnet.g.alchemy.com/v2/KEY` | Cepat | Free tier ada |
| **Infura** | `https://base-mainnet.infura.io/v3/KEY` | Cepat | Free tier ada |
| Flashbots (MEV) | `https://rpc.flashbots.net/fast` | Medium | Gratis |
| Beaverbuild (MEV) | `https://rpc.beaverbuild.org` | Cepat | Gratis |

---

## Cara Pakai Dashboard

### Login
Buka `http://IP_VPS` → masukkan `DASHBOARD_PASSWORD`

### Panel Utama
- **Control Panel** — START / STOP bot, pilih risk level (Low/Mid/High), Emergency Stop
- **Wallet** — saldo ETH real-time, harga ETH, nilai IDR
- **Posisi Aktif** — posisi yang sedang terbuka, P&L live, tombol close manual
- **Bot Log** — log real-time semua aktivitas bot

### Settings (klik ikon settings)

| Tab | Isi |
|---|---|
| **Optim** | Toggle fitur: Dynamic Sizing, Break-Even Stop, TWAP, Multi-DEX, dll |
| **Trading** | Mode (Live/Paper), TP1/TP2/TP3, Stop Loss, Trailing Stop, Anti-FOMO |
| **Safety** | Min Safety Score, Max Sell Tax, Filter likuiditas & volume |
| **🤖 AI** | Toggle AI Filter, pilih provider (Gemini/Groq/HF), min confidence |
| **Telegram** | Bot token + Chat ID untuk notifikasi |
| **RPC/Gas** | Gas price, slippage, TWAP interval |
| **🔑 Secrets** | Status semua env var — ✅/❌ per secret, panduan cara set di VPS |

### Switch ke Live Trading
1. Pastikan **Settings → 🔑 Secrets** menunjukkan `PRIVATE_KEY` dan `WALLET_ADDRESS` ✅
2. Pergi ke **Settings → Trading → Mode** → klik `⚡ LIVE (Mainnet)`
3. Klik **START BOT**

---

## Arsitektur & Stack

```
┌─────────────────────────────┐
│   Dashboard (React + Vite)  │  port 80
│   Tailwind + Framer Motion  │
└──────────┬──────────────────┘
           │ REST + WebSocket
┌──────────▼──────────────────┐
│   API Server (Express 5)    │  port 8080
│   Socket.io + Auth Session  │
│                             │
│  ┌──────────────────────┐   │
│  │   ScalpingBot.ts     │   │
│  │  ┌────────────────┐  │   │
│  │  │ TokenScanner   │  │   │  DexScreener / GeckoTerminal
│  │  │ SafetyChecker  │  │   │  GoPlus Labs
│  │  │ AIAnalyzer     │  │   │  Gemini / OpenRouter
│  │  │ SwapExecutor   │  │   │  Uniswap V3 / Base Network
│  │  │ PriceMonitor   │  │   │  DexScreener prices
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
- React + Vite + Tailwind CSS + Framer Motion
- Zod validation, Orval codegen dari OpenAPI spec
- esbuild (ESM bundle untuk API)

---

## Development (Replit / Lokal)

```bash
# Install dependencies
pnpm install

# Jalankan API server (port 8080)
pnpm --filter @workspace/api-server run dev

# Jalankan dashboard (port 18432)
pnpm --filter @workspace/scalping-dashboard run dev

# Typecheck semua package
pnpm run typecheck

# Regenerate API hooks dari OpenAPI spec
pnpm --filter @workspace/api-spec run codegen
```

**Di Replit:** Set secrets di `Tools → Secrets`:
- `SESSION_SECRET`, `DASHBOARD_PASSWORD`
- `PRIVATE_KEY`, `WALLET_ADDRESS` (untuk live)
- `BASE_RPC_URL` (opsional)

AI keys (Gemini, OpenRouter) di-set otomatis via Replit AI Integrations.

---

## Keamanan

- Semua route API dilindungi session authentication — 401 jika belum login
- Session cookie: `httpOnly`, `secure` (production), TTL 7 hari
- `PRIVATE_KEY` tidak pernah dikirim ke frontend — hanya dipakai di server untuk sign transaksi
- Tab **🔑 Secrets** di dashboard hanya menampilkan nilai yang di-mask (4 karakter + bintang)
- Gunakan MEV protection RPC (`MEV_PROTECTION_RPC`) untuk mencegah front-running dan sandwich attack
- **Jangan commit `.env` ke git** — sudah ada di `.gitignore`

### Rekomendasi Sebelum Go-Live

- [ ] Ganti `DASHBOARD_PASSWORD` dari default
- [ ] Set `SESSION_SECRET` dengan nilai acak ≥64 karakter
- [ ] Gunakan RPC dari Alchemy/Infura (bukan public)
- [ ] Set `MEV_PROTECTION_RPC` ke Flashbots/Beaverbuild
- [ ] Pastikan `PRIVATE_KEY` hanya ada di `.env`, tidak di tempat lain
- [ ] Cek tab **🔑 Secrets** di dashboard — semua item wajib harus ✅
- [ ] Test dengan Paper mode dulu sebelum switch ke Live

---

## Troubleshooting

### Container tidak mau start

```bash
docker compose logs api
# Cek apakah SESSION_SECRET sudah diset di .env
```

### Bot jalan tapi tidak ada trade

- Cek **Bot Log** di dashboard — lihat pesan warn/error
- Pastikan `BASE_RPC_URL` bisa diakses dari VPS:
  ```bash
  curl -X POST $BASE_RPC_URL \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
  ```
- Cek `minSafetyScore`, `minMemeScore`, `min5mVolumeUsd` — mungkin terlalu ketat

### Swap gagal / transaksi error

- Cek saldo ETH wallet cukup untuk gas
- Coba naikkan `maxPriorityFeeGwei` dan `maxFeePerGasGwei` di Settings → RPC/Gas
- Pastikan `PRIVATE_KEY` benar dan wallet sudah punya ETH di Base Network

### Dashboard tidak bisa connect ke API

- Pastikan API container jalan: `docker compose ps`
- Cek port 8080 tidak diblokir firewall:
  ```bash
  sudo ufw allow 8080
  sudo ufw allow 80
  ```
- Pastikan nginx proxy ke `http://localhost:8080` (bukan IP eksternal)

### `better-sqlite3` native build error (manual install)

```bash
sudo apt install -y python3 make g++ libsqlite3-dev
cd node_modules/.pnpm/better-sqlite3*/node_modules/better-sqlite3
node-pre-gyp rebuild
```

### AI Filter tidak jalan

- Cek tab **🔑 Secrets** — pastikan `AI_INTEGRATIONS_GEMINI_API_KEY` ✅
- Jika semua AI key kosong, bot tetap jalan tapi tanpa AI filter
- Cek log untuk pesan `AI [Gemini]` atau `AI filter error`

---

## File Penting

```
base-scalper/
├── artifacts/
│   ├── api-server/
│   │   ├── src/scalping/          # Core bot engine
│   │   │   ├── ScalpingBot.ts     # Orchestrator utama
│   │   │   ├── config.ts          # Config type + defaults
│   │   │   ├── AIAnalyzer.ts      # Gemini / OpenRouter AI
│   │   │   ├── SwapExecutor.ts    # Uniswap V3 swaps
│   │   │   ├── SafetyChecker.ts   # GoPlus honeypot check
│   │   │   ├── TokenScanner.ts    # DexScreener scanner
│   │   │   └── PriceMonitor.ts    # Real-time price polling
│   │   ├── src/routes/            # REST API routes
│   │   ├── .env.example           # Template env vars
│   │   └── Dockerfile
│   └── scalping-dashboard/
│       ├── src/pages/Dashboard.tsx
│       ├── src/components/
│       │   ├── FullSettingsPanel.tsx  # Semua settings
│       │   └── ControlPanel.tsx
│       └── Dockerfile
├── lib/api-spec/openapi.yaml      # OpenAPI spec (source of truth)
├── docker-compose.yml             # Deploy keduanya sekaligus
└── README.md
```
