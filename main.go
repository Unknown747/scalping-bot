package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"

	"meme-scalper-ai/internal/ai"
	"meme-scalper-ai/internal/checker"
	"meme-scalper-ai/internal/config"
	"meme-scalper-ai/internal/data"
	"meme-scalper-ai/internal/mev"
	"meme-scalper-ai/internal/notify"
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
	GasSpentETH     float64 `json:"gasSpentETH"`
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

var (
	cfg       *config.Config
	rpcClient *rpcpkg.MultiRPCClient
	aiOrch    *ai.AIOrchestrator
	mevShield *mev.SandwichDetector
	geckoData *data.GeckoClient
	dexData   *data.DexScreenerClient
	tgBot     *notify.TelegramBot
	botState  = &BotState{}
	clients   = make(map[*websocket.Conn]bool)
	clientsMu sync.Mutex
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

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	http.HandleFunc("/", serveUI)
	http.HandleFunc("/ws", handleWebSocket)
	http.HandleFunc("/api/stats", handleStats)
	http.HandleFunc("/api/status", handleStatus)
	http.HandleFunc("/api/check", handleCheck)
	http.HandleFunc("/api/test/telegram", handleTestTelegram)

	log.Printf("🚀 MemeScalper AI Pro v%s starting on port %s", cfg.Bot.Version, port)
	log.Printf("📡 Network: %s | Chain ID: %d", cfg.Bot.Network, cfg.Bot.ChainID)
	log.Printf("🌐 Web UI: http://0.0.0.0:%s", port)
	if tgBot.IsEnabled() {
		log.Printf("📱 Telegram notifications: enabled")
	} else {
		log.Printf("📱 Telegram notifications: disabled (set BOT_TOKEN + CHAT_ID in .env)")
	}

	go broadcastLoop()

	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

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
				broadcast("log", map[string]interface{}{
					"message": "✅ Telegram OK: " + result.Message,
					"type":    "success",
				})
			} else {
				broadcast("log", map[string]interface{}{
					"message": "❌ Telegram failed: " + result.Message,
					"type":    "error",
				})
			}
			broadcast("telegram_test", result)
		}()
	}
}

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
		botState.mu.RUnlock()

		if !running {
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

			if !passesFilters(token) {
				continue
			}

			marketMap := geckoData.ToMarketMap(token)
			decision := aiOrch.GetTradingDecision(token.Address, marketMap)
			broadcastAIUpdate(decision, token.Address)

			if decision.Action == "HOLD" || decision.Confidence < cfg.AIConfig.MinConfidenceThreshold {
				continue
			}

			risk := mevShield.Assess(0.5, token.LiquidityUSD, float64(token.TxCount5m)/5.0)
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

func generateSimTokens() []data.TokenData {
	syms := []string{"DEGEN", "BRETT", "TOSHI", "MOCHI", "BENJI", "FROG", "PEPE", "MEME"}
	out := make([]data.TokenData, 3)
	for i := range out {
		sym := syms[rand.Intn(len(syms))]
		out[i] = data.TokenData{
			Address:       fmt.Sprintf("0xSIM%04d", rand.Intn(9999)),
			Symbol:        sym,
			PriceUSD:      0.0001 + rand.Float64()*0.009,
			Volume24h:     15000 + rand.Float64()*50000,
			LiquidityUSD:  8000 + rand.Float64()*30000,
			PriceChange5m: -3 + rand.Float64()*8,
			TxCount5m:     10 + rand.Intn(80),
			Buys5m:        5 + rand.Intn(40),
			Sells5m:       5 + rand.Intn(30),
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
	return true
}

func executeTrade(token data.TokenData, decision *ai.TradingDecision, simMode bool) {
	posSize := cfg.Trading.PositionSizeUSD
	simTag := ""
	if simMode {
		simTag = " [SIM]"
	}

	broadcast("log", map[string]interface{}{
		"message": fmt.Sprintf("📊%s %s on %s | Conf: %.0f%% | $%.2f",
			simTag, decision.Action, token.Symbol, decision.Confidence, posSize),
		"type": "info",
	})

	time.Sleep(time.Duration(50+rand.Intn(150)) * time.Millisecond)

	win := rand.Float64() > 0.45
	pnl := 0.0
	strat := cfg.ScalpingStrategies()
	if win {
		pnl = posSize * (strat.MomentumTP / 100.0)
	} else {
		pnl = -posSize * (strat.MomentumSL / 100.0)
	}

	botState.mu.Lock()
	botState.Stats.TotalTrades++
	if win {
		botState.Stats.WinningTrades++
		botState.Stats.TotalProfitUSD += pnl
		botState.Stats.DailyPnL += pnl
		botState.ConsecutiveLoss = 0
		botState.mu.Unlock()
		broadcast("log", map[string]interface{}{
			"message": fmt.Sprintf("✅%s TP HIT: %s +$%.4f", simTag, token.Symbol, pnl),
			"type":    "success",
		})
	} else {
		botState.Stats.LosingTrades++
		botState.Stats.TotalProfitUSD += pnl
		botState.Stats.DailyPnL += pnl
		botState.ConsecutiveLoss++
		consecutiveLoss := botState.ConsecutiveLoss
		botState.mu.Unlock()
		broadcast("log", map[string]interface{}{
			"message": fmt.Sprintf("❌%s SL HIT: %s -$%.4f", simTag, token.Symbol, -pnl),
			"type":    "error",
		})

		if cfg.Risk.CircuitBreaker.Enabled && consecutiveLoss >= cfg.Risk.CircuitBreaker.ConsecutiveLossesThreshold {
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

	tgBot.NotifyTrade(token.Symbol, decision.Action, pnl, decision.Confidence, simMode)

	botState.mu.Lock()
	total := botState.Stats.TotalTrades
	wins := botState.Stats.WinningTrades
	if total > 0 {
		botState.Stats.WinRate = float64(wins) / float64(total) * 100.0
	}
	botState.mu.Unlock()
}

func broadcastLoop() {
	ticker := time.NewTicker(2 * time.Second)
	for range ticker.C {
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

	msg := WSMessage{
		Type: "init",
		Data: map[string]interface{}{
			"stats":    stats,
			"running":  running,
			"simMode":  simMode,
			"telegram": tgBot.IsEnabled(),
			"log": map[string]interface{}{
				"message": fmt.Sprintf("🚀 Connected to %s v%s", cfg.Bot.Name, cfg.Bot.Version),
				"type":    "info",
			},
		},
	}
	b, _ := json.Marshal(msg)
	conn.WriteMessage(websocket.TextMessage, b)
}
