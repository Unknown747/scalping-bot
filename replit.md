# MemeScalper AI Pro v2.0.0

An automated meme token trading bot for the Base Network. Uses a multi-AI voting system (Gemini, Groq, OpenRouter, Together, Huangfing) to make buy/sell decisions, with MEV protection, circuit breakers, and a real-time web dashboard.

## Tech Stack

- **Backend**: Go 1.21
- **Frontend**: HTML/JS with real-time WebSocket updates
- **Network**: Base Network (Layer 2, Chain ID 8453)
- **AI Providers**: Google Gemini, Groq, OpenRouter, Together, Huangfing
- **Data**: GeckoTerminal, DexScreener
- **Notifications**: Telegram Bot API

## Project Structure

```
main.go                  # HTTP server, WebSocket hub, main bot loop
internal/
  ai/                    # AI orchestrator + provider clients
  auth/                  # Session management for web dashboard
  checker/               # System health and RPC checks
  config/                # JSON config loader
  data/                  # GeckoTerminal and DexScreener clients
  kelly/                 # Kelly Criterion position sizing
  mev/                   # MEV sandwich attack detection
  notify/                # Telegram notifications
  position/              # Position tracking and PnL
  rpc/                   # Multi-endpoint RPC with failover
web/
  index.html             # Main dashboard
  login.html             # Login page
config.json              # Trading and risk management parameters
```

## Running the App

The app starts automatically via the "Start application" workflow on port 5000.

## Environment Variables (Secrets)

Set these in Replit Secrets:

| Secret | Required | Description |
|--------|----------|-------------|
| `BOT_PASSWORD` | Yes | Password for the web dashboard login |
| `WALLET_ADDRESS` | For live trading | Your Base Network wallet address |
| `WALLET_PRIVATE_KEY` | For live trading | Your wallet private key |
| `GEMINI_API_KEY` | Optional | Google Gemini AI key |
| `GROQ_API_KEY` | Optional | Groq AI key |
| `OPENROUTER_API_KEY` | Optional | OpenRouter AI key |
| `TOGETHER_API_KEY` | Optional | Together AI key |
| `HUANGFING_API_KEY` | Optional | Huangfing AI key |
| `TELEGRAM_BOT_TOKEN` | Optional | Telegram bot token for notifications |
| `TELEGRAM_CHAT_ID` | Optional | Telegram chat ID for notifications |

## Non-Secret Config (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `BOT_USERNAME` | `admin` | Dashboard login username |
| `AUTO_START` | `true` | Auto-start bot in simulation mode |
| `LOG_LEVEL` | `debug` | Log verbosity |

## User Preferences

- Use Go standard conventions and package structure
- Keep secrets in Replit Secrets, not .env files
- Port 5000 for the web dashboard
