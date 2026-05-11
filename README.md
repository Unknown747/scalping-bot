# BASE Scalper

Bot scalping meme coin otomatis untuk **Base Network**. Dilengkapi AI filter (Gemini / OpenRouter), MEV protection via dRPC, security audit system, trailing stop canggih, multi-DEX router, dan dashboard real-time berbasis web.

---

## Daftar Isi

1. [Fitur Utama](#fitur-utama)
2. [Keamanan](#keamanan)
3. [Install di VPS — Docker (Rekomendasi)](#install-di-vps--docker-rekomendasi)
4. [Install di VPS — Manual / PM2](#install-di-vps--manual--pm2)
5. [Environment Variables](#environment-variables)
6. [Cara Pakai Dashboard](#cara-pakai-dashboard)
7. [Arsitektur & Stack](#arsitektur--stack)
8. [Development (Replit)](#development-replit)
9. [Troubleshooting](#troubleshooting)

---

## Fitur Utama

| Fitur | Keterangan |
|---|---|
| **Bot Scalping Otomatis** | Scan token baru Base Network tiap 8 detik via DexScreener + GeckoTerminal |
| **AI Filter** | Gemini 2.5 Flash → Groq/Llama → HuggingFace — validasi entry sebelum beli |
| **Safety Check** | GoPlus Labs: honeypot detection, sell tax, ownership renounce, deployer check |
| **MEV Protection** | Semua transaksi via dRPC MEV Blocker — terlindungi dari sandwich attack |
| **MEV Tracking** | Trade History menampilkan status MEV per transaksi + % trade terlindungi |
| **Security Audit** | Endpoint `/api/security-audit` — 7 check keamanan, blokir live mode jika gagal |
| **Trailing Stop** | Aktif hanya setelah profit minimum tercapai, mengunci profit terkunci |
| **Multi-DEX** | Uniswap V3, Aerodrome, BaseSwap — otomatis pilih fee tier terbaik |
| **TP Bertahap** | TP1 / TP2 / TP3 dengan persentase jual berbeda per level |
| **TWAP Execution** | Pecah order besar jadi beberapa slice untuk kurangi dampak ke harga |
| **Telegram Notifikasi** | Alert buy / sell / stop-loss ke Telegram |
| **Dashboard Real-time** | WebSocket, format IDR, live P&L, log bot, posisi aktif |
| **Semua Setting dari Web** | Tidak perlu edit file — semua konfigurasi dari Settings panel |
| **Paper Trading** | Mode simulasi tanpa dana nyata untuk testing strategi |

---

## Keamanan

> **Pelajaran penting:** Jangan pernah menyimpan private key, API key, atau password di dalam kode atau file yang di-commit ke git. Gunakan environment variables / secrets manager.

### Praktik Keamanan yang Diterapkan

- **PRIVATE_KEY tidak pernah dikirim ke frontend** — hanya dipakai di server untuk sign transaksi
- **Session cookie:** `httpOnly`, `secure` (production), TTL 7 hari
- **Semua route API dilindungi** session authentication — 401 jika belum login
- **Tab 🔑 Secrets di dashboard** hanya menampilkan nilai ter-mask (4 karakter pertama + bintang)
- **Security Audit System** — bot diblokir masuk live mode jika ada konfigurasi kritis yang salah
- **MEV Protection** — transaksi via dRPC MEV Blocker (`https://mev-blocker.drpc.org`)
- **`.env` di `.gitignore`** — file secrets tidak akan pernah masuk ke repository
- **Database (`*.db`) di `.gitignore`** — file SQLite tidak ter-commit ke git

### Checklist Sebelum Go-Live

- [ ] Buat **wallet baru** khusus untuk bot — jangan pakai wallet utama
- [ ] Set `SESSION_SECRET` dengan nilai acak ≥ 32 karakter
- [ ] Ganti `DASHBOARD_PASSWORD` dari nilai default
- [ ] Gunakan RPC dari Alchemy/Infura (bukan public RPC yang lambat)
- [ ] Set `MEV_PROTECTION_RPC=https://mev-blocker.drpc.org`
- [ ] Pastikan `PRIVATE_KEY` hanya ada di `.env` atau secrets manager — tidak di tempat lain
- [ ] Cek endpoint `/api/security-audit` — semua critical check harus `"passed": true`
- [ ] Test Paper mode dulu sebelum switch ke Live

### Security Audit Endpoint

```bash
curl http://IP_VPS:8080/api/security-audit
```

Mengembalikan status 7 check keamanan. Jika `canRunLive: false`, bot **tidak bisa** dijalankan di live mode sampai semua masalah kritis diperbaiki.

---

## Install di VPS — Docker (Rekomendasi)

Cara paling mudah. Butuh: **Ubuntu 22.04+**, **Docker**, **Docker Compose**.

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

### 2. Clone Repository

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

# Auth — generate SESSION_SECRET: openssl rand -hex 32
SESSION_SECRET=isi_dengan_string_acak_minimal_32_karakter
DASHBOARD_PASSWORD=password_dashboard_kamu

# Wallet (wajib untuk live trading) — GUNAKAN WALLET BARU KHUSUS BOT!
PRIVATE_KEY=0x_private_key_wallet_base_network_kamu
WALLET_ADDRESS=0x_alamat_wallet_base_network_kamu

# RPC — gunakan Alchemy/Infura, bukan public RPC
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY

# MEV Protection via dRPC
MEV_PROTECTION_RPC=https://mev-blocker.drpc.org
```

### 4. Build dan Jalankan

```bash
docker compose up -d --build
```

Bot dan dashboard berjalan otomatis. Akses:
- **Dashboard:** `http://IP_VPS` (port 80)
- **API:** `http://IP_VPS:8080`
- **Security Audit:** `http://IP_VPS:8080/api/security-audit`

### 5. Cek Status

```bash
# Status semua container
docker compose ps

# Log bot (API)
docker compose logs -f api

# Log dashboard (nginx)
docker compose logs -f dashboard

# Security audit
curl http://localhost:8080/api/security-audit | python3 -m json.tool
```

### 6. Update ke Versi Terbaru

```bash
git pull
docker compose up -d --build
```

### 7. Stop / Restart / Backup

```bash
docker compose stop       # stop semua
docker compose restart    # restart semua
docker compose down       # stop + hapus container (data tetap aman di volume)

# Backup database
docker run --rm -v scalping_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/scalping-backup-$(date +%Y%m%d).tar.gz /data
```

> Data trading (SQLite) disimpan di Docker volume `scalping_data` — aman saat container di-restart atau di-rebuild.

---

## Install di VPS — Manual / PM2

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

> `better-sqlite3` butuh native compile. Jika ada error:
> ```bash
> sudo apt install -y python3 make g++ libsqlite3-dev
> pnpm install --force
> ```

### 3. Buat File `.env`

```bash
cp artifacts/api-server/.env.example artifacts/api-server/.env
nano artifacts/api-server/.env
# Isi semua nilai seperti di bagian Docker di atas
```

### 4. Build API Server

```bash
pnpm --filter @workspace/api-server run build
```

### 5. Build Dashboard

```bash
# BASE_PATH=/ diperlukan agar Vite tahu root path untuk production build
BASE_PATH=/ PORT=80 pnpm --filter @workspace/scalping-dashboard run build
```

### 6. Jalankan dengan PM2

Buat file `ecosystem.config.cjs` (jangan commit ke git):

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
    },
  ],
};
```

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # auto-start saat reboot
pm2 logs scalper-api  # lihat log
```

### 7. Serve Dashboard dengan Nginx

```bash
sudo apt install -y nginx

sudo nano /etc/nginx/sites-available/scalper
```

```nginx
server {
    listen 80;
    server_name IP_VPS_ATAU_DOMAIN;

    root /path/to/base-scalper/artifacts/scalping-dashboard/dist/public;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;

    # SPA routing
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
    }

    # WebSocket proxy untuk Socket.io (real-time dashboard)
    location /socket.io/ {
        proxy_pass http://localhost:8080/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/scalper /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## Environment Variables

| Variable | Wajib | Default | Keterangan |
|---|---|---|---|
| `PORT` | Ya | — | Port API server (8080) |
| `NODE_ENV` | Ya | `development` | Set ke `production` di VPS |
| `SESSION_SECRET` | **Ya** | — | String acak ≥ 32 karakter untuk enkripsi session |
| `DASHBOARD_PASSWORD` | Ya | `scalper2024` | Password login dashboard — **wajib ganti!** |
| `PRIVATE_KEY` | Live only | — | Private key wallet Base Network (0x...) |
| `WALLET_ADDRESS` | Live only | — | Alamat wallet Base Network (0x...) |
| `BASE_RPC_URL` | Opsional | `mainnet.base.org` | RPC Base — gunakan Alchemy/Infura untuk produksi |
| `MEV_PROTECTION_RPC` | Opsional | sama dengan BASE_RPC_URL | MEV blocker — gunakan `https://mev-blocker.drpc.org` |
| `SQLITE_PATH` | Opsional | `./scalping.db` | Path file database SQLite |
| `AI_INTEGRATIONS_GEMINI_BASE_URL` | Opsional | — | Base URL Gemini AI |
| `AI_INTEGRATIONS_GEMINI_API_KEY` | Opsional | — | API key Gemini (auto di Replit) |
| `AI_INTEGRATIONS_OPENROUTER_BASE_URL` | Opsional | — | Base URL OpenRouter |
| `AI_INTEGRATIONS_OPENROUTER_API_KEY` | Opsional | — | API key OpenRouter (Groq + HuggingFace fallback) |
| `TELEGRAM_BOT_TOKEN` | Opsional | — | Token Telegram bot untuk notifikasi |
| `TELEGRAM_CHAT_ID` | Opsional | — | Chat ID Telegram tujuan notifikasi |
| `LOG_LEVEL` | Opsional | `info` | Level log: `debug`, `info`, `warn`, `error` |

### Rekomendasi RPC

| Provider | URL | Kecepatan | Harga |
|---|---|---|---|
| Public Base | `https://mainnet.base.org` | Lambat | Gratis |
| **Alchemy** | `https://base-mainnet.g.alchemy.com/v2/KEY` | Cepat | Free 300M req/bln |
| **Infura** | `https://base-mainnet.infura.io/v3/KEY` | Cepat | Free tier ada |
| **dRPC MEV Blocker** ✓ | `https://mev-blocker.drpc.org` | Cepat | Gratis |
| dRPC Public | `https://base.drpc.org` | Cepat | Gratis |
| Flashbots | `https://rpc.flashbots.net/fast` | Medium | Gratis |

> **Rekomendasi:** Gunakan Alchemy untuk `BASE_RPC_URL` (read/write cepat) dan dRPC MEV Blocker untuk `MEV_PROTECTION_RPC` (proteksi sandwich attack).

### AI Keys untuk VPS

**Gemini (gratis):**
```
AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com
AI_INTEGRATIONS_GEMINI_API_KEY=AIza...  # dari aistudio.google.com
```

**OpenRouter (fallback Groq + HuggingFace):**
```
AI_INTEGRATIONS_OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
AI_INTEGRATIONS_OPENROUTER_API_KEY=sk-or-...  # dari openrouter.ai
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
| **Token Scanner** | Token yang baru di-scan dan skornya |
| **Trade History** | Riwayat semua trade + status MEV protection per transaksi |
| **P&L Chart** | Grafik profit/loss harian |
| **AI Decision Log** | Log keputusan AI filter per token |
| **Bot Log** | Log real-time semua aktivitas bot |

### Trade History — MEV Tracking

Halaman Trade History menampilkan:
- **Badge `✓ MEV`** (hijau) — trade masuk via dRPC MEV Blocker, terlindungi sandwich attack
- **Badge `— STD`** (abu-abu) — trade via RPC standar
- **Ringkasan bar** — persentase trade via MEV vs Standard, P&L per jalur
- **Progress bar visual** — rasio MEV vs Standard sekilas
- **Export CSV** — kolom MEV disertakan (YES/NO)

### Settings Panel

| Tab | Isi |
|---|---|
| **Optim** | Dynamic Sizing, Break-Even Stop, TWAP, Multi-DEX, Auto-Compound |
| **Trading** | Mode (Live/Paper), TP1/TP2/TP3, Stop Loss, Trailing Stop, Anti-FOMO |
| **Safety** | Min Safety Score, Max Sell Tax, filter likuiditas & volume |
| **AI** | Toggle AI Filter, pilih provider (Gemini/Groq/HF), min confidence |
| **Telegram** | Bot token + Chat ID untuk notifikasi |
| **RPC/Gas** | Gas price, slippage, TWAP interval |
| **Secrets** | Status semua env var — ✅/❌ per secret, nilai ter-mask |

### Switch ke Live Trading

1. Cek **Security Audit** — semua item harus ✅
2. Cek **Settings → 🔑 Secrets** — `PRIVATE_KEY` dan `WALLET_ADDRESS` harus ✅
3. Pergi ke **Settings → Trading → Mode** → klik **LIVE (Mainnet)**
4. Klik **START BOT**

> Bot **tidak bisa** dijalankan di live mode jika Security Audit gagal.

---

## Arsitektur & Stack

```
┌─────────────────────────────┐
│   Dashboard (React + Vite)  │  port 80 (Docker) / 18432 (dev)
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
│  │  │ TokenScanner   │  │──── DexScreener / GeckoTerminal
│  │  │ SafetyChecker  │  │──── GoPlus Labs
│  │  │ AIAnalyzer     │  │──── Gemini / OpenRouter
│  │  │ SwapExecutor   │  │──── Uniswap V3 / dRPC MEV Blocker
│  │  │ PriceMonitor   │  │──── DexScreener prices
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
- esbuild (ESM bundle untuk API)
- Docker multi-stage build + nginx

---

## Development (Replit)

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

# Typecheck semua package
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/scalping-dashboard run typecheck

# Regenerate API hooks dari OpenAPI spec
pnpm --filter @workspace/api-spec run codegen
```

**Di Replit, set secrets di `Tools → Secrets`:**
- `SESSION_SECRET` — string acak ≥ 32 karakter
- `DASHBOARD_PASSWORD` — password dashboard
- `PRIVATE_KEY` — private key wallet baru (bukan wallet utama!)
- `WALLET_ADDRESS` — alamat wallet
- `BASE_RPC_URL` — RPC dari Alchemy/Infura
- `MEV_PROTECTION_RPC` — `https://mev-blocker.drpc.org`

AI keys (Gemini, OpenRouter) di-set otomatis via Replit AI Integrations.

---

## Troubleshooting

### Container tidak mau start

```bash
docker compose logs api
# Pastikan SESSION_SECRET sudah diset di .env
# Pastikan format PRIVATE_KEY benar (0x + 64 karakter hex)
```

### Security audit gagal

```bash
curl http://localhost:8080/api/security-audit | python3 -m json.tool
# Ikuti petunjuk "fix" di setiap check yang "passed": false
```

### Dashboard tidak bisa connect ke API

```bash
# Cek container jalan
docker compose ps

# Cek port tidak diblokir firewall
sudo ufw allow 8080
sudo ufw allow 80

# Test API langsung
curl http://localhost:8080/api/healthz
```

### Bot jalan tapi tidak ada trade

- Cek **Bot Log** di dashboard — lihat pesan warn/error
- Test koneksi RPC dari VPS:
  ```bash
  curl -X POST $BASE_RPC_URL \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
  ```
- Cek `minSafetyScore`, `minMemeScore`, `min5mVolumeUsd` di Settings — mungkin terlalu ketat

### Swap gagal / transaksi error

- Cek saldo ETH wallet cukup untuk gas
- Naikkan `maxPriorityFeeGwei` dan `maxFeePerGasGwei` di Settings → RPC/Gas
- Cek `PRIVATE_KEY` dan `WALLET_ADDRESS` benar dan cocok
- Pastikan wallet punya ETH di Base Network

### `better-sqlite3` native build error (manual install)

```bash
sudo apt install -y python3 make g++ libsqlite3-dev
pnpm install --force
```

### AI Filter tidak jalan

- Cek tab **🔑 Secrets** — `AI_INTEGRATIONS_GEMINI_API_KEY` harus ✅
- Jika semua AI key kosong, bot tetap jalan tapi tanpa AI filter
- Cek log untuk pesan `AI [Gemini]` atau `AI filter error`

### Trade History tidak tampil MEV status

Database lama perlu migrasi otomatis (terjadi saat server restart). Jika belum:
```bash
docker compose restart api
```

---

## Struktur File Penting

```
base-scalper/
├── artifacts/
│   ├── api-server/
│   │   ├── src/
│   │   │   ├── scalping/
│   │   │   │   ├── ScalpingBot.ts      # Orchestrator utama
│   │   │   │   ├── config.ts           # Config type + defaults
│   │   │   │   ├── SecurityAudit.ts    # 7 security checks
│   │   │   │   ├── AIAnalyzer.ts       # Gemini / OpenRouter AI
│   │   │   │   ├── SwapExecutor.ts     # Uniswap V3 swaps + MEV
│   │   │   │   ├── SafetyChecker.ts    # GoPlus honeypot check
│   │   │   │   ├── TokenScanner.ts     # DexScreener scanner
│   │   │   │   ├── PriceMonitor.ts     # Real-time price polling
│   │   │   │   └── database.ts         # SQLite operations
│   │   │   └── routes/
│   │   │       ├── bot.ts              # Start/stop + security gate
│   │   │       ├── trades.ts           # Trade history + MEV status
│   │   │       ├── secrets.ts          # Secrets status (masked)
│   │   │       └── security.ts         # /api/security-audit
│   │   ├── .env.example                # Template env vars
│   │   └── Dockerfile
│   └── scalping-dashboard/
│       ├── src/
│       │   ├── pages/Dashboard.tsx
│       │   └── components/
│       │       ├── TradeHistory.tsx     # + MEV tracking
│       │       ├── SecurityAuditCard.tsx
│       │       ├── ControlPanel.tsx
│       │       └── FullSettingsPanel.tsx
│       └── Dockerfile
├── lib/
│   ├── api-spec/openapi.yaml           # OpenAPI spec (source of truth)
│   └── api-client-react/               # Generated React hooks
├── docker-compose.yml                  # Deploy keduanya sekaligus
├── .env.example -> artifacts/api-server/.env.example
└── README.md
```
