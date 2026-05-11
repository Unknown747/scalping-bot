# BASE Scalper

A real-time meme coin scalping dashboard and automated trading bot for Base Network. Paper trading mode by default — no real funds at risk until you configure a wallet and switch to live mode.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API + scalping engine (port 8080)
- `pnpm --filter @workspace/scalping-dashboard run dev` — run the React dashboard
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + Socket.io (same HTTP server)
- DB: SQLite via `better-sqlite3` (file: `artifacts/scalping.db`)
- Frontend: React + Vite + Tailwind + Framer Motion + socket.io-client
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle)

## Where things live

- `artifacts/api-server/src/scalping/` — core scalping engine
  - `config.ts` — ScalpingConfig type + defaults + risk presets
  - `database.ts` — SQLite schema + CRUD helpers
  - `TokenScanner.ts` — DexScreener + GeckoTerminal scanning
  - `SafetyChecker.ts` — GoPlus Labs honeypot/tax check
  - `PriceMonitor.ts` — real-time price polling via DexScreener
  - `SwapExecutor.ts` — Uniswap V3 swaps (paper + live)
  - `ScalpingBot.ts` — main bot orchestrator
- `artifacts/api-server/src/websocket.ts` — Socket.io setup
- `artifacts/api-server/src/botInstance.ts` — singleton bot instance
- `artifacts/api-server/src/routes/` — REST API routes
- `artifacts/scalping-dashboard/src/pages/Dashboard.tsx` — main dashboard page
- `artifacts/scalping-dashboard/src/components/` — all UI components
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)

## Architecture decisions

- Socket.io and Express share the same HTTP server for WebSocket + REST on one port
- SQLite (better-sqlite3) used instead of PostgreSQL — no infra needed, local file DB
- Paper mode simulates swaps without any real transactions or private keys
- All API data shapes come from the generated OpenAPI spec; frontend uses generated hooks
- `better-sqlite3` requires native compilation — run `make -j4` in the binding dir after fresh install

## Product

- **Bot Control**: START/STOP with risk level selector (conservative/moderate/aggressive)
- **Paper Trading**: Default mode, simulates buys/sells with fake ETH
- **Live Trading**: Set `PRIVATE_KEY` + `WALLET_ADDRESS` env vars and switch to LIVE mode
- **Token Scanner**: Scans DexScreener + GeckoTerminal for new Base Network meme coins
- **Safety Checks**: GoPlus Labs honeypot detection, sell tax, ownership checks
- **Position Management**: TP1/TP2/TP3 take-profits, trailing stop, stop-loss, max hold time
- **Real-time Dashboard**: WebSocket-powered live updates, IDR formatting, profit/loss coloring

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | Yes (auto) | Server port (set by workflow) |
| `SESSION_SECRET` | Yes | Secret for signing session cookies |
| `DASHBOARD_PASSWORD` | Yes | Password to access the dashboard (default: ScalpBase2024!) |
| `PRIVATE_KEY` | For live only | Wallet private key |
| `WALLET_ADDRESS` | For live only | Wallet public address |
| `BASE_RPC_URL` | Optional | Base RPC URL (default: mainnet.base.org) |
| `MEV_PROTECTION_RPC` | Optional | MEV-protected RPC for live trading |
| `SQLITE_PATH` | Optional | SQLite file path (default: artifacts/scalping.db) |

## Security

- All API routes require session authentication — unauthenticated requests return 401
- Password is stored as `DASHBOARD_PASSWORD` env variable; change via Replit Secrets
- Sessions last 7 days; users must re-login after expiry
- To change password: update `DASHBOARD_PASSWORD` in Secrets and restart the API server

## Gotchas

- `better-sqlite3` native bindings must be compiled: after fresh pnpm install, run `make -j4` in `node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/build/`
- Python 3 must be present for native builds (installed via `installLanguagePackages` if missing)
- Paper mode ignores `PRIVATE_KEY` — safe to test without a wallet
- The scalping engine scans every 8s and checks prices every 2s by default

## User preferences

- Default capital: 0.04 ETH (~200k IDR)
- IDR formatting: dot-separated thousands (e.g. Rp 1.493.664)
- Network: Base (Chain ID 8453)
- Default mode: paper trading

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
