# MemeScalper AI Pro v2.0.0

Bot trading otomatis untuk scalping meme token di **Base Network**, menggunakan sistem voting **5 model AI** secara paralel dengan eksekusi swap on-chain nyata di Uniswap V3, proteksi MEV, Kelly Criterion sizing, GoPlus on-chain security check, dan rotasi API key otomatis. Semua trading menggunakan **WETH** sebagai base currency.

---

## Fitur Utama

| Fitur | Keterangan |
|---|---|
| **On-Chain Swap Executor** | Buy/Sell nyata via Uniswap V3 SwapRouter02 — gas pricing dinamis dari RPC |
| **Multi-AI Voting (5 Provider)** | Gemini, Groq, OpenRouter, Together, Huangfing — voting berbobot paralel |
| **Rotasi Gemini API Key** | Dukung hingga 9 Gemini key, rotasi otomatis saat kena rate limit (429) |
| **Fallback Otomatis** | Saat semua Gemini key habis → Groq + Huangfing dapat bobot ekstra |
| **GoPlus Security Check** | Cek on-chain: dev holding, top-10 holder, tax, honeypot, mintable — GRATIS |
| **Multi-TP Exit** | TP1 +30% (jual 25%), TP2 +50% (jual 25%), TP3 +80% (jual 50%) |
| **WETH Base Currency** | Semua trade: WETH→MEME (beli) dan MEME→WETH (jual) |
| **MEV Protection** | Deteksi sandwich attack, random delay 100–500ms |
| **Kelly Criterion** | Position sizing adaptif berdasarkan win rate dan reward:risk historis |
| **Circuit Breaker** | Pause otomatis setelah consecutive loss melebihi threshold |
| **Trailing Stop** | Stop-loss naik otomatis mengikuti harga naik untuk lock profit |
| **Emergency Stop** | Tombol paksa tutup semua posisi sekaligus dari dashboard |
| **Simulation Mode** | Uji strategi tanpa modal nyata — statistik terpisah dari live |
| **Web Dashboard** | Real-time via WebSocket: stats, posisi, AI panel, log, riwayat trade |
| **Notifikasi Telegram** | Alert setiap trade, circuit breaker, start/stop |
| **Multi-RPC Failover** | Endpoint RPC Base dengan health check dan failover otomatis |

---

## Arsitektur

```
main.go                      ← HTTP server, WebSocket hub, bot loop utama
├── cmd/
│   └── testswap/main.go     ← Script uji swap on-chain Buy/Sell (dev tool)
├── internal/
│   ├── ai/
│   │   ├── orchestrator.go  ← Multi-provider voting + fallback logic
│   │   ├── gemini.go        ← Gemini client (pakai GeminiKeyPool)
│   │   ├── gemini_pool.go   ← Multi-key rotation, cooldown, stats
│   │   ├── groq.go          ← Groq / Llama-3 client
│   │   ├── openrouter.go    ← OpenRouter aggregator client
│   │   ├── together.go      ← Together AI client
│   │   └── huangfing.go     ← Huangfing AI client
│   ├── auth/
│   │   └── session.go       ← Cookie session, brute-force lockout (5× / 10 menit)
│   ├── checker/
│   │   ├── checker.go       ← System health check (API keys, RPC, WETH balance)
│   │   └── goplus.go        ← GoPlus Security API (gratis, tanpa key)
│   ├── config/
│   │   ├── loader.go        ← config.json parser + semua struct config
│   │   └── helpers.go       ← ScalpingStrategies() helper
│   ├── data/
│   │   ├── geckoterm.go     ← GeckoTerminal API (sumber data utama)
│   │   └── dexscreener.go  ← DexScreener API (fallback)
│   ├── kelly/
│   │   └── kelly.go         ← Kelly Criterion position sizing
│   ├── mev/
│   │   └── sandwich_detector.go ← Deteksi sandwich attack + random delay
│   ├── notify/
│   │   └── telegram.go      ← Telegram bot notifications
│   ├── position/
│   │   └── tracker.go       ← Position tracker + multi-TP fields + CloseAll()
│   ├── rpc/
│   │   └── multi_rpc.go     ← Multi-endpoint RPC dengan failover
│   └── swap/
│       └── swap.go          ← On-chain swap executor (Uniswap V3 + EIP-1559)
└── web/
    ├── index.html           ← Dashboard utama (WebSocket real-time)
    └── login.html           ← Halaman login
```

---

## Setup & Konfigurasi

### 1. Prasyarat

- Go 1.21+
- Wallet Base Network dengan saldo **ETH** (untuk gas) dan **WETH** (untuk trading)
- Minimal satu API key AI (Gemini atau Groq direkomendasikan — keduanya **gratis**)

### 2. Environment Variables / Secrets

> **Di Replit:** tambahkan ke **Tools → Secrets**
> **Di VPS:** isi file `.env` (salin dari `.env.example`)

#### Wajib

| Variabel | Keterangan |
|---|---|
| `BOT_PASSWORD` | Password login dashboard — **wajib diganti** dari default |
| `WALLET_ADDRESS` | Alamat wallet Base Network (wajib untuk live trading) |
| `WALLET_PRIVATE_KEY` | Private key wallet (wajib untuk live trading) |

#### AI Providers

| Variabel | Bobot | Cara Dapat |
|---|---|---|
| `GEMINI_API_KEY` | 30% | https://aistudio.google.com/apikey — gratis 1.500 req/hari |
| `GEMINI_API_KEY_2` … `GEMINI_API_KEY_9` | — | Key tambahan untuk rotasi otomatis |
| `GROQ_API_KEY` | 30% | https://console.groq.com — gratis 14.400 req/hari |
| `OPENROUTER_API_KEY` | 20% | https://openrouter.ai — model gratis suffix `:free` |
| `TOGETHER_API_KEY` | 15% | https://api.together.ai — free tier tersedia |
| `HUANGFING_API_KEY` | 5% | Backup sekunder |

#### GoPlus Security (Otomatis — TIDAK Perlu API Key)

Bot secara otomatis memanggil GoPlus Security API untuk setiap token. Tidak perlu daftar atau isi key apapun.

#### Opsional

| Variabel | Default | Keterangan |
|---|---|---|
| `BOT_USERNAME` | `admin` | Username login dashboard |
| `TELEGRAM_BOT_TOKEN` | — | Chat `@BotFather` di Telegram → `/newbot` |
| `TELEGRAM_CHAT_ID` | — | Chat `@userinfobot` di Telegram |
| `AUTO_START` | `true` | Bot langsung jalan dalam mode simulasi saat server start |
| `PORT` | `5000` | Port server web dashboard |

### 3. Wallet — Saldo yang Dibutuhkan

| Aset | Minimum | Fungsi |
|---|---|---|
| **ETH** | 0.001 ETH | Gas fee transaksi (Base sangat murah, ~0.001–0.01 gwei) |
| **WETH** | Sesuai `position_size_usd` | Modal trading (WETH = Wrapped ETH di Base) |

Cara wrap ETH → WETH:
- Kirim ETH ke contract WETH Base: `0x4200000000000000000000000000000000000006`
- Panggil fungsi `deposit()` dengan mengirim ETH yang ingin di-wrap
- Atau swap via Uniswap/Aerodrome UI

### 4. Rotasi Gemini API Key

Sistem mendukung hingga **9 Gemini API key** yang dirotasi otomatis:

**Cara 1 — Comma-separated:**
```
GEMINI_API_KEY=key1,key2,key3
```

**Cara 2 — Secret terpisah:**
```
GEMINI_API_KEY=key1
GEMINI_API_KEY_2=key2
GEMINI_API_KEY_3=key3
```

Cara kerjanya:
1. Key dicoba secara round-robin
2. Key yang kena 429 → disuspend **60 detik**, lalu otomatis aktif kembali
3. Kalau **semua key** sedang limit → Groq + Huangfing dapat redistribusi bobot Gemini
4. Status setiap key bisa dipantau di tab **System → Gemini API Key Pool**

### 5. Konfigurasi Trading (`config.json`)

Parameter penting di `config.json`:

```json
{
  "trading": {
    "position_size_usd": 0.5,
    "max_concurrent_positions": 3,
    "slippage_tolerance_percent": 10.0
  },
  "scalping_strategies": {
    "momentum": {
      "take_profit_percent": 80.0,
      "stop_loss_percent": 20.0,
      "max_hold_minutes": 30
    },
    "multi_tp": {
      "enabled": true,
      "tp1_percent": 30.0,  "tp1_exit_fraction": 0.25,
      "tp2_percent": 50.0,  "tp2_exit_fraction": 0.25,
      "tp3_percent": 80.0,  "tp3_exit_fraction": 0.50
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
  "risk_management": {
    "max_daily_loss_usd": 3.0,
    "circuit_breaker": {
      "consecutive_losses_threshold": 5,
      "pause_minutes": 30
    }
  }
}
```

---

## Test Swap On-Chain

Script `cmd/testswap/main.go` untuk verifikasi eksekutor swap berfungsi sebelum live trading:

```bash
go run cmd/testswap/main.go
```

Script ini akan:
1. Tampilkan alamat wallet dan saldo ETH/WETH
2. Beli 0.0001 WETH senilai token DEGEN di Uniswap V3
3. Jual kembali semua token DEGEN → WETH
4. Tampilkan summary + link BaseScan kedua transaksi

Gas yang dibutuhkan: < 0.00001 ETH (sangat murah di Base).

---

## Instalasi di VPS

### Instalasi Pertama

```bash
git clone <repo_url> /opt/meme-scalper
cd /opt/meme-scalper
sudo bash install.sh
```

Script `install.sh` otomatis:
1. Install Go jika belum ada
2. Build binary Go dengan optimasi produksi (`-ldflags="-s -w"`)
3. Buat systemd service (auto-start saat reboot)
4. Buka port 5000 di firewall (UFW)
5. Buat file `.env` template

Setelah install, **wajib isi** file `.env`:
```bash
nano /opt/meme-scalper/.env
# Isi GROQ_API_KEY, BOT_PASSWORD, WALLET_PRIVATE_KEY, WALLET_ADDRESS
systemctl start meme-scalper
```

### Update Bot

```bash
sudo bash update.sh          # update dari folder ini
sudo bash update.sh --pull   # git pull lalu update
```

`update.sh` otomatis:
1. Backup `.env`, `config.json`, dan binary lama
2. Build binary baru
3. Restart service
4. Rollback otomatis jika build gagal

### Build Manual

```bash
go mod tidy
go build -ldflags="-s -w" -o meme-scalper .
./meme-scalper
```

### Perintah Berguna di VPS

```bash
journalctl -u meme-scalper -f        # Log live
systemctl status meme-scalper         # Status service
systemctl restart meme-scalper        # Restart
nano /opt/meme-scalper/.env           # Edit config
```

---

## Menjalankan di Replit

Workflow "Start application" berjalan otomatis di port 5000.
Tambahkan semua API key di **Tools → Secrets**.

---

## Sistem AI

### Voting Berbobot (5 Provider Paralel)

| Provider | Model | Bobot |
|---|---|---|
| Gemini | gemini-1.5-flash | 30% |
| Groq | llama-3.1-8b-instant | 30% |
| OpenRouter | meta-llama/llama-3.2-3b-instruct:free | 20% |
| Together AI | meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo | 15% |
| Huangfing | huangfing-pro | 5% |

Ketika semua Gemini key rate-limited, bobot 30% Gemini otomatis terdistribusi ke Groq dan Huangfing.

---

## On-Chain Swap Executor

| Komponen | Detail |
|---|---|
| DEX | Uniswap V3 (`SwapRouter02`) |
| Router | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| Fee Tiers (fallback) | 10000 → 3000 → 500 → 100 |
| Gas Pricing | Dinamis dari `eth_gasPrice` RPC + 1.3× buffer |
| Gas Cap | 0.5 gwei (Base L2 biasanya 0.001–0.01 gwei) |
| Signing | EIP-1559 (type 0x02) + secp256k1 |
| Approval | ERC20 `approve(MAX_UINT256)` sebelum setiap swap |

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
| Volume 5 menit minimum | $50.000 |
| Likuiditas minimum | $15.000 |
| Usia token maksimal | 30 menit |
| Stop trading harian jika loss | $3 atau 30% modal |

### GoPlus On-Chain Security Filter

| Filter | Nilai |
|---|---|
| Dev holding | < 1% |
| Top-10 holders | < 25% |
| Smart money wallets | ≥ 3 wallet EOA |
| Buy tax | < 5% |
| Sell tax | < 5% |
| Honeypot | Diblok otomatis |
| Mintable token | Diblok otomatis |

### Kelly Criterion Position Sizing

| Kondisi | Mode | Multiplier |
|---|---|---|
| < 10 trade (warmup) | `warmup` | 1.0× (base size) |
| Expected value negatif | `neg_edge` | 0.25× (minimum) |
| Normal | `adaptive` | 0.25× – 3.0× |
| Drawdown tinggi | `dd_damped` | Diturunkan proporsional |

---

## Catatan Keamanan

- **Jangan commit** file `.env` atau private key ke repository (sudah di `.gitignore`)
- **Gunakan Simulation Mode** sebelum live trading untuk memvalidasi strategi
- **Set `BOT_PASSWORD` yang kuat** — brute-force lockout 5 percobaan / 10 menit
- **Session cookie** diset HttpOnly + SameSite Strict, TTL 24 jam
- **API key Gemini tidak pernah diekspos** di UI — hanya nomor urut (key#1, key#2)
- **WETH balance** dicek saat System Check; pastikan wallet punya cukup WETH sebelum live

---

## Lisensi

Private — untuk penggunaan internal saja.
