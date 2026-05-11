# Tutorial Install BASE Scalper di VPS

Panduan lengkap instalasi dari nol. Ada dua cara:

- **[Cara A — Docker](#cara-a--docker-rekomendasi)** ← paling mudah, tidak perlu paham Node.js
- **[Cara B — Manual / PM2](#cara-b--manual--pm2)** ← lebih banyak kontrol, tanpa Docker

---

## Persiapan Sebelum Mulai

### Yang Kamu Butuhkan

| Item | Keterangan |
|---|---|
| VPS | Ubuntu 22.04 atau 24.04 LTS |
| RAM | Minimal 1 GB (rekomendasi 2 GB) |
| Storage | Minimal 10 GB |
| Domain/IP | IP publik VPS sudah cukup |
| RPC URL | Daftar gratis di [alchemy.com](https://alchemy.com) |
| AI Key | Daftar gratis di [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| Wallet baru | Buat wallet **baru** khusus bot — jangan pakai wallet utama! |

### Provider VPS yang Bagus

| Provider | Harga mulai | Link |
|---|---|---|
| **Contabo** | $5/bln (4 GB RAM) | contabo.com |
| **Hetzner** | €4/bln (2 GB RAM) | hetzner.com |
| **DigitalOcean** | $6/bln (1 GB RAM) | digitalocean.com |
| **Vultr** | $6/bln (1 GB RAM) | vultr.com |

### Siapkan Data Ini Sebelum Mulai

Kamu perlu data berikut saat mengisi file `.env`. Siapkan dulu sebelum mulai:

```
✅ PRIVATE_KEY wallet bot (bukan wallet utama!)
✅ WALLET_ADDRESS wallet bot
✅ BASE_RPC_URL dari Alchemy: https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
✅ GEMINI_API_KEY dari Google AI Studio (opsional, untuk AI filter)
```

---

## Cara A — Docker (Rekomendasi)

### Langkah 1: Login ke VPS

```bash
ssh root@IP_VPS_KAMU
# atau jika pakai user biasa:
ssh username@IP_VPS_KAMU
```

---

### Langkah 2: Update Sistem

```bash
apt update && apt upgrade -y
```

---

### Langkah 3: Install Docker

```bash
# Download dan jalankan installer Docker
curl -fsSL https://get.docker.com | sh

# Tambahkan user kamu ke grup docker (agar tidak perlu sudo tiap perintah)
usermod -aG docker $USER

# Aktifkan perubahan grup
newgrp docker

# Cek Docker berjalan dengan benar
docker --version
docker compose version
```

Output yang benar:
```
Docker version 27.x.x, build xxxxx
Docker Compose version v2.x.x
```

---

### Langkah 4: Clone Repository

```bash
git clone https://github.com/YOUR_USERNAME/base-scalper.git
cd base-scalper
```

---

### Langkah 5: Buat File `.env`

```bash
# Salin template
cp artifacts/api-server/.env.example artifacts/api-server/.env

# Edit file
nano artifacts/api-server/.env
```

Di dalam nano, isi semua nilai:

```env
PORT=8080
NODE_ENV=production

# ─── Wajib diisi ──────────────────────────────────────────────────────────────

# Generate dengan: openssl rand -hex 32
SESSION_SECRET=TEMPEL_HASIL_OPENSSL_DISINI

# Password untuk login dashboard
DASHBOARD_PASSWORD=buat_password_kuat_kamu

# Wallet BOT (gunakan wallet baru, bukan wallet utama!)
PRIVATE_KEY=0xPRIVATE_KEY_WALLET_BOT_KAMU
WALLET_ADDRESS=0xALAMAT_WALLET_BOT_KAMU

# RPC dari Alchemy (daftar gratis di alchemy.com)
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY

# ─── MEV Protection (sudah ada default, bisa langsung dipakai) ────────────────
MEV_PROTECTION_RPC=https://mev-blocker.drpc.org
MEV_PROTECTION_RPC_BACKUP=https://rpc.flashbots.net/fast

# ─── AI Filter (opsional tapi direkomendasikan) ───────────────────────────────
# Daftar key gratis di: https://aistudio.google.com/app/apikey
AI_INTEGRATIONS_GEMINI_BASE_URL=https://generativelanguage.googleapis.com
AI_INTEGRATIONS_GEMINI_API_KEY=AIza_GEMINI_KEY_KAMU
```

**Cara generate SESSION_SECRET** (jalankan di terminal baru):
```bash
openssl rand -hex 32
```
Copy hasilnya dan tempel ke SESSION_SECRET.

**Cara simpan dan keluar dari nano:**
```
Ctrl+X  →  Y  →  Enter
```

---

### Langkah 6: Setup Firewall

```bash
# Aktifkan firewall
ufw enable

# Izinkan SSH (JANGAN dilewati atau kamu akan terkunci dari VPS!)
ufw allow ssh

# Izinkan akses dashboard (port 80)
ufw allow 80/tcp

# Cek status
ufw status
```

---

### Langkah 7: Jalankan Bot

```bash
docker compose up -d --build
```

Proses build pertama memakan waktu **5–15 menit** (download dependency, compile kode).

Pantau progressnya:
```bash
docker compose logs -f
```

Tekan `Ctrl+C` untuk berhenti memantau (bot tetap jalan di background).

---

### Langkah 8: Verifikasi Bot Berjalan

```bash
# Cek status container
docker compose ps
```

Output yang benar:
```
NAME                        STATUS           PORTS
base-scalper-api-1          Up (healthy)     0.0.0.0:8080->8080/tcp
base-scalper-dashboard-1    Up               0.0.0.0:80->80/tcp
```

```bash
# Test API
curl http://localhost:8080/api/healthz
# Output: {"status":"ok","uptime":...}

# Cek keamanan (semua harus "passed": true)
curl http://localhost:8080/api/security-audit | python3 -m json.tool
```

---

### Langkah 9: Buka Dashboard

Buka browser → masuk ke `http://IP_VPS_KAMU`

Login dengan `DASHBOARD_PASSWORD` yang sudah kamu set.

---

### Langkah 10: Mulai Trading

1. Cek **Security Audit** di dashboard — semua harus ✅
2. Cek **Settings → 🔑 Secrets** — `PRIVATE_KEY` dan `WALLET_ADDRESS` harus ✅
3. Mulai dengan **Paper mode** untuk testing
4. Jika sudah yakin → **Settings → Trading → Mode → LIVE** → **START BOT**

---

### Perintah Docker Penting

```bash
# Lihat log bot secara live
docker compose logs -f api

# Restart bot (misalnya setelah ganti .env)
docker compose restart api

# Stop semua
docker compose stop

# Start ulang semua
docker compose start

# Update ke versi terbaru
git pull
docker compose up -d --build

# Cek penggunaan RAM/CPU
docker stats
```

### Backup Database

Data trading disimpan di Docker volume `scalping_data`. Cara backup:

```bash
docker run --rm \
  -v scalping_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/backup-$(date +%Y%m%d-%H%M).tar.gz /data

# File backup akan muncul di folder base-scalper
ls *.tar.gz
```

---

## Cara B — Manual / PM2

### Langkah 1: Login ke VPS

```bash
ssh root@IP_VPS_KAMU
```

---

### Langkah 2: Update Sistem dan Install Tools

```bash
apt update && apt upgrade -y

# Install tools untuk compile native modules (better-sqlite3 perlu ini)
apt install -y git curl python3 make g++ libsqlite3-dev nginx
```

---

### Langkah 3: Install Node.js 22

```bash
# Install NVM (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Reload terminal
source ~/.bashrc

# Install Node.js 22 LTS
nvm install 22
nvm use 22
nvm alias default 22

# Verifikasi
node --version    # harus v22.x.x
```

---

### Langkah 4: Install pnpm dan PM2

```bash
npm install -g pnpm pm2
```

---

### Langkah 5: Clone dan Install Dependencies

```bash
git clone https://github.com/YOUR_USERNAME/base-scalper.git
cd base-scalper

pnpm install
```

Jika ada error saat install (biasanya `better-sqlite3`):
```bash
pnpm install --force
```

---

### Langkah 6: Buat File `.env`

```bash
cp artifacts/api-server/.env.example artifacts/api-server/.env
nano artifacts/api-server/.env
```

Isi sama seperti di Cara A Langkah 5.

---

### Langkah 7: Build Semua Package

```bash
# Build API server
pnpm --filter @workspace/api-server run build

# Build dashboard (BASE_PATH=/ wajib untuk production)
BASE_PATH=/ PORT=80 pnpm --filter @workspace/scalping-dashboard run build
```

---

### Langkah 8: Jalankan API dengan PM2

Buat file config PM2:

```bash
nano ecosystem.config.cjs
```

Isi file:
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

Simpan (`Ctrl+X → Y → Enter`), lalu jalankan:

```bash
pm2 start ecosystem.config.cjs

# Lihat log
pm2 logs scalper-api

# Set auto-start saat VPS reboot
pm2 save
pm2 startup
# ← Jalankan perintah yang muncul dari output pm2 startup
```

---

### Langkah 9: Setup Nginx

```bash
nano /etc/nginx/sites-available/scalper
```

Isi:
```nginx
server {
    listen 80;
    server_name _;

    # Ganti dengan path lengkap ke folder project kamu
    root /root/base-scalper/artifacts/scalping-dashboard/dist/public;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    # SPA — semua URL ke index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API ke bot
    location /api/ {
        proxy_pass http://localhost:8080/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
    }

    # WebSocket untuk real-time dashboard
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

Aktifkan dan test:

```bash
# Aktifkan config
ln -s /etc/nginx/sites-available/scalper /etc/nginx/sites-enabled/

# Hapus config default (opsional)
rm -f /etc/nginx/sites-enabled/default

# Test config nginx
nginx -t
# Output: syntax is ok / test is successful

# Reload nginx
systemctl reload nginx
systemctl enable nginx
```

---

### Langkah 10: Setup Firewall

```bash
ufw enable
ufw allow ssh
ufw allow 80/tcp
ufw status
```

---

### Langkah 11: Verifikasi dan Buka Dashboard

```bash
# Cek PM2
pm2 status

# Test API
curl http://localhost:8080/api/healthz

# Cek keamanan
curl http://localhost:8080/api/security-audit | python3 -m json.tool
```

Buka browser → `http://IP_VPS_KAMU` → login.

---

### Perintah PM2 Penting

```bash
pm2 status                         # Lihat semua process
pm2 logs scalper-api               # Lihat log real-time
pm2 logs scalper-api --lines 200   # Lihat 200 baris log terakhir
pm2 restart scalper-api            # Restart bot
pm2 stop scalper-api               # Stop bot
pm2 start scalper-api              # Start bot
pm2 monit                          # Monitor CPU & RAM live
```

### Update ke Versi Terbaru (Manual)

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
# Cek nginx jalan
systemctl status nginx

# Cek port 80 tidak diblokir
ufw status
curl http://localhost:80

# Docker: cek container
docker compose ps
docker compose logs dashboard
```

### Bot jalan tapi tidak ada trade

```bash
# Lihat log bot
docker compose logs -f api        # Docker
pm2 logs scalper-api              # Manual

# Test koneksi RPC
curl -X POST YOUR_BASE_RPC_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

Jika RPC OK tapi tidak ada trade:
- Buka dashboard → Settings → kurangi nilai `minSafetyScore` atau `min5mVolumeUsd`
- Cek Bot Log di dashboard untuk pesan error

### Error saat build / install

```bash
# Masalah better-sqlite3
apt install -y python3 make g++ libsqlite3-dev
pnpm install --force

# Masalah PORT/BASE_PATH (manual build)
BASE_PATH=/ PORT=80 pnpm --filter @workspace/scalping-dashboard run build
```

### Ganti PRIVATE_KEY atau settings lain

```bash
# Edit .env
nano artifacts/api-server/.env

# Restart bot
docker compose restart api     # Docker
pm2 restart scalper-api        # Manual
```

### Security audit gagal

```bash
curl http://localhost:8080/api/security-audit | python3 -m json.tool
# Baca pesan di setiap check yang "passed": false
# Perbaiki sesuai petunjuk, lalu restart bot
```

---

## Checklist Final Sebelum Live Trading

```
[ ] VPS berjalan, bot bisa diakses via browser
[ ] Security Audit di dashboard: semua ✅
[ ] Settings → 🔑 Secrets: PRIVATE_KEY dan WALLET_ADDRESS ✅
[ ] Test Paper mode minimal 24 jam
[ ] Wallet bot hanya punya dana yang rela hilang (bot baru, tetap ada risiko)
[ ] Backup PRIVATE_KEY wallet bot di tempat aman (offline)
[ ] Notifikasi Telegram sudah dikonfigurasi
```

---

## Referensi

| Link | Keterangan |
|---|---|
| [alchemy.com](https://alchemy.com) | Daftar RPC Base Network (gratis) |
| [aistudio.google.com](https://aistudio.google.com/app/apikey) | Gemini AI key (gratis) |
| [openrouter.ai](https://openrouter.ai/keys) | OpenRouter key (fallback AI) |
| [t.me/BotFather](https://t.me/BotFather) | Buat bot Telegram untuk notifikasi |
| [docs.docker.com](https://docs.docker.com) | Dokumentasi Docker |
| [pm2.keymetrics.io](https://pm2.keymetrics.io) | Dokumentasi PM2 |
