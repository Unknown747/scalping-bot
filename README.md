# MemeScalper AI Pro v2.0.0

Bot trading otomatis untuk scalping meme token di **Base Network**, menggunakan sistem voting multi-AI dan proteksi MEV. Semua trading menggunakan **WETH** sebagai base currency.

---

## Fitur Utama

- **Multi-AI Voting** — tiga model AI (Gemini, Groq, Huangfing) voting berbobot untuk setiap keputusan beli/jual
- **WETH Base Currency** — semua trade menggunakan WETH (`0x4200...0006`) sebagai input token (WETH → MEME saat beli, MEME → WETH saat jual)
- **MEV Protection** — deteksi sandwich attack, random delay, dan dukungan private mempool / Flashbots relay
- **Circuit Breaker** — otomatis pause jika consecutive loss melebihi threshold
- **Trailing Stop** — stop-loss naik otomatis mengikuti harga naik untuk lock profit
- **Simulation Mode** — uji strategi tanpa modal nyata
- **Web Dashboard** — monitor real-time via browser dengan WebSocket
- **Notifikasi Telegram** — alert setiap trade, circuit breaker, dan bot start/stop
- **Multi-RPC Failover** — pool 8 endpoint RPC Base dengan health check otomatis

---

## Arsitektur

```
main.go                    ← Entry point, HTTP server, bot loop
├── internal/ai/           ← AI orchestrator (Gemini, Groq, Huangfing)
├── internal/auth/         ← Session management (username + password)
├── internal/checker/      ← System health checks + WETH balance
├── internal/config/       ← Config loader (config.json)
├── internal/data/         ← GeckoTerminal + DexScreener clients, WETH price
├── internal/mev/          ← Sandwich detector + random delay
├── internal/notify/       ← Telegram bot
├── internal/position/     ← Position tracker (termasuk WETH amount)
├── internal/rpc/          ← Multi-RPC client dengan failover
└── web/                   ← Frontend dashboard (index.html, login.html)
```

---

## Setup

### 1. Prasyarat

- Go 1.21+
- Wallet Base Network dengan saldo WETH
- API key untuk minimal satu AI provider

### 2. Environment Variables / Secrets

Set semua variabel berikut di Replit Secrets (atau file `.env` untuk lokal):

| Variabel | Keterangan | Wajib |
|---|---|---|
| `WALLET_ADDRESS` | Alamat wallet Base Network | Ya (live mode) |
| `WALLET_PRIVATE_KEY` | Private key wallet | Ya (live mode) |
| `GEMINI_API_KEY` | Google Gemini API key | Direkomendasikan |
| `GROQ_API_KEY` | Groq API key (Llama-3) | Direkomendasikan |
| `HUANGFING_API_KEY` | Huangfing AI API key | Opsional |
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram | Opsional |
| `TELEGRAM_CHAT_ID` | Chat ID Telegram | Opsional |
| `BOT_USERNAME` | Username login dashboard | Default: `admin` |
| `BOT_PASSWORD` | Password login dashboard | Wajib diganti |

### 3. Konfigurasi (`config.json`)

File konfigurasi utama berada di root project. Parameter penting:

```json
{
  "weth": {
    "address": "0x4200000000000000000000000000000000000006",
    "symbol": "WETH",
    "decimals": 18,
    "network": "base"
  },
  "trading": {
    "position_size_usd": 1.0,
    "max_concurrent_positions": 3,
    "max_daily_trades": 50,
    "slippage_tolerance_percent": 0.5
  },
  "risk_management": {
    "max_daily_loss_usd": 2.0,
    "circuit_breaker": {
      "consecutive_losses_threshold": 5,
      "pause_minutes": 30
    }
  }
}
```

### 4. Menjalankan

```bash
go run main.go
```

Bot akan tersedia di `http://localhost:5000`. Login menggunakan `BOT_USERNAME` / `BOT_PASSWORD`.

---

## WETH Trading

### Cara Kerja

Semua posisi menggunakan **WETH** sebagai base currency, bukan ETH native:

1. **Open Position** — bot menghitung berapa WETH yang setara dengan `position_size_usd`, lalu melakukan swap: `WETH → MEME TOKEN`
2. **Close Position** — bot melakukan swap balik: `MEME TOKEN → WETH`
3. **PnL** — dihitung dalam USD dan WETH sekaligus

Contoh log:
```
📈 OPEN BRETT | WETH→TOKEN | Entry: $0.000412 | Size: 0.000333 WETH ($1.00) | TP: +1.5% | SL: -0.8% | Conf: 82%
✅ [TP] BRETT | PnL: +0.0150 USD (+0.000005 WETH) | Returned: 0.000338 WETH
```

### WETH di Base Network

- **Address:** `0x4200000000000000000000000000000000000006`
- **DEX:** Uniswap v4 → v3 → Aerodrome → BaseSwap → PancakeSwap (urutan prioritas)
- **Harga WETH** diambil live dari GeckoTerminal setiap kali trade dibuka

---

## Sistem AI

### Voting Berbobot

Tiga provider AI menganalisis setiap token secara paralel:

| Provider | Model | Bobot |
|---|---|---|
| Gemini | gemini-1.5-flash | 40% |
| Groq (Llama-3) | llama-3.3-70b-versatile | 35% |
| Huangfing | huangfing-pro | 25% |

### Kondisi BUY

- Semua AI voting agregat: **BUY**
- Confidence ≥ threshold (`min_confidence_threshold`, default 70)
- Token lolos semua filter (likuiditas, usia, buy/sell ratio)
- MEV risk: **ACCEPTABLE**

---

## Strategi Scalping

### Momentum Scalp (Primer)

| Parameter | Default |
|---|---|
| Take Profit | +1.5% |
| Stop Loss | -0.8% |
| Volume Spike | >2.5x rata-rata |
| Lookback | 5 candle |

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

Bot hanya mempertimbangkan token yang memenuhi semua kriteria:

| Filter | Default |
|---|---|
| Minimum likuiditas | $5,000 |
| Minimum volume 24h | $10,000 |
| Usia token | 5 menit – 1 jam |
| Harga maksimal | $0.01 |
| Jumlah transaksi 5m | ≥ 10 |
| Rasio buy/sell | 1.2x – 8.0x |
| Exclude honeypot | Ya |
| Exclude mintable | Ya |

---

## Risk Management

| Mekanisme | Keterangan |
|---|---|
| **Daily Loss Limit** | Bot berhenti jika loss harian ≥ `max_daily_loss_usd` ($2 default) |
| **Circuit Breaker** | Pause 30 menit setelah 5 consecutive loss |
| **Max Drawdown** | Alert jika drawdown melebihi 20% dari equity peak |
| **Max Concurrent** | Maksimal 3 posisi terbuka bersamaan |
| **Max Hold Time** | Posisi otomatis ditutup setelah 8 menit |
| **Max Daily Trades** | Maksimal 50 trade per hari |

---

## MEV Protection

| Fitur | Keterangan |
|---|---|
| Sandwich Detection | Hitung price impact vs liquidity sebelum trade |
| Random Delay | Delay acak 100–500ms sebelum submit transaksi |
| Private Mempool | Dukungan Flashbots relay & BloxRoute |
| Max Sandwich Risk | Skip jika estimated sandwich risk > 25% |

---

## Dashboard Web

Tersedia di `http://localhost:5000` (atau domain Replit). Fitur:

- **Overview** — statistik real-time: total trades, win rate, PnL, Sharpe ratio, drawdown
- **Positions** — posisi terbuka dengan harga live, PnL%, WETH amount, trailing stop status
- **AI Panel** — keputusan tiap model AI dengan confidence score
- **Logs** — stream log bot real-time via WebSocket
- **History** — riwayat 100 trade terakhir dengan chart PnL
- **System Check** — verifikasi koneksi semua API, RPC, dan WETH balance

---

## Notifikasi Telegram

Bot mengirim notifikasi untuk:
- Bot start/stop
- Setiap trade (BUY & CLOSE) dengan PnL dalam USD dan WETH
- Circuit breaker triggered
- Error kritis

---

## Ekspor Data

Riwayat trade bisa diunduh sebagai CSV dari tab History. Format kolom:

```
Time, Symbol, EntryPrice, ExitPrice, SizeUSD, WETH_Amount, WETH_Price_Entry, PnL_USD, PnL_Pct, Reason, HeldSecs, Mode
```

---

## Catatan Keamanan

- Jangan pernah commit file `.env` atau private key ke repository
- Gunakan **Simulation Mode** sebelum live trading
- Set `BOT_PASSWORD` yang kuat — dashboard tidak menggunakan auth Replit
- WETH balance dicek saat System Check; pastikan wallet punya cukup WETH sebelum live
- Audit dependency: semua vulnerability saat ini moderate, berasal dari Go stdlib 1.21 — upgrade ke Go 1.23 untuk clear semua CVE

---

## Lisensi

Private — untuk penggunaan internal saja.
