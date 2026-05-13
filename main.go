package main

import (
        "context"
        "encoding/json"
        "fmt"
        "log"
        "math"
        "math/rand"
        "net/http"
        "os"
        "strings"
        "sync"
        "time"

        "github.com/gorilla/websocket"
        "github.com/joho/godotenv"

        "meme-scalper-ai/internal/ai"
        "meme-scalper-ai/internal/auth"
        "meme-scalper-ai/internal/checker"
        "meme-scalper-ai/internal/config"
        "meme-scalper-ai/internal/data"
        "meme-scalper-ai/internal/kelly"
        "meme-scalper-ai/internal/mev"
        "meme-scalper-ai/internal/notify"
        "meme-scalper-ai/internal/position"
        rpcpkg "meme-scalper-ai/internal/rpc"
)

var upgrader = websocket.Upgrader{
        CheckOrigin: func(r *http.Request) bool { return true },
}

type BotStats struct {
        TotalTrades     int     `json:"totalTrades"`
        WinningTrades   int     `json:"winningTrades"`
        LosingTrades    int     `json:"losingTrades"`
        WinRate         float64 `json:"winRate"`
        TotalProfitUSD  float64 `json:"totalProfitUSD"`
        DailyPnL        float64 `json:"dailyPnL"`
        ActivePositions int     `json:"activePositions"`
        MaxDrawdownPct  float64 `json:"maxDrawdownPct"`
        SharpeRatio     float64 `json:"sharpeRatio"`
        BestTradePct    float64 `json:"bestTradePct"`
        WorstTradePct   float64 `json:"worstTradePct"`
        AvgHoldSecs     int     `json:"avgHoldSecs"`
        KellyMultiplier float64 `json:"kellyMultiplier"`
        KellyMode       string  `json:"kellyMode"`
}

type TradeRecord struct {
        Symbol         string  `json:"symbol"`
        EntryPrice     float64 `json:"entryPrice"`
        ExitPrice      float64 `json:"exitPrice"`
        SizeUSD        float64 `json:"sizeUSD"`
        WETHAmount     float64 `json:"wethAmount"`
        WETHPriceEntry float64 `json:"wethPriceEntry"`
        PnL            float64 `json:"pnl"`
        PnLPct         float64 `json:"pnlPct"`
        Reason         string  `json:"reason"`
        HeldSecs       int     `json:"heldSecs"`
        ClosedAt       string  `json:"closedAt"`
        SimMode        bool    `json:"simMode"`
}

type WSMessage struct {
        Type string      `json:"type"`
        Data interface{} `json:"data"`
}

type BotState struct {
        Running         bool
        SimMode         bool
        Stats           BotStats
        mu              sync.RWMutex
        ConsecutiveLoss int
        CircuitBroken   bool
        CircuitUntil    time.Time
}

// walletHTTPClient is a shared client for all eth_call / eth_getBalance RPC
// calls made by rpcCall(). Reusing it avoids creating a new TCP connection on
// every wallet-balance poll (every 10 s from the frontend).
var walletHTTPClient = &http.Client{Timeout: 5 * time.Second}

var (
        cfg        *config.Config
        rpcClient  *rpcpkg.MultiRPCClient
        aiOrch     *ai.AIOrchestrator
        mevShield  *mev.SandwichDetector
        geckoData  *data.GeckoClient
        dexData    *data.DexScreenerClient
        tgBot      *notify.TelegramBot
        sessions   *auth.Manager
        posTracker   *position.Tracker
        tradeHistory  []TradeRecord
        historyMu     sync.Mutex
        pnlReturns    []float64
        totalHeldSecs int
        equityPeak    float64
        returnsMu     sync.Mutex
        botState      = &BotState{}
        clients    = make(map[*websocket.Conn]bool)
        clientsMu  sync.Mutex
)

func main() {
        _ = godotenv.Load(".env")

        var err error
        cfg, err = config.Load("config.json")
        if err != nil {
                log.Fatalf("Failed to load config: %v", err)
        }

        rpcClient = rpcpkg.NewMultiRPCClient(cfg.RPCConfig.PrimaryEndpoints, cfg.RPCConfig.BackupEndpoints)

        weights := cfg.AIConfig.AIWeights
        if weights == nil {
                weights = map[string]float64{"gemini": 0.40, "groq": 0.35, "huangfing": 0.25}
        }
        aiOrch = ai.NewOrchestrator(
                cfg.AIConfig.Gemini.Model, cfg.AIConfig.Gemini.TimeoutSeconds,
                cfg.AIConfig.Groq.Model, cfg.AIConfig.Groq.TimeoutSeconds,
                cfg.AIConfig.Huangfing.BaseURL, cfg.AIConfig.Huangfing.Model, cfg.AIConfig.Huangfing.TimeoutSeconds,
                weights,
        )

        mevShield = mev.NewSandwichDetector(
                cfg.MEV.MaxSandwichRiskPct,
                cfg.MEV.RandomDelayMs["min"],
                cfg.MEV.RandomDelayMs["max"],
        )

        geckoData = data.NewGeckoClient()
        dexData = data.NewDexScreenerClient()
        tgBot = notify.NewTelegramBot()
        sessions = auth.NewManager()
        posTracker = position.NewTracker()

        port := os.Getenv("PORT")
        if port == "" {
                port = "5000"
        }

        mux := http.NewServeMux()

        mux.HandleFunc("/login", serveLogin)
        mux.HandleFunc("/api/login", handleLogin)

        mux.Handle("/", authMiddleware(http.HandlerFunc(serveUI)))
        mux.Handle("/logout", authMiddleware(http.HandlerFunc(handleLogout)))
        mux.Handle("/ws", authMiddleware(http.HandlerFunc(handleWebSocket)))
        mux.Handle("/api/stats", authMiddleware(http.HandlerFunc(handleStats)))
        mux.Handle("/api/status", authMiddleware(http.HandlerFunc(handleStatus)))
        mux.Handle("/api/check", authMiddleware(http.HandlerFunc(handleCheck)))
        mux.Handle("/api/test/telegram", authMiddleware(http.HandlerFunc(handleTestTelegram)))
        mux.Handle("/api/history", authMiddleware(http.HandlerFunc(handleHistory)))
        mux.Handle("/api/history/export", authMiddleware(http.HandlerFunc(handleHistoryExport)))
        mux.Handle("/api/wallet", authMiddleware(http.HandlerFunc(handleWallet)))

        if os.Getenv("BOT_PASSWORD") == "" {
                log.Printf("⚠️  WARNING: BOT_PASSWORD secret not set — login uses default password. Set BOT_PASSWORD in Secrets for security!")
        }

        log.Printf("🚀 MemeScalper AI Pro v%s starting on port %s", cfg.Bot.Version, port)
        log.Printf("📡 Network: %s | Chain ID: %d", cfg.Bot.Network, cfg.Bot.ChainID)
        log.Printf("🔐 Login: http://0.0.0.0:%s/login", port)
        log.Printf("🌐 Web UI: http://0.0.0.0:%s (protected)", port)
        if tgBot.IsEnabled() {
                log.Printf("📱 Telegram notifications: enabled")
        } else {
                log.Printf("📱 Telegram notifications: disabled (set BOT_TOKEN + CHAT_ID in .env)")
        }

        go broadcastLoop()
        go monitorPositions()

        // Auto-start bot in simulation mode if AUTO_START=true is set
        if os.Getenv("AUTO_START") == "true" {
                botState.mu.Lock()
                botState.Running = true
                botState.SimMode = true
                botState.mu.Unlock()
                go runBot()
                log.Printf("🤖 Auto-start enabled — bot running in SIMULATION mode")
        }

        if err := http.ListenAndServe(":"+port, mux); err != nil {
                log.Fatalf("Server failed: %v", err)
        }
}

// ── Auth middleware ──────────────────────────────────────────────────────────

func authMiddleware(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                if !sessions.IsAuthenticated(r) {
                        if isAPIorWS(r) {
                                w.Header().Set("Content-Type", "application/json")
                                w.WriteHeader(http.StatusUnauthorized)
                                json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
                                return
                        }
                        http.Redirect(w, r, "/login", http.StatusFound)
                        return
                }
                next.ServeHTTP(w, r)
        })
}

func isAPIorWS(r *http.Request) bool {
        p := r.URL.Path
        return len(p) >= 4 && (p[:4] == "/api" || p[:3] == "/ws")
}

// ── Auth handlers ────────────────────────────────────────────────────────────

func serveLogin(w http.ResponseWriter, r *http.Request) {
        if sessions.IsAuthenticated(r) {
                http.Redirect(w, r, "/", http.StatusFound)
                return
        }
        http.ServeFile(w, r, "web/login.html")
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        if r.Method != http.MethodPost {
                w.WriteHeader(http.StatusMethodNotAllowed)
                return
        }

        ip := auth.ClientIP(r)
        if sessions.IsLockedOut(ip) {
                w.WriteHeader(http.StatusTooManyRequests)
                json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": "too_many_attempts"})
                return
        }

        var creds struct {
                Username string `json:"username"`
                Password string `json:"password"`
        }
        if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
                w.WriteHeader(http.StatusBadRequest)
                json.NewEncoder(w).Encode(map[string]interface{}{"ok": false})
                return
        }

        if !sessions.Validate(creds.Username, creds.Password) {
                sessions.RecordFail(ip)
                w.WriteHeader(http.StatusUnauthorized)
                json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": "invalid_credentials"})
                log.Printf("⚠️  Failed login attempt from %s (user: %q)", ip, creds.Username)
                return
        }

        sessions.ResetAttempts(ip)
        token := sessions.Create()
        sessions.SetCookie(w, token)
        log.Printf("✅ Login successful from %s", ip)
        json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
        token := sessions.TokenFromRequest(r)
        if token != "" {
                sessions.Delete(token)
        }
        sessions.ClearCookie(w)
        http.Redirect(w, r, "/login", http.StatusFound)
}

// ── Wallet balance handler ────────────────────────────────────────────────────

func rpcCall(endpoint, payload string) (string, error) {
        req, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(payload))
        if err != nil {
                return "", err
        }
        req.Header.Set("Content-Type", "application/json")
        resp, err := walletHTTPClient.Do(req)
        if err != nil {
                return "", err
        }
        defer resp.Body.Close()
        var result struct {
                Result string `json:"result"`
        }
        if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
                return "", err
        }
        return result.Result, nil
}

func hexToFloat(hexStr string, decimals int) float64 {
        if len(hexStr) > 2 && hexStr[:2] == "0x" {
                hexStr = hexStr[2:]
        }
        var val float64
        for _, c := range hexStr {
                digit := 0
                switch {
                case c >= '0' && c <= '9':
                        digit = int(c - '0')
                case c >= 'a' && c <= 'f':
                        digit = int(c-'a') + 10
                case c >= 'A' && c <= 'F':
                        digit = int(c-'A') + 10
                }
                val = val*16 + float64(digit)
        }
        divisor := 1.0
        for i := 0; i < decimals; i++ {
                divisor *= 10
        }
        return val / divisor
}

func handleWallet(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")

        walletAddr := os.Getenv("WALLET_ADDRESS")
        if walletAddr == "" {
                json.NewEncoder(w).Encode(map[string]interface{}{
                        "ok": false, "error": "WALLET_ADDRESS not set",
                })
                return
        }

        endpoint, err := rpcClient.GetActiveEndpoint()
        if err != nil {
                json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": "no RPC available"})
                return
        }

        // Pad address to 32 bytes (64 hex chars) for eth_call ABI encoding.
        // fmt.Sprintf("%064s") pads with spaces — must zero-pad manually.
        addr := walletAddr
        if len(addr) >= 2 && addr[:2] == "0x" {
                addr = addr[2:]
        }
        for len(addr) < 64 {
                addr = "0" + addr
        }
        padded := addr

        const wethAddr = "0x4200000000000000000000000000000000000006"

        // Fetch ETH (native) and WETH balances concurrently
        type balResult struct {
                val float64
                err error
        }
        ethCh := make(chan balResult, 1)
        wethCh := make(chan balResult, 1)

        go func() {
                payload := fmt.Sprintf(`{"jsonrpc":"2.0","method":"eth_getBalance","params":["%s","latest"],"id":1}`, walletAddr)
                hex, err := rpcCall(endpoint, payload)
                if err != nil {
                        ethCh <- balResult{0, err}
                        return
                }
                ethCh <- balResult{hexToFloat(hex, 18), nil}
        }()

        go func() {
                data := "0x70a08231" + padded
                payload := fmt.Sprintf(`{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"%s","data":"%s"},"latest"],"id":2}`, wethAddr, data)
                hex, err := rpcCall(endpoint, payload)
                if err != nil {
                        wethCh <- balResult{0, err}
                        return
                }
                wethCh <- balResult{hexToFloat(hex, 18), nil}
        }()

        ethResult := <-ethCh
        wethResult := <-wethCh

        json.NewEncoder(w).Encode(map[string]interface{}{
                "ok":          true,
                "address":     walletAddr,
                "ethBalance":  ethResult.val,
                "wethBalance": wethResult.val,
                "wethAddress": wethAddr,
                "network":     "base",
        })
}

// ── Page / API handlers ──────────────────────────────────────────────────────

func serveUI(w http.ResponseWriter, r *http.Request) {
        http.ServeFile(w, r, "web/index.html")
}

func handleStats(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        botState.mu.RLock()
        defer botState.mu.RUnlock()
        json.NewEncoder(w).Encode(botState.Stats)
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        botState.mu.RLock()
        running := botState.Running
        simMode := botState.SimMode
        botState.mu.RUnlock()

        statuses := rpcClient.GetAllStatuses()
        rpcInfo := make([]map[string]interface{}, 0, len(statuses))
        for _, s := range statuses {
                name := s.URL
                if len(name) > 8 {
                        name = name[8:]
                }
                if len(name) > 30 {
                        name = name[:30]
                }
                status := "healthy"
                if !s.Healthy {
                        status = "down"
                }
                rpcInfo = append(rpcInfo, map[string]interface{}{
                        "name":    name,
                        "status":  status,
                        "latency": s.Latency.Milliseconds(),
                })
        }

        json.NewEncoder(w).Encode(map[string]interface{}{
                "running":      running,
                "simMode":      simMode,
                "rpcEndpoints": rpcInfo,
                "telegram":     tgBot.IsEnabled(),
        })
}

func handleCheck(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        report := checker.RunAll(cfg.RPCConfig.PrimaryEndpoints)
        json.NewEncoder(w).Encode(report)
}

func handleTestTelegram(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        result := tgBot.Test()
        json.NewEncoder(w).Encode(result)
}

func handleHistory(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        historyMu.Lock()
        h := make([]TradeRecord, len(tradeHistory))
        copy(h, tradeHistory)
        historyMu.Unlock()
        json.NewEncoder(w).Encode(h)
}

// ── WebSocket ────────────────────────────────────────────────────────────────

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
        conn, err := upgrader.Upgrade(w, r, nil)
        if err != nil {
                log.Printf("WebSocket upgrade error: %v", err)
                return
        }
        defer conn.Close()

        clientsMu.Lock()
        clients[conn] = true
        clientsMu.Unlock()

        defer func() {
                clientsMu.Lock()
                delete(clients, conn)
                clientsMu.Unlock()
        }()

        sendInitialState(conn)

        for {
                _, msg, err := conn.ReadMessage()
                if err != nil {
                        break
                }
                var cmd struct {
                        Action string                 `json:"action"`
                        Config map[string]interface{} `json:"config"`
                }
                if err := json.Unmarshal(msg, &cmd); err != nil {
                        continue
                }
                handleCommand(cmd.Action, cmd.Config)
        }
}

func handleCommand(action string, params map[string]interface{}) {
        switch action {
        case "start":
                simMode := false
                if v, ok := params["simMode"]; ok {
                        simMode, _ = v.(bool)
                }
                botState.mu.Lock()
                if !botState.Running {
                        botState.Running = true
                        botState.SimMode = simMode
                        botState.mu.Unlock()
                        go runBot()
                        modeLabel := "LIVE"
                        if simMode {
                                modeLabel = "SIMULATION"
                        }
                        broadcast("log", map[string]interface{}{
                                "message": fmt.Sprintf("✅ Bot started in %s mode", modeLabel),
                                "type":    "success",
                        })
                        tgBot.NotifyBotStart(simMode)
                } else {
                        botState.mu.Unlock()
                }

        case "stop":
                botState.mu.Lock()
                botState.Running = false
                stats := botState.Stats
                botState.mu.Unlock()
                broadcast("log", map[string]interface{}{"message": "🛑 Bot stopped", "type": "warning"})
                tgBot.NotifyBotStop(map[string]interface{}{
                        "totalTrades":    stats.TotalTrades,
                        "totalProfitUSD": fmt.Sprintf("%.4f", stats.TotalProfitUSD),
                })

        case "withdraw":
                broadcast("log", map[string]interface{}{"message": "💰 Withdraw initiated (manual)", "type": "info"})

        case "reset_stats":
                botState.mu.Lock()
                botState.Stats = BotStats{}
                botState.ConsecutiveLoss = 0
                botState.CircuitBroken = false
                botState.mu.Unlock()
                broadcast("log", map[string]interface{}{"message": "🔄 Statistics reset", "type": "warning"})

        case "run_check":
                go func() {
                        broadcast("log", map[string]interface{}{"message": "🔍 Running system check...", "type": "info"})
                        report := checker.RunAll(cfg.RPCConfig.PrimaryEndpoints)
                        broadcast("check_result", report)
                        if report.AllOK {
                                broadcast("log", map[string]interface{}{"message": "✅ All checks passed!", "type": "success"})
                        } else {
                                broadcast("log", map[string]interface{}{"message": "⚠️ Some checks failed — see Check panel", "type": "warning"})
                        }
                }()

        case "test_telegram":
                go func() {
                        broadcast("log", map[string]interface{}{"message": "📱 Testing Telegram connection...", "type": "info"})
                        result := tgBot.Test()
                        if result.OK {
                                broadcast("log", map[string]interface{}{"message": "✅ Telegram OK: " + result.Message, "type": "success"})
                        } else {
                                broadcast("log", map[string]interface{}{"message": "❌ Telegram failed: " + result.Message, "type": "error"})
                        }
                        broadcast("telegram_test", result)
                }()
        }
}

// ── Bot loop ─────────────────────────────────────────────────────────────────

func runBot() {
        log.Println("Bot loop started")
        botState.mu.RLock()
        simMode := botState.SimMode
        botState.mu.RUnlock()

        if simMode {
                broadcast("log", map[string]interface{}{"message": "🧪 SIMULATION MODE — no real trades", "type": "warning"})
        }
        broadcast("log", map[string]interface{}{"message": "🔍 Scanning tokens on Base Network...", "type": "info"})

        for {
                botState.mu.RLock()
                running := botState.Running
                circuitBroken := botState.CircuitBroken
                circuitUntil := botState.CircuitUntil
                simMode = botState.SimMode
                dailyPnl := botState.Stats.DailyPnL
                botState.mu.RUnlock()

                if !running {
                        break
                }

                // Daily loss limit check
                if cfg.Risk.MaxDailyLossUSD > 0 && dailyPnl <= -cfg.Risk.MaxDailyLossUSD {
                        broadcast("log", map[string]interface{}{
                                "message": fmt.Sprintf("🛑 Daily loss limit hit ($%.2f). Stopping bot.", cfg.Risk.MaxDailyLossUSD),
                                "type":    "error",
                        })
                        botState.mu.Lock()
                        botState.Running = false
                        botState.mu.Unlock()
                        break
                }

                if circuitBroken {
                        if time.Now().Before(circuitUntil) {
                                remaining := time.Until(circuitUntil).Round(time.Second)
                                broadcast("log", map[string]interface{}{
                                        "message": fmt.Sprintf("⚡ Circuit breaker active. Resuming in %s", remaining),
                                        "type":    "warning",
                                })
                                time.Sleep(30 * time.Second)
                                continue
                        }
                        botState.mu.Lock()
                        botState.CircuitBroken = false
                        botState.mu.Unlock()
                        broadcast("log", map[string]interface{}{"message": "✅ Circuit breaker reset. Resuming...", "type": "success"})
                }

                ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
                tokens, err := geckoData.GetTopPools(ctx, "base")
                cancel()

                if err != nil {
                        broadcast("log", map[string]interface{}{"message": "⚠️ GeckoTerminal error, trying DexScreener...", "type": "warning"})
                        ctx2, cancel2 := context.WithTimeout(context.Background(), 10*time.Second)
                        tokens, err = dexData.GetLatestTokens(ctx2, "base")
                        cancel2()
                        if err != nil {
                                broadcast("log", map[string]interface{}{"message": "❌ Data fetch failed: " + err.Error(), "type": "error"})
                                time.Sleep(5 * time.Second)
                                continue
                        }
                }

                if simMode && len(tokens) == 0 {
                        tokens = generateSimTokens()
                }

                for _, token := range tokens {
                        botState.mu.RLock()
                        running = botState.Running
                        botState.mu.RUnlock()
                        if !running {
                                break
                        }

                        // Skip if this token was already traded this session
                        if posTracker.AlreadyTraded(token.Address) {
                                continue
                        }

                        // Skip if position already open for this token
                        if posTracker.HasOpen(token.Address) {
                                continue
                        }

                        // Max concurrent positions
                        if posTracker.OpenCount() >= cfg.Trading.MaxConcurrentPos {
                                broadcast("log", map[string]interface{}{
                                        "message": fmt.Sprintf("⏸ Max positions (%d) open, waiting for exits...", cfg.Trading.MaxConcurrentPos),
                                        "type":    "info",
                                })
                                break
                        }

                        if !passesFilters(token) {
                                continue
                        }

                        marketMap := geckoData.ToMarketMap(token)
                        decision := aiOrch.GetTradingDecision(token.Address, marketMap)
                        broadcastAIUpdate(decision, token.Address)

                        if decision.Action != "BUY" || decision.Confidence < cfg.AIConfig.MinConfidenceThreshold {
                                continue
                        }

                        // Dynamic price impact — use worst-case Kelly size (max multiplier)
                        // so MEV check reflects the largest position we could actually open.
                        maxKellyUSD := cfg.Trading.PositionSizeUSD
                        if cfg.Kelly.Enabled && cfg.Kelly.MaxMultiplier > 1.0 {
                                maxKellyUSD = cfg.Trading.PositionSizeUSD * cfg.Kelly.MaxMultiplier
                        }
                        priceImpactPct := (maxKellyUSD / token.LiquidityUSD) * 100
                        risk := mevShield.Assess(priceImpactPct, token.LiquidityUSD, float64(token.TxCount5m)/5.0)
                        if risk.ShouldSkip {
                                broadcast("log", map[string]interface{}{
                                        "message": fmt.Sprintf("🛡️ MEV risk [%s]: %s — skipping %s", risk.RiskLevel, risk.Reason, token.Symbol),
                                        "type":    "warning",
                                })
                                continue
                        }

                        if !simMode {
                                mevShield.RandomDelay()
                        }
                        executeTrade(token, decision, simMode)
                }

                pollInterval := time.Duration(cfg.Monitoring.PollIntervalSecs) * time.Second
                if pollInterval < time.Second {
                        pollInterval = 2 * time.Second
                }
                if simMode {
                        pollInterval = 3 * time.Second
                }
                time.Sleep(pollInterval)
        }

        log.Println("Bot loop stopped")
}

// ── Token generation & filtering ─────────────────────────────────────────────

func generateSimTokens() []data.TokenData {
        syms := []string{"DEGEN", "BRETT", "TOSHI", "MOCHI", "BENJI", "FROG", "PEPE", "MEME"}
        out := make([]data.TokenData, 3)
        for i := range out {
                sym := syms[rand.Intn(len(syms))]
                buys := 15 + rand.Intn(40)
                sells := 5 + rand.Intn(15)
                out[i] = data.TokenData{
                        Address:       fmt.Sprintf("0xSIM%04d", rand.Intn(9999)),
                        Symbol:        sym,
                        PriceUSD:      0.0001 + rand.Float64()*0.009,
                        Volume24h:     15000 + rand.Float64()*50000,
                        LiquidityUSD:  8000 + rand.Float64()*30000,
                        PriceChange5m: 1.5 + rand.Float64()*4,
                        TxCount5m:     buys + sells,
                        Buys5m:        buys,
                        Sells5m:       sells,
                        AgeSeconds:    300 + rand.Intn(3000),
                }
        }
        return out
}

func passesFilters(token data.TokenData) bool {
        f := cfg.Monitoring.TokenFilters

        if token.LiquidityUSD < f.MinLiquidityUSD {
                return false
        }
        if token.Volume24h < f.MinVolume24hUSD {
                return false
        }
        if f.MaxPriceUSD > 0 && token.PriceUSD > f.MaxPriceUSD {
                return false
        }
        if token.TxCount5m < f.MinTxCount5m {
                return false
        }

        // Age filter
        if token.AgeSeconds > 0 {
                if f.MinAgeSecs > 0 && token.AgeSeconds < f.MinAgeSecs {
                        return false
                }
                if f.MaxAgeSecs > 0 && token.AgeSeconds > f.MaxAgeSecs {
                        return false
                }
        }

        // Buy/sell ratio filter — key momentum signal
        if f.MinBuySellRatio > 0 {
                if token.Buys5m == 0 && token.Sells5m == 0 {
                        return false
                }
                var ratio float64
                if token.Sells5m == 0 {
                        ratio = 10.0
                } else {
                        ratio = float64(token.Buys5m) / float64(token.Sells5m)
                }
                if ratio < f.MinBuySellRatio {
                        return false
                }
                if f.MaxBuySellRatio > 0 && ratio > f.MaxBuySellRatio {
                        // Too skewed = possible pump manipulation
                        return false
                }
        }

        // Dev filter
        if cfg.DevFilter.Enabled {
                // Strict minimum age — avoid very fresh launches by serial devs
                if cfg.DevFilter.MinTokenAgeSecs > 0 && token.AgeSeconds > 0 && token.AgeSeconds < cfg.DevFilter.MinTokenAgeSecs {
                        broadcast("log", map[string]interface{}{
                                "message": fmt.Sprintf("🚫 Dev filter: %s too new (%ds) — possible serial launch, skipping", token.Symbol, token.AgeSeconds),
                                "type":    "warning",
                        })
                        return false
                }
                // Blacklisted token addresses
                for _, blocked := range cfg.DevFilter.BlacklistedAddresses {
                        if strings.EqualFold(token.Address, blocked) {
                                broadcast("log", map[string]interface{}{
                                        "message": fmt.Sprintf("🚫 Dev filter: %s is blacklisted, skipping", token.Symbol),
                                        "type":    "warning",
                                })
                                return false
                        }
                }
        }

        return true
}

// ── Kelly Criterion position sizing ──────────────────────────────────────────

func computeKellySize() kelly.Result {
        base := cfg.Trading.PositionSizeUSD

        historyMu.Lock()
        h := make([]TradeRecord, len(tradeHistory))
        copy(h, tradeHistory)
        historyMu.Unlock()

        botState.mu.RLock()
        drawdownPct := botState.Stats.MaxDrawdownPct
        botState.mu.RUnlock()

        // Aggregate win/loss stats from closed trades.
        wins := 0
        var totalWinPct, totalLossPct float64
        var winCount, lossCount int
        for _, r := range h {
                if r.PnLPct > 0 {
                        wins++
                        totalWinPct += r.PnLPct
                        winCount++
                } else if r.PnLPct < 0 {
                        totalLossPct += math.Abs(r.PnLPct)
                        lossCount++
                }
        }

        winRate := 0.55 // neutral default before enough trades
        if len(h) > 0 {
                winRate = float64(wins) / float64(len(h))
        }

        // Fall back to strategy-configured TP/SL when history is thin.
        strat := cfg.ScalpingStrategies()
        avgWinPct := strat.MomentumTP
        if winCount > 0 {
                avgWinPct = totalWinPct / float64(winCount)
        }
        avgLossPct := strat.MomentumSL
        if lossCount > 0 {
                avgLossPct = totalLossPct / float64(lossCount)
        }

        kellyCfg := kelly.Config{
                Enabled:           cfg.Kelly.Enabled,
                Fraction:          cfg.Kelly.Fraction,
                MinMultiplier:     cfg.Kelly.MinMultiplier,
                MaxMultiplier:     cfg.Kelly.MaxMultiplier,
                MinTradesRequired: cfg.Kelly.MinTradesRequired,
                DrawdownDampen:    cfg.Kelly.DrawdownDampen,
                DrawdownMaxPct:    cfg.Kelly.DrawdownMaxPct,
        }
        return kelly.GetPositionSize(base, winRate, avgWinPct, avgLossPct, drawdownPct, len(h), kellyCfg)
}

// ── Trade execution ───────────────────────────────────────────────────────────

func fetchWETHPrice() float64 {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        price, err := geckoData.GetWETHPrice(ctx)
        if err != nil || price <= 0 {
                // Fallback: try to derive from a known WETH price (conservative)
                return 3000.0
        }
        return price
}

func executeTrade(token data.TokenData, decision *ai.TradingDecision, simMode bool) {
        strat := cfg.ScalpingStrategies()

        // Kelly Criterion dynamic position sizing
        kr := computeKellySize()

        // AI confidence weighting: high conviction boosts size, low conviction cuts it.
        // Applied after Kelly so it respects the min/max multiplier bounds.
        base := cfg.Trading.PositionSizeUSD
        minMult := cfg.Kelly.MinMultiplier
        if minMult <= 0 {
                minMult = 0.25
        }
        maxMult := cfg.Kelly.MaxMultiplier
        if maxMult <= 0 {
                maxMult = 3.0
        }
        switch {
        case decision.Confidence >= 85:
                boosted := math.Min(maxMult, kr.Multiplier*1.15)
                kr.Multiplier = math.Round(boosted*100) / 100
                kr.Mode = kr.Mode + "_hi_conf"
        case decision.Confidence < 75:
                cut := math.Max(minMult, kr.Multiplier*0.85)
                kr.Multiplier = math.Round(cut*100) / 100
                kr.Mode = kr.Mode + "_lo_conf"
        }
        kr.SizeUSD = math.Round(base*kr.Multiplier*1e6) / 1e6
        posSize := kr.SizeUSD

        // Persist Kelly state so the dashboard stat card stays current.
        botState.mu.Lock()
        botState.Stats.KellyMultiplier = kr.Multiplier
        botState.Stats.KellyMode = kr.Mode
        botState.mu.Unlock()

        tpPrice := token.PriceUSD * (1 + strat.MomentumTP/100.0)
        slPrice := token.PriceUSD * (1 - strat.MomentumSL/100.0)

        maxHold := cfg.Scalping.MaxHoldingMinutes
        if maxHold <= 0 {
                maxHold = 8
        }

        // Compute WETH amount for this position (USD ÷ WETH price)
        wethPrice := fetchWETHPrice()
        wethAmount := 0.0
        if wethPrice > 0 {
                wethAmount = posSize / wethPrice
        }

        simTag := ""
        if simMode {
                simTag = " [SIM]"
        }

        broadcast("log", map[string]interface{}{
                "message": fmt.Sprintf("📈%s OPEN %s | WETH→TOKEN | Entry: $%.6f | Size: %.6f WETH ($%.2f) | Kelly: %.2f× [%s] | TP: +%.1f%% | SL: -%.1f%% | Conf: %.0f%%",
                        simTag, token.Symbol, token.PriceUSD,
                        wethAmount, posSize,
                        kr.Multiplier, kr.Mode,
                        strat.MomentumTP, strat.MomentumSL,
                        decision.Confidence),
                "type": "success",
        })

        pos := &position.Position{
                TokenAddress:   token.Address,
                Symbol:         token.Symbol,
                EntryPrice:     token.PriceUSD,
                CurrentPrice:   token.PriceUSD,
                SizeUSD:        posSize,
                WETHAmount:     wethAmount,
                WETHPriceEntry: wethPrice,
                EntryTime:      time.Now(),
                TPPrice:        tpPrice,
                SLPrice:        slPrice,
                MaxHoldMins:    maxHold,
                SimMode:        simMode,
                AIConfidence:   decision.Confidence,
        }

        posTracker.Open(pos)

        botState.mu.Lock()
        botState.Stats.ActivePositions = posTracker.OpenCount()
        botState.mu.Unlock()

        tgBot.NotifyTrade(token.Symbol, "BUY", 0, decision.Confidence, simMode)
}

// ── Position monitor (fast loop) ─────────────────────────────────────────────

func monitorPositions() {
        ticker := time.NewTicker(5 * time.Second)
        for range ticker.C {
                positions := posTracker.GetAllOpen()
                if len(positions) == 0 {
                        continue
                }

                botState.mu.RLock()
                running := botState.Running
                botState.mu.RUnlock()

                for _, pos := range positions {
                        held := time.Since(pos.EntryTime)
                        maxHold := time.Duration(pos.MaxHoldMins) * time.Minute

                        var currentPrice float64

                        if pos.SimMode {
                                // Realistic random walk: slight negative drift for meme coins
                                tick := (rand.Float64() - 0.52) * 0.015
                                prev := pos.CurrentPrice
                                if prev <= 0 {
                                        prev = pos.EntryPrice
                                }
                                currentPrice = prev * (1 + tick)
                                posTracker.UpdateCurrentPrice(pos.TokenAddress, currentPrice)
                        } else {
                                // Fetch live price from GeckoTerminal
                                ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
                                price, err := geckoData.GetTokenPrice(ctx, "base", pos.TokenAddress)
                                cancel()
                                if err != nil {
                                        // Can't get price this tick, keep watching
                                        continue
                                }
                                posTracker.UpdateCurrentPrice(pos.TokenAddress, price)
                                currentPrice = price
                        }

                        if currentPrice <= 0 {
                                continue
                        }

                        // Trailing stop: raise SL as price moves up to lock in profit
                        if cfg.Scalping.TrailingStop.Enabled {
                                activationPrice := pos.EntryPrice * (1 + cfg.Scalping.TrailingStop.ActivationPercent/100.0)
                                if currentPrice >= activationPrice {
                                        newTrailSL := currentPrice * (1 - cfg.Scalping.TrailingStop.TrailingDistancePct/100.0)
                                        effectiveSL, firstActivation := posTracker.UpdateTrailingSL(pos.TokenAddress, newTrailSL)
                                        if firstActivation {
                                                broadcast("log", map[string]interface{}{
                                                        "message": fmt.Sprintf("🎯 %s Trailing SL aktif! SL naik ke $%.6f (trail: -%.1f%%)",
                                                                pos.Symbol, effectiveSL, cfg.Scalping.TrailingStop.TrailingDistancePct),
                                                        "type": "success",
                                                })
                                        }
                                        pos.SLPrice = effectiveSL
                                }
                        }

                        pnlPct := ((currentPrice - pos.EntryPrice) / pos.EntryPrice) * 100

                        // Determine exit condition
                        reason := ""
                        switch {
                        case currentPrice >= pos.TPPrice:
                                reason = "TP"
                        case currentPrice <= pos.SLPrice:
                                reason = "SL"
                        case held >= maxHold:
                                reason = "TIMEOUT"
                        case !running:
                                reason = "BOT_STOPPED"
                        }

                        if reason != "" {
                                if _, ok := posTracker.Close(pos.TokenAddress); ok {
                                        pnl := pos.SizeUSD * (pnlPct / 100.0)
                                        closePositionResult(pos, pnl, reason)
                                }
                        } else {
                                // Live position log (only every ~30s to reduce noise)
                                if int(held.Seconds())%30 < 5 {
                                        broadcast("log", map[string]interface{}{
                                                "message": fmt.Sprintf("👁 %s | Held: %s | $%.6f | PnL: %+.2f%%",
                                                        pos.Symbol, held.Round(time.Second), currentPrice, pnlPct),
                                                "type": "info",
                                        })
                                }
                        }
                }

                // Sync active positions count
                botState.mu.Lock()
                botState.Stats.ActivePositions = posTracker.OpenCount()
                botState.mu.Unlock()

                // Broadcast structured positions to Positions tab
                allOpen := posTracker.GetAllOpen()
                posData := make([]map[string]interface{}, 0, len(allOpen))
                for _, p := range allOpen {
                        pp := 0.0
                        if p.EntryPrice > 0 && p.CurrentPrice > 0 {
                                pp = ((p.CurrentPrice - p.EntryPrice) / p.EntryPrice) * 100
                        }
                        posData = append(posData, map[string]interface{}{
                                "symbol":            p.Symbol,
                                "address":           p.TokenAddress,
                                "entryPrice":        p.EntryPrice,
                                "currentPrice":      p.CurrentPrice,
                                "pnlPct":            pp,
                                "pnl":               p.SizeUSD * (pp / 100.0),
                                "tpPrice":           p.TPPrice,
                                "slPrice":           p.SLPrice,
                                "heldSecs":          int(time.Since(p.EntryTime).Seconds()),
                                "trailingActivated": p.TrailingActivated,
                                "simMode":           p.SimMode,
                                "wethAmount":        p.WETHAmount,
                                "wethPriceEntry":    p.WETHPriceEntry,
                        })
                }
                broadcast("positions_update", posData)

                // Clean up stale traded entries older than 24h
                posTracker.CleanupTraded(24 * time.Hour)
        }
}

func closePositionResult(pos *position.Position, pnl float64, reason string) {
        simTag := ""
        if pos.SimMode {
                simTag = " [SIM]"
        }

        logType := "success"
        emoji := "✅"
        if pnl < 0 {
                logType = "error"
                emoji = "❌"
        } else if reason == "TIMEOUT" || reason == "BOT_STOPPED" {
                logType = "warning"
                emoji = "⏱"
        }

        // Compute WETH returned (entry WETH + WETH PnL)
        wethPnl := 0.0
        if pos.WETHPriceEntry > 0 {
                wethPnl = pnl / pos.WETHPriceEntry
        }
        wethReturned := pos.WETHAmount + wethPnl

        broadcast("log", map[string]interface{}{
                "message": fmt.Sprintf("%s%s [%s] %s | PnL: %+.4f USD (%+.6f WETH) | Returned: %.6f WETH",
                        emoji, simTag, reason, pos.Symbol, pnl, wethPnl, wethReturned),
                "type": logType,
        })

        win := pnl > 0
        botState.mu.Lock()
        botState.Stats.TotalTrades++
        if win {
                botState.Stats.WinningTrades++
                botState.ConsecutiveLoss = 0
        } else {
                botState.Stats.LosingTrades++
                botState.ConsecutiveLoss++
        }
        botState.Stats.TotalProfitUSD += pnl
        botState.Stats.DailyPnL += pnl
        total := botState.Stats.TotalTrades
        wins := botState.Stats.WinningTrades
        if total > 0 {
                botState.Stats.WinRate = float64(wins) / float64(total) * 100.0
        }
        consecutiveLoss := botState.ConsecutiveLoss
        botState.Stats.ActivePositions = posTracker.OpenCount()
        botState.mu.Unlock()

        // Record trade to history
        pnlPct := 0.0
        if pos.SizeUSD > 0 {
                pnlPct = (pnl / pos.SizeUSD) * 100.0
        }
        exitPrice := pos.EntryPrice * (1 + pnlPct/100.0)
        record := TradeRecord{
                Symbol:         pos.Symbol,
                EntryPrice:     pos.EntryPrice,
                ExitPrice:      exitPrice,
                SizeUSD:        pos.SizeUSD,
                WETHAmount:     pos.WETHAmount,
                WETHPriceEntry: pos.WETHPriceEntry,
                PnL:            pnl,
                PnLPct:         pnlPct,
                Reason:         reason,
                HeldSecs:       int(time.Since(pos.EntryTime).Seconds()),
                ClosedAt:       time.Now().Format("15:04:05"),
                SimMode:        pos.SimMode,
        }
        historyMu.Lock()
        tradeHistory = append([]TradeRecord{record}, tradeHistory...)
        if len(tradeHistory) > 100 {
                tradeHistory = tradeHistory[:100]
        }
        historyMu.Unlock()
        broadcast("history_add", record)

        // ── Advanced metrics ─────────────────────────────────────────────────
        // Step 1: append return data and snapshot under returnsMu only.
        // returnsMu must NEVER be nested inside botState.mu to prevent lock-order
        // inversions and potential deadlocks.
        returnsMu.Lock()
        pnlReturns = append(pnlReturns, record.PnLPct)
        totalHeldSecs += record.HeldSecs
        pnlSnap := make([]float64, len(pnlReturns))
        copy(pnlSnap, pnlReturns)
        heldSnap := totalHeldSecs
        returnsMu.Unlock()

        // Step 2: compute Sharpe with no locks held (pure math, no shared writes).
        sharpe := calcSharpe(pnlSnap)

        // Step 3: update all botState metrics under a single botState.mu lock.
        botState.mu.Lock()
        if botState.Stats.TotalTrades == 1 || record.PnLPct > botState.Stats.BestTradePct {
                botState.Stats.BestTradePct = record.PnLPct
        }
        if botState.Stats.TotalTrades == 1 || record.PnLPct < botState.Stats.WorstTradePct {
                botState.Stats.WorstTradePct = record.PnLPct
        }
        if botState.Stats.TotalTrades > 0 {
                botState.Stats.AvgHoldSecs = heldSnap / botState.Stats.TotalTrades
        }
        equity := botState.Stats.TotalProfitUSD
        if equity > equityPeak {
                equityPeak = equity
        }
        if equityPeak > 0 {
                dd := (equityPeak - equity) / equityPeak * 100.0
                if dd > botState.Stats.MaxDrawdownPct {
                        botState.Stats.MaxDrawdownPct = dd
                }
        }
        botState.Stats.SharpeRatio = sharpe
        botState.mu.Unlock()

        tgBot.NotifyTrade(pos.Symbol, "CLOSE("+reason+")", pnl, 0, pos.SimMode)

        if cfg.Risk.CircuitBreaker.Enabled && !win && consecutiveLoss >= cfg.Risk.CircuitBreaker.ConsecutiveLossesThreshold {
                botState.mu.Lock()
                botState.CircuitBroken = true
                botState.CircuitUntil = time.Now().Add(time.Duration(cfg.Risk.CircuitBreaker.PauseMinutes) * time.Minute)
                botState.mu.Unlock()
                broadcast("log", map[string]interface{}{
                        "message": fmt.Sprintf("⚡ Circuit breaker triggered! Pausing %d minutes", cfg.Risk.CircuitBreaker.PauseMinutes),
                        "type":    "error",
                })
                tgBot.NotifyCircuitBreaker(consecutiveLoss, cfg.Risk.CircuitBreaker.PauseMinutes)
        }
}

// ── Sharpe ratio helper ───────────────────────────────────────────────────────

func calcSharpe(returns []float64) float64 {
        n := len(returns)
        if n < 2 {
                return 0
        }
        var sum float64
        for _, r := range returns {
                sum += r
        }
        mean := sum / float64(n)
        var variance float64
        for _, r := range returns {
                d := r - mean
                variance += d * d
        }
        std := math.Sqrt(variance / float64(n-1))
        if std == 0 {
                return 0
        }
        return (mean / std) * math.Sqrt(float64(n))
}

// ── CSV export ────────────────────────────────────────────────────────────────

func handleHistoryExport(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "text/csv; charset=utf-8")
        w.Header().Set("Content-Disposition", "attachment; filename=trades.csv")
        historyMu.Lock()
        h := make([]TradeRecord, len(tradeHistory))
        copy(h, tradeHistory)
        historyMu.Unlock()
        fmt.Fprint(w, "Time,Symbol,EntryPrice,ExitPrice,SizeUSD,WETH_Amount,WETH_Price_Entry,PnL_USD,PnL_Pct,Reason,HeldSecs,Mode\n")
        for _, rec := range h {
                mode := "LIVE"
                if rec.SimMode {
                        mode = "SIM"
                }
                fmt.Fprintf(w, "%s,%s,%.8f,%.8f,%.4f,%.8f,%.2f,%.4f,%.2f,%s,%d,%s\n",
                        rec.ClosedAt, rec.Symbol,
                        rec.EntryPrice, rec.ExitPrice,
                        rec.SizeUSD, rec.WETHAmount, rec.WETHPriceEntry,
                        rec.PnL, rec.PnLPct,
                        rec.Reason, rec.HeldSecs, mode,
                )
        }
}

// ── Broadcast helpers ────────────────────────────────────────────────────────

func broadcastLoop() {
        ticker := time.NewTicker(2 * time.Second)
        for range ticker.C {
                // Keep the Kelly stat card fresh between trades by computing the
                // current Kelly size on every broadcast cycle (not only when a trade fires).
                kr := computeKellySize()
                botState.mu.Lock()
                botState.Stats.KellyMultiplier = kr.Multiplier
                if botState.Stats.KellyMode == "" {
                        // Only set mode if executeTrade hasn't already written a conf-tagged value.
                        botState.Stats.KellyMode = kr.Mode
                }
                botState.mu.Unlock()

                botState.mu.RLock()
                stats := botState.Stats
                running := botState.Running
                simMode := botState.SimMode
                botState.mu.RUnlock()

                statuses := rpcClient.GetAllStatuses()
                rpcInfo := make([]map[string]interface{}, 0, len(statuses))
                activeRPC := "none"
                for _, s := range statuses {
                        name := s.URL
                        if len(name) > 8 {
                                name = name[8:]
                        }
                        if len(name) > 28 {
                                name = name[:28]
                        }
                        status := "healthy"
                        if !s.Healthy {
                                status = "down"
                        } else if activeRPC == "none" {
                                activeRPC = name
                        }
                        rpcInfo = append(rpcInfo, map[string]interface{}{
                                "name":   name,
                                "status": status,
                        })
                }

                broadcast("update", map[string]interface{}{
                        "stats":        stats,
                        "running":      running,
                        "simMode":      simMode,
                        "rpcEndpoints": rpcInfo,
                        "activeRpc":    activeRPC,
                })
        }
}

func broadcastAIUpdate(decision *ai.TradingDecision, tokenAddr string) {
        lastDecisions := aiOrch.GetLastDecisions()

        aiData := map[string]interface{}{
                "finalDecision": decision.Action,
                "consensus":     fmt.Sprintf("%.0f", decision.Confidence),
        }

        for provider, d := range lastDecisions {
                aiData[provider] = map[string]interface{}{
                        "signal":     d.Action,
                        "confidence": fmt.Sprintf("%.0f%%", d.Confidence),
                }
        }

        broadcast("ai_update", map[string]interface{}{
                "ai":    aiData,
                "token": tokenAddr,
        })
}

func broadcast(msgType string, data interface{}) {
        msg := WSMessage{Type: msgType, Data: data}
        b, err := json.Marshal(msg)
        if err != nil {
                return
        }
        clientsMu.Lock()
        defer clientsMu.Unlock()
        for conn := range clients {
                if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
                        conn.Close()
                        delete(clients, conn)
                }
        }
}

func sendInitialState(conn *websocket.Conn) {
        botState.mu.RLock()
        stats := botState.Stats
        running := botState.Running
        simMode := botState.SimMode
        botState.mu.RUnlock()

        historyMu.Lock()
        h := make([]TradeRecord, len(tradeHistory))
        copy(h, tradeHistory)
        historyMu.Unlock()

        allOpen := posTracker.GetAllOpen()
        posData := make([]map[string]interface{}, 0, len(allOpen))
        for _, p := range allOpen {
                pp := 0.0
                if p.EntryPrice > 0 && p.CurrentPrice > 0 {
                        pp = ((p.CurrentPrice - p.EntryPrice) / p.EntryPrice) * 100
                }
                posData = append(posData, map[string]interface{}{
                        "symbol":            p.Symbol,
                        "address":           p.TokenAddress,
                        "entryPrice":        p.EntryPrice,
                        "currentPrice":      p.CurrentPrice,
                        "pnlPct":            pp,
                        "pnl":               p.SizeUSD * (pp / 100.0),
                        "tpPrice":           p.TPPrice,
                        "slPrice":           p.SLPrice,
                        "heldSecs":          int(time.Since(p.EntryTime).Seconds()),
                        "trailingActivated": p.TrailingActivated,
                        "simMode":           p.SimMode,
                        "wethAmount":        p.WETHAmount,
                        "wethPriceEntry":    p.WETHPriceEntry,
                })
        }

        msg := WSMessage{
                Type: "init",
                Data: map[string]interface{}{
                        "stats":     stats,
                        "running":   running,
                        "simMode":   simMode,
                        "telegram":  tgBot.IsEnabled(),
                        "history":   h,
                        "positions": posData,
                        "log": map[string]interface{}{
                                "message": fmt.Sprintf("🚀 Connected to %s v%s", cfg.Bot.Name, cfg.Bot.Version),
                                "type":    "info",
                        },
                },
        }
        b, _ := json.Marshal(msg)
        conn.WriteMessage(websocket.TextMessage, b)
}
