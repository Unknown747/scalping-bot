# Install BASE Scalper di VPS Ubuntu

Panduan instalasi untuk **Ubuntu 22.04 / 24.04 LTS** menggunakan **Node.js + PM2 + Nginx**.

---

## Instalasi 1 Klik (Rekomendasi)

```bash
# Clone repo dulu
git clone https://github.com/YOUR_USERNAME/base-scalper.git
cd base-scalper

# Jalankan installer otomatis
bash scripts/install-vps.sh
```

Script akan tanya semua konfigurasi secara interaktif, lalu install dan setup semuanya otomatis (Node.js, pnpm, PM2, Nginx, firewall, .env).

---

## Yang Kamu Butuhkan

| Item | Keterangan |
|---|---|
| VPS | Ubuntu 22.04 atau 24.04 LTS |
| RAM | Minimal 1 GB (rekomendasi 2 GB) |
| Storage | Minimal 5 GB |
| RPC URL | Daftar gratis di [alchemy.com](https://alchemy.com) |
| Wallet baru | Buat wallet **baru** khusus bot — jangan pakai wallet utama! |

### Siapkan data ini sebelum mulai

```
✅ PRIVATE_KEY wallet bot (bukan wallet utama!)
✅ WALLET_ADDRESS wallet bot
✅ BASE_RPC_URL dari Alchemy: https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
✅ GEMINI_API_KEY dari Google AI Studio (opsional, untuk AI filter)
```

---

## Langkah 1 — Login ke VPS

```bash
ssh root@IP_VPS_KAMU
```

---

## Langkah 2 — Update Sistem

```bash
apt update && apt upgrade -y
```

---

## Langkah 3 — Install Build Tools

```bash
apt install -y git curl python3 make g++ libsqlite3-dev nginx
```

---

## Langkah 4 — Install Node.js 24

```bash
# Install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Reload terminal agar nvm bisa dipakai
source ~/.bashrc

# Install Node.js 24 LTS
nvm install 24
nvm use 24
nvm alias default 24

# Verifikasi
node --version    # harus v24.x.x
npm --version
```

---

## Langkah 5 — Install pnpm dan PM2

```bash
npm install -g pnpm pm2
```

---

## Langkah 6 — Clone Repository

```bash
git clone https://github.com/YOUR_USERNAME/base-scalper.git
cd base-scalper
```

---

## Langkah 7 — Install Dependencies

```bash
pnpm install
```

Jika muncul error `better-sqlite3` atau error native module:
```bash
pnpm install --force
```

---

## Langkah 8 — Buat File `.env`

```bash
cp artifacts/api-server/.env.example artifacts/api-server/.env
nano artifacts/api-server/.env
```

Isi semua nilai di bawah ini:

```env
PORT=8080
NODE_ENV=production

# ─── Wajib ────────────────────────────────────────────────────────────────────

# Generate dengan: openssl rand -hex 32
SESSION_SECRET=TEMPEL_HASIL_OPENSSL_DISINI

# Password untuk login dashboard
DASHBOARD_PASSWORD=buat_password_kuat_kamu

# Wallet BOT (gunakan wallet baru, bukan wallet utama!)
PRIVATE_KEY=0xPRIVATE_KEY_WALLET_BOT_KAMU
WALLET_ADDRESS=0xALAMAT_WALLET_BOT_KAMU

# RPC dari Alchemy
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY

# ─── MEV Protection (sudah ada default, langsung pakai) ───────────────────────
MEV_PROTECTION_RPC=https://mev-blocker.drpc.org
MEV_PROTECTION_RPC_BACKUP=https://rpc.flashbots.net/fast

# ─── AI Filter — 3 Provider Round-Robin (opsional, isi semua agar awet) ───────
# Sistem rotasi: Token 1→Gemini, Token 2→Groq, Token 3→HuggingFace, dst.
# Credit terdistribusi merata — tidak membebani satu provider.

# Provider 1: Google Gemini (gratis 1500 req/hari)
# Daftar key: https://aistudio.google.com/app/apikey
AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com
AI_INTEGRATIONS_GEMINI_API_KEY=AIza_GEMINI_KEY_KAMU

# Provider 2: Groq — ultra-cepat, gratis 14400 req/hari
# Daftar key: https://console.groq.com/keys
GROQ_API_KEY=gsk_GROQ_KEY_KAMU

# Provider 3: HuggingFace — backup gratis
# Daftar key: https://huggingface.co/settings/tokens (pilih "Read" token)
HUGGINGFACE_API_KEY=hf_HUGGINGFACE_TOKEN_KAMU
```

**Cara generate SESSION_SECRET** (jalankan di terminal baru):
```bash
openssl rand -hex 32
```

**Simpan dan keluar dari nano:** `Ctrl+X` → `Y` → `Enter`

---

## Langkah 9 — Build

```bash
# Build API
pnpm --filter @workspace/api-server run build

# Build dashboard (PORT dan BASE_PATH wajib diset)
BASE_PATH=/ PORT=80 pnpm --filter @workspace/scalping-dashboard run build
```

---

## Langkah 10 — Jalankan API dengan PM2

File config PM2 sudah ada di repo (`ecosystem.config.cjs`). Langsung jalankan:

```bash
pm2 start ecosystem.config.cjs

# Lihat log
pm2 logs scalper-api

# Set auto-start saat VPS reboot
pm2 save
pm2 startup
# ← Copy-paste perintah yang muncul dari output pm2 startup, lalu jalankan
```

---

## Langkah 11 — Setup Nginx

```bash
nano /etc/nginx/sites-available/scalper
```

Isi (ganti `/root/base-scalper` jika folder project berbeda):
```nginx
server {
    listen 80;
    server_name _;

    root /root/base-scalper/artifacts/scalping-dashboard/dist/public;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:8080/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
    }

    location /socket.io/ {
        proxy_pass http://localhost:8080/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
    }
}
```

Aktifkan:
```bash
ln -s /etc/nginx/sites-available/scalper /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

nginx -t
# harus output: syntax is ok

systemctl reload nginx
systemctl enable nginx
```

---

## Langkah 12 — Firewall

```bash
ufw enable
ufw allow ssh
ufw allow 80/tcp
ufw status
```

---

## Langkah 13 — Verifikasi

```bash
# Cek PM2
pm2 status

# Test API
curl http://localhost:8080/api/healthz
# Output: {"status":"ok",...}

# Cek keamanan (semua harus "passed": true)
curl http://localhost:8080/api/security-audit | python3 -m json.tool
```

Buka browser → `http://IP_VPS_KAMU` → login dengan `DASHBOARD_PASSWORD` yang sudah diset.

---

## Langkah 14 — Mulai Trading

1. Cek **Security Audit** di dashboard — semua harus ✅
2. Cek **Settings → 🔑 Secrets** — `PRIVATE_KEY` dan `WALLET_ADDRESS` harus ✅
3. Mulai dengan **Paper mode** untuk testing minimal 24 jam
4. Jika sudah yakin → **Settings → Trading → Mode → LIVE** → **START BOT**

---

## Perintah Harian PM2

```bash
pm2 status                         # Lihat status semua process
pm2 logs scalper-api               # Lihat log real-time
pm2 logs scalper-api --lines 200   # 200 baris log terakhir
pm2 restart scalper-api            # Restart bot
pm2 stop scalper-api               # Stop bot
pm2 monit                          # Monitor CPU & RAM live
```

---

## Update ke Versi Terbaru

```bash
cd base-scalper
git pull
pnpm install
pnpm --filter @workspace/api-server run build
BASE_PATH=/ PORT=80 pnpm --filter @workspace/scalping-dashboard run build
pm2 restart scalper-api
systemctl reload nginx
```

---

## Troubleshooting

### Dashboard tidak bisa dibuka

```bash
# Cek nginx
systemctl status nginx
nginx -t

# Cek port 80
ufw status
curl http://localhost

# Cek path dist sudah ada
ls /root/base-scalper/artifacts/scalping-dashboard/dist/public/index.html
```

Jika `index.html` tidak ada → build ulang:
```bash
BASE_PATH=/ PORT=80 pnpm --filter @workspace/scalping-dashboard run build
```

### Bot jalan tapi tidak ada trade

```bash
pm2 logs scalper-api

# Test koneksi RPC
curl -X POST YOUR_BASE_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

Jika RPC OK tapi tidak ada trade:
- Buka dashboard → Settings → kurangi `minSafetyScore` atau `min5mVolumeUsd`
- Lihat Bot Log di dashboard

### Error saat install (better-sqlite3)

```bash
apt install -y python3 make g++ libsqlite3-dev
pnpm install --force
```

### Ganti `.env` (PRIVATE_KEY, dll)

```bash
nano artifacts/api-server/.env
pm2 restart scalper-api
```

---

## Checklist Sebelum Live Trading

```
[ ] pm2 status → scalper-api online
[ ] curl localhost:8080/api/healthz → {"status":"ok"}
[ ] Dashboard bisa dibuka di browser
[ ] Security Audit di dashboard: semua ✅
[ ] Settings → Secrets: PRIVATE_KEY & WALLET_ADDRESS ✅
[ ] Test Paper mode minimal 24 jam
[ ] Dana wallet bot = dana yang rela hilang (bukan wallet utama!)
[ ] PRIVATE_KEY sudah dibackup di tempat aman (offline)
```

---

## Referensi

| Link | Keterangan |
|---|---|
| [alchemy.com](https://alchemy.com) | Daftar RPC Base Network (gratis) |
| [aistudio.google.com](https://aistudio.google.com/app/apikey) | Gemini AI key (gratis) |
| [pm2.keymetrics.io](https://pm2.keymetrics.io) | Dokumentasi PM2 |
