# MemeScalper AI Pro v2.0.0

Bot trading otomatis untuk scalping meme token di **Base Network**, menggunakan sistem voting **5 model AI** secara paralel dengan proteksi MEV, Kelly Criterion sizing, GoPlus on-chain security check, dan rotasi API key otomatis. Semua trading menggunakan **WETH** sebagai base currency.

---

## Fitur Utama

| Fitur | Keterangan |
|---|---|
| **Multi-AI Voting (5 Provider)** | Gemini, Groq, OpenRouter, Together, Huangfing — voting berbobot paralel setiap keputusan |
| **Rotasi Gemini API Key** | Dukung hingga 9 Gemini key, rotasi otomatis saat key kena rate limit (429) |
| **Fallback Otomatis** | Saat semua Gemini key habis → Groq + Huangfing dapat bobot ekstra |
| **GoPlus Security Check** | Cek on-chain: dev holding, top-10 holder, tax, honeypot, mintable — GRATIS tanpa API key |
| **Multi-TP Exit** | TP1 +30% (jual 25%), TP2 +50% (jual 25%), TP3 +80% (jual 50%) |
| **WETH Base Currency** | Semua trade: WETH→MEME (beli) dan MEME→WETH (jual) |
| **MEV Protection** | Deteksi sandwich attack, random delay 100–500ms, Flashbots relay |
| **Kelly Criterion** | Position sizing adaptif berdasarkan win rate dan reward:risk historis |
| **Circuit Breaker** | Pause otomatis setelah consecutive loss melebihi threshold |
| **Trailing Stop** | Stop-loss naik otomatis mengikuti harga naik untuk lock profit |
| **Emergency Stop** | Tombol paksa tutup semua posisi sekaligus dari dashboard |
| **Simulation Mode** | Uji strategi tanpa modal nyata — statistik terpisah dari live |
| **Web Dashboard** | Real-time via WebSocket: stats, posisi, AI panel, log, riwayat trade |
| **Notifikasi Telegram** | Alert setiap trade, circuit breaker, start/stop |
| **Multi-RPC Failover** | 8 endpoint RPC Base dengan health check otomatis |

---

## Arsitektur

```
main.go                      ← HTTP server, WebSocket hub, bot loop utama
├── internal/ai/
│   ├── orchestrator.go      ← Multi-provider voting + fallback logic
│   ├── gemini.go            ← Gemini client (pakai GeminiKeyPool)
│   ├── gemini_pool.go       ← Multi-key rotation, cooldown, stats
│   ├── groq.go              ← Groq / Llama-3 client
│   ├── openrouter.go        ← OpenRouter aggregator client
│   ├── together.go          ← Together AI client
│   └── huangfing.go         ← Huangfing AI client
├── internal/auth/
│   └── session.go           ← Cookie session, brute-force lockout (5 percobaan / 10 menit)
├── internal/checker/
│   ├── checker.go           ← System health check (API keys, RPC, WETH balance)
│   └── goplus.go            ← GoPlus Security API: dev%, holder%, tax, honeypot (gratis)
├── internal/config/
│   ├── loader.go            ← config.json parser + semua struct config
│   └── helpers.go           ← ScalpingStrategies() helper
├── internal/data/
│   ├── geckoterm.go         ← GeckoTerminal API (sumber data utama)
│   └── dexscreener.go       ← DexScreener API (fallback)
├── internal/kelly/
│   └── kelly.go             ← Kelly Criterion position sizing
├── internal/mev/
│   └── sandwich_detector.go ← Deteksi sandwich attack + random delay
├── internal/notify/
│   └── telegram.go          ← Telegram bot notifications
├── internal/position/
│   └── tracker.go           ← Position tracker + multi-TP fields + CloseAll()
├── internal/rpc/
│   └── multi_rpc.go         ← Multi-endpoint RPC dengan failover
└── web/
    ├── index.html           ← Dashboard utama (WebSocket real-time)
    └── login.html           ← Halaman login
```

---

## Setup & Konfigurasi

### 1. Prasyarat

- Go 1.21+
- Wallet Base Network dengan saldo WETH (untuk live trading)
- Minimal satu API key AI (Gemini atau Groq direkomendasikan — keduanya **gratis**)

### 2. Environment Variables / Secrets

> **Di Replit:** tambahkan ke **Tools → Secrets**
> **Di VPS:** isi file `.env` (salin dari `.env.example`)

#### Wajib

| Variabel | Keterangan |
|---|---|
| `BOT_PASSWORD` | Password login dashboard — **wajib diganti** dari default `admin123` |
| `WALLET_ADDRESS` | Alamat wallet Base Network (wajib untuk live trading) |
| `WALLET_PRIVATE_KEY` | Private key wallet (wajib untuk live trading) |

#### AI Providers (Semua GRATIS)

| Variabel | Bobot | Cara Dapat Gratis |
|---|---|---|
| `GEMINI_API_KEY` | 30% | https://aistudio.google.com/app/apikey — 1.500 req/hari |
| `GEMINI_API_KEY_2` … `GEMINI_API_KEY_9` | — | Key tambahan untuk rotasi |
| `GROQ_API_KEY` | 30% | https://console.groq.com — 14.400 req/hari |
| `OPENROUTER_API_KEY` | 20% | https://openrouter.ai — model gratis suffix `:free` |
| `TOGETHER_API_KEY` | 15% | https://api.together.ai — $1 kredit gratis |
| `HUANGFING_API_KEY` | 5% | Backup sekunder |

#### GoPlus Security (Otomatis — TIDAK Perlu API Key)

Bot secara otomatis memanggil GoPlus Security API (`https://api.gopluslabs.io`) untuk setiap token real yang lolos filter dasar. Tidak perlu daftar atau isi key apapun.

#### Opsional

| Variabel | Default | Keterangan |
|---|---|---|
| `BOT_USERNAME` | `admin` | Username login dashboard |
| `TELEGRAM_BOT_TOKEN` | — | Cara dapat: chat `@BotFather` di Telegram → `/newbot` |
| `TELEGRAM_CHAT_ID` | — | Cara dapat: chat `@userinfobot` di Telegram |
| `AUTO_START` | `true` | Bot langsung jalan dalam mode simulasi saat server start |
| `PORT` | `5000` | Port server web dashboard |

### 3. Rotasi Gemini API Key

Sistem mendukung hingga **9 Gemini API key** yang dirotasi otomatis:

**Cara 1 — Comma-separated (praktis):**
```
GEMINI_API_KEY=key1,key2,key3
```

**Cara 2 — Secret terpisah:**
```
GEMINI_API_KEY=key1
GEMINI_API_KEY_2=key2
GEMINI_API_KEY_3=key3
```

**Cara kerjanya:**
1. Key dicoba secara round-robin
2. Key yang kena 429 → disuspend **60 detik**, lalu otomatis aktif kembali
3. Kalau **semua key** sedang limit → Groq + Huangfing dapat redistribusi bobot Gemini
4. Status setiap key bisa dipantau di tab **System → Gemini API Key Pool**

### 4. Konfigurasi Trading (`config.json`)

Parameter penting di `config.json` (Pro Config — aktif):

```json
{
  "trading": {
    "position_size_usd": 1.0,
    "max_concurrent_positions": 3,
    "slippage_tolerance_percent": 10.0,
    "max_gas_price_gwei": 100
  },
  "scalping_strategies": {
    "momentum": {
      "take_profit_percent": 80.0,
      "stop_loss_percent": 20.0,
      "max_hold_minutes": 30
    },
    "multi_tp": {
      "tp1_percent": 30.0,  "tp1_sell_fraction": 0.25,
      "tp2_percent": 50.0,  "tp2_sell_fraction": 0.25,
      "tp3_percent": 80.0,  "tp3_sell_fraction": 0.50
    },
    "trailing_stop": {
      "enabled": true,
      "activation_percent": 20.0,
      "trailing_distance_percent": 0.4
    }
  },
  "token_filters": {
    "min_liquidity_usd": 15000,
    "min_volume_5m_usd": 50000,
    "max_age_seconds": 1800
  },
  "goplus_filter": {
    "enabled": true,
    "max_dev_holding_percent": 1.0,
    "max_top10_holder_percent": 25.0,
    "min_smart_money_count": 3,
    "max_buy_tax_percent": 5.0,
    "max_sell_tax_percent": 5.0,
    "block_honeypot": true,
    "block_mintable": true
  },
  "risk_management": {
    "max_daily_loss_usd": 3.0,
    "max_daily_loss_percent": 30.0,
    "circuit_breaker": {
      "consecutive_losses_threshold": 5,
      "pause_minutes": 30
    }
  }
}
```

---

## Instalasi di VPS

### Instalasi Pertama

```bash
# Clone atau upload project ke VPS
git clone <repo_url> /opt/meme-scalper
cd /opt/meme-scalper

# Jalankan installer (butuh root)
sudo bash install.sh
```

Script `install.sh` otomatis:
1. Install Go 1.21 jika belum ada
2. Build binary Go dengan optimasi produksi (`-ldflags="-s -w"`)
3. Buat systemd service (auto-start saat reboot)
4. Buka port 5000 di firewall (UFW)
5. Buat file `.env` template

Setelah install, **wajib isi** file `.env`:
```bash
nano /opt/meme-scalper/.env
# Isi GEMINI_API_KEY, GROQ_API_KEY, BOT_PASSWORD, dan WALLET_* jika live trading
systemctl start meme-scalper
```

### Update Bot

```bash
# Dari folder project yang sama
sudo bash update.sh

# Jika pakai git
sudo bash update.sh --pull

# Jika clone dari URL baru
sudo bash update.sh --git https://github.com/user/repo.git
```

`update.sh` otomatis:
1. Backup `.env`, `config.json`, dan binary lama
2. Build binary baru
3. Restart service
4. Rollback otomatis jika build gagal

### Build Manual (tanpa script)

```bash
export PATH=$PATH:/usr/local/go/bin
go mod tidy
go build -ldflags="-s -w" -o meme-scalper .
./meme-scalper
```

### Perintah Berguna di VPS

```bash
journalctl -u meme-scalper -f        # Log live
systemctl status meme-scalper         # Status service
systemctl restart meme-scalper        # Restart
systemctl stop meme-scalper           # Stop
nano /opt/meme-scalper/.env           # Edit config
bash /opt/meme-scalper/update.sh      # Update bot
```

---

## Menjalankan di Replit

Workflow "Start application" berjalan otomatis di port 5000.
Tambahkan semua API key di **Tools → Secrets**.

---

## Strategi Pro Config

### Multi-TP Exit (3 Level Take Profit)

| Level | Target | Jual |
|---|---|---|
| TP1 | +30% | 25% posisi |
| TP2 | +50% | 25% posisi |
| TP3 (Full Exit) | +80% | 50% posisi (sisa) |

### Parameter Risiko

| Parameter | Nilai |
|---|---|
| Stop Loss | -20% |
| Trailing Stop aktif dari | +20% |
| Max hold per posisi | 30 menit |
| Slippage toleransi | 10% |
| Max gas price | 100 GWEI |
| Volume 5 menit minimum | $50.000 |
| Likuiditas minimum | $15.000 |
| Usia token maksimal | 30 menit |
| Stop trading harian jika loss | $3 atau 30% modal |

### GoPlus On-Chain Security Filter

| Filter | Nilai | Sumber |
|---|---|---|
| Dev holding | < 1% | GoPlus API (gratis) |
| Top-10 holders | < 25% | GoPlus API (gratis) |
| Smart money wallets | ≥ 3 wallet EOA | GoPlus API (gratis) |
| Buy tax | < 5% | GoPlus API (gratis) |
| Sell tax | < 5% | GoPlus API (gratis) |
| Honeypot | Diblok otomatis | GoPlus API (gratis) |
| Mintable token | Diblok otomatis | GoPlus API (gratis) |

### Kondisi BUY — Semua harus terpenuhi:

1. Voting AI agregat: **BUY** (weighted majority ≥ confidence threshold)
2. Token lolos filter dasar (likuiditas, volume, usia, buy/sell ratio)
3. Token lolos GoPlus security check
4. MEV risk: **ACCEPTABLE**
5. Circuit breaker: **tidak aktif**
6. Daily loss: **belum melebihi batas**

---

## Sistem AI

### Voting Berbobot (5 Provider Paralel)

| Provider | Model | Bobot |
|---|---|---|
| Gemini | gemini-1.5-flash | 30% |
| Groq (Llama-3) | llama-3.1-8b-instant | 30% |
| OpenRouter | llama-3.2-3b-instruct:free | 20% |
| Together AI | Llama-3.2-3B-Instruct-Turbo | 15% |
| Huangfing | huangfing-pro | 5% |

Ketika semua Gemini key rate-limited, bobot 30% Gemini otomatis terdistribusi ke Groq dan Huangfing.

---

## Kelly Criterion Position Sizing

| Kondisi | Mode | Multiplier |
|---|---|---|
| < 10 trade (warmup) | `warmup` | 1.0× (base size) |
| Expected value negatif | `neg_edge` | 0.25× (minimum) |
| Normal | `adaptive` | 0.25× – 3.0× |
| Drawdown tinggi | `dd_damped` | Diturunkan proporsional |

---

## MEV Protection

| Fitur | Keterangan |
|---|---|
| Sandwich Detection | Hitung price impact vs liquidity sebelum setiap trade |
| Random Delay | Delay acak 100–500ms sebelum submit transaksi |
| Private Mempool | Dukungan Flashbots relay & BloxRoute |
| Max Sandwich Risk | Skip token jika estimated sandwich risk > 25% |

---

## Catatan Keamanan

- **Jangan commit** file `.env` atau private key ke repository (sudah di `.gitignore`)
- **Gunakan Simulation Mode** sebelum live trading untuk memvalidasi strategi
- **Set `BOT_PASSWORD` yang kuat** — auth custom dengan brute-force lockout (5 percobaan / 10 menit)
- **Session cookie** diset HttpOnly + SameSite Strict, TTL 24 jam
- **API key Gemini tidak pernah diekspos** di UI — hanya nomor urut (key#1, key#2)
- **WETH balance** dicek saat System Check; pastikan wallet punya cukup WETH sebelum live trading

---

## Lisensi

Private — untuk penggunaan internal saja.
