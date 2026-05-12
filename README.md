# BASE Scalper

Bot scalping meme coin otomatis untuk **Base Network**. Dilengkapi AI filter paralel (Gemini + Groq + HuggingFace consensus), MEV protection berlapis (dRPC + Flashbots backup), security audit system, trailing stop canggih, multi-DEX, dan dashboard real-time berbasis web.

---

## Daftar Isi

1. [Fitur Utama](#fitur-utama)
2. [Keamanan — Baca Ini Dulu](#keamanan--baca-ini-dulu)
3. [Tutorial Install VPS — PM2 (Rekomendasi)](#tutorial-install-vps--pm2-rekomendasi)
4. [Environment Variables](#environment-variables)
5. [MEV Protection](#mev-protection)
6. [Cara Pakai Dashboard](#cara-pakai-dashboard)
7. [Arsitektur & Stack](#arsitektur--stack)
8. [Development di Replit](#development-di-replit)
9. [Troubleshooting](#troubleshooting)

---

## Fitur Utama

| Fitur | Keterangan |
|---|---|
| **Bot Scalping Otomatis** | Scan token baru Base Network tiap 8 detik via DexScreener + GeckoTerminal |
| **AI Parallel Consensus** | Gemini + Groq + HuggingFace — semua analisis **serentak**, butuh mayoritas suara BUY |
| **Safety Check** | GoPlus Labs: honeypot detection, sell tax, renounce ownership, deployer check |
| **MEV Protection Berlapis** | dRPC MEV Blocker (primary) → Flashbots (backup) — anti sandwich attack |
| **MEV Tracking** | Trade History: badge MEV per transaksi, % terlindungi, P&L per jalur |
| **Security Audit** | 7 check keamanan otomatis — bot diblokir masuk live mode jika gagal |
| **Trailing Stop** | Aktif setelah profit minimum, mengunci keuntungan |
| **Multi-DEX Quote** | Uniswap V3, Aerodrome, BaseSwap — bandingkan harga; eksekusi via Uniswap V3 |
| **TP Bertahap** | TP1 / TP2 / TP3 dengan persentase jual berbeda |
| **TWAP Execution** | Pecah order besar jadi beberapa slice |
| **Telegram Notifikasi** | Alert buy / sell / stop-loss ke Telegram |
| **Dashboard Real-time** | WebSocket, format IDR, live P&L, log bot, posisi aktif |
| **Paper / Live Separation** | Stats LIVE dan PAPER TERPISAH — tampilkan keduanya sekaligus di dashboard |
| **WETH Tracking** | Wallet card tampilkan ETH (gas) dan WETH (trading capital) secara terpisah |
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

## Tutorial Install VPS — PM2 (Rekomendasi)

> **PM2 adalah cara terbaik untuk deploy bot ini di VPS.** Tidak perlu Docker, tidak perlu container registry. Langsung jalankan Node.js dengan restart otomatis dan monitoring bawaan.

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

Update sistem:

```bash
apt update && apt upgrade -y
```

---

### Langkah 2 — Install Node.js 22+ dan pnpm

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

# Install pnpm
npm install -g pnpm

# Install PM2 (process manager)
npm install -g pm2
```

---

### Langkah 3 — Install Build Tools untuk better-sqlite3

```bash
# Dependency native compile
sudo apt install -y python3 make g++ libsqlite3-dev
```

---

### Langkah 4 — Clone dan Install

```bash
git clone https://github.com/YOUR_USERNAME/base-scalper.git
cd base-scalper
pnpm install
```

Jika ada error saat install `better-sqlite3`:
```bash
pnpm install --force
```

---

### Langkah 5 — Buat File `.env`

```bash
cp artifacts/api-server/.env.example artifacts/api-server/.env
nano artifacts/api-server/.env
```

Isi nilai-nilai berikut:

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
# RPC untuk SCAN/READ — daftar gratis di https://alchemy.com
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY

# ── MEV Protection (untuk approve/buy/sell) ───────────────────────────────────
MEV_PROTECTION_RPC=https://mev-blocker.drpc.org
MEV_PROTECTION_RPC_BACKUP=https://rpc.flashbots.net/fast

# ── AI Filter (opsional tapi sangat direkomendasikan) ─────────────────────────
AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com
AI_INTEGRATIONS_GEMINI_API_KEY=AIza_YOUR_GEMINI_KEY
GROQ_API_KEY=gsk_YOUR_GROQ_KEY
HUGGINGFACE_API_KEY=hf_YOUR_HF_KEY
```

Cara generate `SESSION_SECRET`:
```bash
openssl rand -hex 32
```

Simpan dan keluar: `Ctrl+X` → `Y` → `Enter`

---

### Langkah 6 — Build

```bash
# Build API server
pnpm --filter @workspace/api-server run build

# Build dashboard (BASE_PATH=/ untuk production)
BASE_PATH=/ PORT=80 pnpm --filter @workspace/scalping-dashboard run build
```

---

### Langkah 7 — Jalankan dengan PM2

Buat file `ecosystem.config.cjs`:

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

### Langkah 8 — Install dan Konfigurasi Nginx

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
sudo ln -s /etc/nginx/sites-available/scalper /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default  # opsional
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl enable nginx
```

---

### Langkah 9 — Setup Firewall

```bash
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw status
```

---

### Langkah 10 — Verifikasi

```bash
# Test API health
curl http://localhost:8080/api/healthz
# Output: {"status":"ok"}

# Lihat log bot secara live
pm2 logs scalper-api --lines 50
```

Buka browser: `http://IP_VPS_KAMU` dan login dengan `DASHBOARD_PASSWORD`.

---

### Perintah PM2 yang Sering Dipakai

```bash
pm2 status                        # Lihat status semua process
pm2 logs scalper-api              # Lihat log real-time
pm2 logs scalper-api --lines 100  # Lihat 100 baris log terakhir
pm2 restart scalper-api           # Restart bot
pm2 stop scalper-api              # Stop bot
pm2 start scalper-api             # Start bot
pm2 delete scalper-api            # Hapus dari PM2
pm2 monit                         # Monitor CPU & RAM real-time
```

### Update ke Versi Terbaru

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
| `BASE_RPC_URL` | Opsional | `mainnet.base.org` | RPC Base untuk SCAN — gunakan Alchemy |
| `MEV_PROTECTION_RPC` | Opsional | `mev-blocker.drpc.org` | RPC untuk approve/buy/sell (MEV primary) |
| `MEV_PROTECTION_RPC_BACKUP` | Opsional | `rpc.flashbots.net/fast` | MEV backup (Flashbots) |
| `SQLITE_PATH` | Opsional | `./scalping.db` | Path database SQLite |
| `AI_INTEGRATIONS_GEMINI_BASE_URL` | Opsional | — | Base URL Gemini |
| `AI_INTEGRATIONS_GEMINI_API_KEY` | Opsional | — | API key Gemini (aistudio.google.com) |
| `GROQ_API_KEY` | Opsional | — | API key Groq (console.groq.com) |
| `HUGGINGFACE_API_KEY` | Opsional | — | API key HuggingFace (huggingface.co/settings/tokens) |
| `TELEGRAM_BOT_TOKEN` | Opsional | — | Token bot Telegram |
| `TELEGRAM_CHAT_ID` | Opsional | — | Chat ID Telegram |
| `LOG_LEVEL` | Opsional | `info` | `debug` / `info` / `warn` / `error` |

> **RPC Separation:** `BASE_RPC_URL` dipakai untuk READ saja (scan token, cek balance, quote harga). `MEV_PROTECTION_RPC` dipakai untuk WRITE (approve, buy, sell) agar transaksi masuk via MEV blocker.

---

## MEV Protection

Bot menggunakan sistem MEV protection berlapis untuk melindungi semua transaksi swap dari sandwich attack dan front-running.

### Urutan Fallback

```
Transaksi Swap (approve/buy/sell)
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

---

## Cara Pakai Dashboard

### Login
Buka `http://IP_VPS` → masukkan `DASHBOARD_PASSWORD`

### Panel Utama

| Panel | Keterangan |
|---|---|
| **Stats Row** | Toggle antara LIVE / PAPER / KEDUANYA — pisahkan performa nyata vs simulasi |
| **Control Panel** | START / STOP bot, pilih risk level, Emergency Stop |
| **Security Audit** | Status 7 check keamanan — harus semua ✅ sebelum live |
| **Wallet** | Saldo ETH (gas) dan WETH (trading capital) real-time, nilai IDR |
| **Posisi Aktif** | Posisi terbuka, P&L live, tombol close manual |
| **Token Scanner** | Token yang baru di-scan beserta skornya |
| **Trade History** | Filter per mode (LIVE/PAPER), per waktu, MEV per transaksi, export CSV |
| **P&L Chart** | Grafik profit/loss harian |
| **AI Decision Log** | Log keputusan AI — tampilkan semua 3 provider + consensus result |
| **Bot Log** | Log real-time semua aktivitas |

### Settings Panel

| Tab | Isi |
|---|---|
| **Optim** | Dynamic Sizing, Break-Even Stop, TWAP, Multi-DEX, Auto-Compound |
| **Trading** | Mode (Live/Paper), TP1/TP2/TP3, Stop Loss, Trailing Stop, Anti-FOMO |
| **Safety** | Min Safety Score, Max Sell Tax, filter likuiditas & volume |
| **AI** | Toggle AI Filter, provider (Gemini+Groq+HF paralel), min confidence |
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
│   Dashboard (React + Vite)  │  port 8081 (dev) / port 80 (prod via Nginx)
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
│  │  │ AIAnalyzer     │──│───── Gemini + Groq + HuggingFace (paralel)
│  │  │ SwapExecutor   │──│───── Uniswap V3 + dRPC / Flashbots
│  │  │ DEXAggregator  │──│───── Quote comparison (harga terbaik)
│  │  │ PriceMonitor   │──│───── DexScreener prices
│  │  │ SecurityAudit  │  │
│  │  └────────────────┘  │   │
│  └──────────────────────┘   │
│                             │
│  SQLite (better-sqlite3)    │
└─────────────────────────────┘
```

**Stack:**
- Node.js 22, TypeScript 5.9, pnpm workspaces
- Express 5, Socket.io 4, better-sqlite3
- React 19, Vite 7, Tailwind CSS, Framer Motion
- ethers.js v6, @google/genai, openai SDK

---

## Development di Replit

### Setup Awal

Semua dependency sudah terinstall via `pnpm install`. Workflow sudah dikonfigurasi:
- **API Server** — `PORT=8080 pnpm --filter @workspace/api-server run dev`
- **Dashboard** — `PORT=8081 BASE_PATH=/ pnpm --filter @workspace/scalping-dashboard run dev`

### Set Secrets

Di Replit, buka **Tools → Secrets** dan set:

| Secret | Keterangan |
|---|---|
| `SESSION_SECRET` | String acak ≥ 32 karakter |
| `DASHBOARD_PASSWORD` | Password login |
| `PRIVATE_KEY` | Private key wallet (live trading saja) |
| `WALLET_ADDRESS` | Alamat wallet |
| `BASE_RPC_URL` | RPC Base Network (Alchemy/Infura) |
| `MEV_PROTECTION_RPC` | `https://mev-blocker.drpc.org` |
| `AI_INTEGRATIONS_GEMINI_API_KEY` | Otomatis via Replit AI Integration |
| `GROQ_API_KEY` | API key Groq |
| `HUGGINGFACE_API_KEY` | API key HuggingFace |

### Port Akses

Klik **Ports** di Replit untuk akses dashboard (8081) dan API (8080) via URL publik Replit.

---

## Troubleshooting

### "Buy failed: missing revert data"
Token ini kemungkinan **hanya tersedia di Aerodrome/BaseSwap** dan tidak punya pool Uniswap V3. Bot sekarang **mendeteksi ini otomatis** sebelum mencoba swap — akan muncul log: "No Uniswap V3 liquidity found — token may be Aerodrome/BaseSwap only. Skipping buy."

Solusi: Token ini memang tidak bisa dibeli via jalur bot saat ini. Filter akan semakin baik seiring waktu karena token yang listing di Aerodrome-only akan ter-skip secara otomatis.

### "WETH balance rendah"
Bot akan otomatis pakai ETH native jika WETH tidak cukup. Untuk efisiensi gas, wrap ETH ke WETH dulu di app.uniswap.org → pilih Base Network → swap ETH ke WETH.

### "All AI providers failed"
Cek apakah semua API key sudah diset dengan benar di Secrets. Bot masih jalan (fail-open) tapi tanpa filter AI. Lihat log untuk detail error per provider.

### "No private key configured"
Set `PRIVATE_KEY` di Secrets. Untuk sekadar testing, gunakan Paper mode — tidak butuh private key.

### Bot tidak muncul di preview
1. Pastikan workflow Dashboard sudah running (port 8081)
2. Klik **Ports** di Replit → pilih port 8081
3. Jika masih tidak muncul, restart workflow Dashboard
