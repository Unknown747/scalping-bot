# MemeScalper AI Pro v2.0.0

Bot trading otomatis untuk scalping meme token di **Base Network**, menggunakan sistem voting **5 model AI** secara paralel dengan proteksi MEV, Kelly Criterion sizing, dan rotasi API key otomatis. Semua trading menggunakan **WETH** sebagai base currency.

---

## Fitur Utama

| Fitur | Keterangan |
|---|---|
| **Multi-AI Voting (5 Provider)** | Gemini, Groq, OpenRouter, Together, Huangfing — voting berbobot paralel setiap keputusan |
| **Rotasi Gemini API Key** | Dukung hingga 9 Gemini key, rotasi otomatis saat key kena rate limit (429) |
| **Fallback Otomatis** | Saat semua Gemini key habis → Groq + Huangfing dapat bobot ekstra |
| **WETH Base Currency** | Semua trade: WETH→MEME (beli) dan MEME→WETH (jual) |
| **MEV Protection** | Deteksi sandwich attack, random delay 100–500ms, Flashbots relay |
| **Kelly Criterion** | Position sizing adaptif berdasarkan win rate dan reward:risk historis |
| **Circuit Breaker** | Pause otomatis setelah consecutive loss melebihi threshold |
| **Trailing Stop** | Stop-loss naik otomatis mengikuti harga naik untuk lock profit |
| **Emergency Stop** | Tombol paksa tutup semua posisi sekaligus dari dashboard |
| **Split Stats Panel** | Statistik Live dan Simulasi dipisah — tidak tercampur |
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
│   └── checker.go           ← System health check (API keys, RPC, WETH balance)
├── internal/config/
│   └── loader.go            ← config.json parser
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
│   └── tracker.go           ← Position tracker + CloseAll() untuk Emergency Stop
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
- Minimal satu API key AI (Gemini atau Groq direkomendasikan)

### 2. Environment Variables / Secrets

> **Di Replit:** tambahkan ke **Tools → Secrets**
> **Lokal:** copy `.env.example` ke `.env` dan isi nilainya

#### Wajib

| Variabel | Keterangan |
|---|---|
| `BOT_PASSWORD` | Password login dashboard — **wajib diganti** dari default `admin123` |
| `WALLET_ADDRESS` | Alamat wallet Base Network (wajib untuk live trading) |
| `WALLET_PRIVATE_KEY` | Private key wallet (wajib untuk live trading) |

#### AI Providers

| Variabel | Bobot | Provider | Keterangan |
|---|---|---|---|
| `GEMINI_API_KEY` | 30% | Google Gemini | Primary. Dukung multi-key (lihat di bawah) |
| `GEMINI_API_KEY_2` … `GEMINI_API_KEY_9` | — | — | Key Gemini tambahan untuk rotasi |
| `GROQ_API_KEY` | 30% | Groq (Llama-3) | Backup utama saat Gemini limit |
| `OPENROUTER_API_KEY` | 20% | OpenRouter | Model gratis tersedia (suffix `:free`) |
| `TOGETHER_API_KEY` | 15% | Together AI | $1 kredit gratis untuk akun baru |
| `HUANGFING_API_KEY` | 5% | Huangfing | Backup sekunder saat Gemini limit |

> Minimal satu provider harus aktif. Makin banyak provider aktif, makin akurat voting.

#### Opsional

| Variabel | Default | Keterangan |
|---|---|---|
| `BOT_USERNAME` | `admin` | Username login dashboard |
| `TELEGRAM_BOT_TOKEN` | — | Token bot Telegram untuk notifikasi |
| `TELEGRAM_CHAT_ID` | — | Chat ID untuk menerima notifikasi |
| `AUTO_START` | `false` | Set `true` agar bot langsung jalan saat server start |
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
4. Status setiap key bisa dipantau di tab **🔧 System → 🔑 Gemini API Key Pool**

### 4. Konfigurasi Trading (`config.json`)

Parameter penting di `config.json`:

```json
{
  "trading": {
    "position_size_usd": 1.0,          // ukuran posisi per trade (USD)
    "max_concurrent_positions": 3,      // maks posisi terbuka bersamaan
    "max_daily_trades": 50,             // maks trade per hari
    "slippage_tolerance_percent": 0.5   // toleransi slippage
  },
  "scalping_strategies": {
    "momentum": {
      "take_profit_percent": 1.5,       // target profit per trade
      "stop_loss_percent": 0.8          // stop loss per trade
    },
    "trailing_stop": {
      "enabled": true,
      "activation_percent": 0.8,        // aktif setelah harga naik 0.8%
      "trailing_distance_percent": 0.4  // jarak trailing stop
    }
  },
  "risk_management": {
    "max_daily_loss_usd": 2.0,          // stop trading jika loss harian ≥ $2
    "circuit_breaker": {
      "consecutive_losses_threshold": 5, // pause setelah 5 loss beruntun
      "pause_minutes": 30               // durasi pause
    }
  },
  "kelly": {
    "enabled": true,
    "fraction": 0.5,                    // half-Kelly (lebih konservatif)
    "min_multiplier": 0.25,             // ukuran minimum 0.25× dari base
    "max_multiplier": 3.0,              // ukuran maksimum 3× dari base
    "min_trades_required": 10           // warmup: butuh 10 trade sebelum aktif
  }
}
```

### 5. Menjalankan

**Di Replit** — workflow "Start application" berjalan otomatis.

**Lokal:**
```bash
cp .env.example .env
# Edit .env dengan API key kamu
go run main.go
```

Dashboard tersedia di `http://localhost:5000`. Login dengan `BOT_USERNAME` / `BOT_PASSWORD`.

---

## Sistem AI

### Voting Berbobot (5 Provider Paralel)

| Provider | Model Default | Bobot |
|---|---|---|
| Gemini | gemini-1.5-flash | 30% |
| Groq (Llama-3) | llama-3.1-8b-instant | 30% |
| OpenRouter | llama-3.2-3b-instruct:free | 20% |
| Together AI | Llama-3.2-3B-Instruct-Turbo | 15% |
| Huangfing | huangfing-pro | 5% |

> Ketika Gemini semua key habis, bobot 30% Gemini dibagi rata ke Groq dan Huangfing.

### Kondisi BUY

Semua kondisi berikut harus terpenuhi:
- Voting AI agregat: **BUY** (setelah weighted majority)
- Confidence ≥ `min_confidence_threshold` (default 70)
- Token lolos semua filter (likuiditas, usia, buy/sell ratio)
- MEV risk: **ACCEPTABLE** (< 25%)
- Circuit breaker: **tidak aktif**
- Daily loss: **belum melebihi batas**

---

## Kelly Criterion Position Sizing

Bot menyesuaikan ukuran posisi secara adaptif berdasarkan performa historis:

| Kondisi | Mode | Multiplier |
|---|---|---|
| < 10 trade (warmup) | `warmup` | 1.0× (base size) |
| Expected value negatif | `neg_edge` | 0.25× (minimum) |
| Normal | `adaptive` | 0.25× – 3.0× |
| Drawdown tinggi | `dd_damped` / `dd_floor` | Diturunkan proporsional |

Multiplier ditampilkan live di dashboard (panel statistik, badge **Kelly Size**).

---

## Strategi Scalping

### Momentum Scalp (Primer)

| Parameter | Default |
|---|---|
| Take Profit | +1.5% |
| Stop Loss | -0.8% |
| Volume Spike | >2.5× rata-rata |
| Lookback | 5 candle |
| Max Hold | 8 menit |

### Grid Scalp (Sekunder)

| Parameter | Default |
|---|---|
| Take Profit | +1.2% |
| Stop Loss | -0.6% |
| Levels | 3 |

### Trailing Stop

Aktif setelah harga naik ≥ 0.8% dari entry. Stop-loss otomatis naik mengikuti harga dengan jarak 0.4%.

---

## Filter Token

| Filter | Default |
|---|---|
| Minimum likuiditas | $5,000 |
| Minimum volume 24h | $10,000 |
| Usia token | 5 menit – 1 jam |
| Harga maksimal | $0.01 |
| Jumlah transaksi 5m | ≥ 10 |
| Rasio buy/sell | 1.2× – 8.0× |
| Exclude honeypot | Ya |
| Exclude mintable | Ya |

---

## Risk Management

| Mekanisme | Keterangan |
|---|---|
| **Daily Loss Limit** | Bot berhenti jika loss harian ≥ `max_daily_loss_usd` ($2 default) |
| **Circuit Breaker** | Pause 30 menit setelah 5 consecutive loss beruntun |
| **Max Drawdown** | Alert di dashboard jika drawdown > 20% dari equity peak |
| **Max Concurrent** | Maksimal 3 posisi terbuka bersamaan |
| **Max Hold Time** | Posisi otomatis ditutup setelah 8 menit |
| **Max Daily Trades** | Maksimal 50 trade per hari |
| **Emergency Stop** | Tombol di dashboard: tutup semua posisi paksa + stop bot |

---

## MEV Protection

| Fitur | Keterangan |
|---|---|
| Sandwich Detection | Hitung price impact vs liquidity sebelum setiap trade |
| Random Delay | Delay acak 100–500ms sebelum submit transaksi |
| Private Mempool | Dukungan Flashbots relay & BloxRoute |
| Max Sandwich Risk | Skip token jika estimated sandwich risk > 25% |

---

## Dashboard Web

Tersedia di `http://localhost:5000` (atau domain Replit setelah di-deploy).

### Tab Dashboard

- **Statistik Live** — total trades, win rate, profit, Sharpe ratio, drawdown (mode LIVE saja)
- **Statistik Simulasi** — statistik terpisah untuk simulasi (tidak tercampur)
- **Kelly Size** — multiplier posisi saat ini + mode (warmup/adaptive/dd_damped)
- **Emergency Stop** — muncul otomatis saat ada posisi terbuka; tombol merah berkedip

### Tab Positions

Posisi terbuka real-time: harga live, PnL%, WETH amount, AI confidence, trailing stop status.

### Tab History

Riwayat 100 trade terakhir, chart PnL, export CSV.

### Tab System (🔧)

- **System Check** — verifikasi koneksi semua API, RPC, WETH balance
- **🔑 Gemini API Key Pool** — status setiap key: OK / LIMITED, cooldown countdown, total 429 hits, waktu throttle terakhir
- **AI Engine** — keputusan tiap model AI dengan confidence score
- **RPC Endpoints** — status semua endpoint Base Network

---

## WETH Trading

Semua posisi menggunakan **WETH** (`0x4200000000000000000000000000000000000006`) sebagai base currency:

1. **Open** — `WETH → MEME TOKEN` (swap lewat Uniswap v4 → v3 → Aerodrome → BaseSwap → PancakeSwap)
2. **Close** — `MEME TOKEN → WETH`
3. **PnL** — dihitung dalam USD dan WETH

Contoh log:
```
📈 OPEN BRETT | WETH→TOKEN | Entry: $0.000412 | Size: 0.000333 WETH ($1.00) | TP: +1.5% | SL: -0.8%
✅ [TP] BRETT | PnL: +$0.0150 (+0.000005 WETH) | Returned: 0.000338 WETH
```

---

## Notifikasi Telegram

Bot mengirim alert untuk:
- Bot start / stop
- Setiap trade (BUY & CLOSE) dengan PnL dalam USD dan WETH
- Emergency Stop triggered
- Circuit breaker triggered
- Error kritis

---

## Ekspor Data

Tab History → tombol **Export CSV**. Format kolom:
```
Time, Symbol, EntryPrice, ExitPrice, SizeUSD, WETH_Amount, WETH_Price_Entry, PnL_USD, PnL_Pct, Reason, HeldSecs, Mode
```

---

## Catatan Keamanan

- **Jangan commit** file `.env` atau private key ke repository
- **Gunakan Simulation Mode** sebelum live trading untuk memvalidasi strategi
- **Set `BOT_PASSWORD` yang kuat** — dashboard tidak menggunakan auth Replit; auth custom dengan brute-force lockout (5 percobaan / 10 menit)
- **Session cookie** diset HttpOnly + SameSite Strict, TTL 24 jam
- **API key Gemini tidak pernah diekspos** di UI — hanya nomor urut (key#1, key#2) yang ditampilkan
- **WETH balance** dicek saat System Check; pastikan wallet punya cukup WETH sebelum live trading

---

## Lisensi

Private — untuk penggunaan internal saja.
