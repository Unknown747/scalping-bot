package ai

import (
        "context"
        "log"
        "sync"
        "time"
)

type TradingDecision struct {
        Action        string            `json:"action"`
        Confidence    float64           `json:"confidence"`
        TokenAddress  string            `json:"token_address"`
        AmountUSD     float64           `json:"amount_usd"`
        Reasoning     string            `json:"reasoning"`
        ProviderVotes map[string]string `json:"provider_votes"`
}

// cachedDecision wraps a decision with an expiry timestamp.
type cachedDecision struct {
        decision  *TradingDecision
        expiresAt time.Time
}

type AIOrchestrator struct {
        gemini     *GeminiClient
        groq       *GroqClient
        openrouter *OpenRouterClient
        together   *TogetherClient
        huangfing  *HuangfingClient
        weights    map[string]float64
        mu         sync.RWMutex

        LastDecisions map[string]*TradingDecision

        // Decision cache — same token is not re-analyzed more than once per TTL.
        cacheMu  sync.Mutex
        cache    map[string]*cachedDecision
        cacheTTL time.Duration

        // Key-pool status exposed to the broadcast loop for dashboard display.
        poolMu     sync.RWMutex
        poolStatus map[string]string // e.g. {"key#1":"ok","key#2":"limited(42s)"}
        poolTotal  int
        poolAvail  int
}

func NewOrchestrator(
        geminiModel string, geminiTimeout int,
        groqModel string, groqTimeout int,
        openrouterModel string, openrouterTimeout int,
        togetherModel string, togetherTimeout int,
        huangfingURL, huangfingModel string, huangfingTimeout int,
        weights map[string]float64,
) *AIOrchestrator {
        g := NewGeminiClient(geminiModel, geminiTimeout)
        return &AIOrchestrator{
                gemini:        g,
                groq:          NewGroqClient(groqModel, groqTimeout),
                openrouter:    NewOpenRouterClient(openrouterModel, openrouterTimeout),
                together:      NewTogetherClient(togetherModel, togetherTimeout),
                huangfing:     NewHuangfingClient(huangfingURL, huangfingModel, huangfingTimeout),
                weights:       weights,
                LastDecisions: make(map[string]*TradingDecision),
                cache:         make(map[string]*cachedDecision),
                cacheTTL:      3 * time.Minute,
                poolTotal:     g.KeyPool().Size(),
                poolAvail:     g.KeyPool().AvailableCount(),
                poolStatus:    g.KeyPool().Status(),
        }
}

// ─── Key Pool Status ──────────────────────────────────────────────────────────

// GeminiPoolInfo is a snapshot of the Gemini key pool for dashboard display.
type GeminiPoolInfo struct {
        Total     int               `json:"total"`
        Available int               `json:"available"`
        Keys      map[string]string `json:"keys"`
        Detail    []KeyStat         `json:"detail"` // per-key detailed stats for System tab
}

// GetGeminiPoolInfo returns a dashboard-safe snapshot of the key pool.
func (o *AIOrchestrator) GetGeminiPoolInfo() GeminiPoolInfo {
        o.poolMu.RLock()
        defer o.poolMu.RUnlock()
        return GeminiPoolInfo{
                Total:     o.poolTotal,
                Available: o.poolAvail,
                Keys:      o.poolStatus,
                Detail:    o.gemini.KeyPool().DetailedStats(),
        }
}

// refreshPoolStatus snapshots current pool state (call after every Gemini use).
func (o *AIOrchestrator) refreshPoolStatus() {
        pool := o.gemini.KeyPool()
        status := pool.Status()
        avail := pool.AvailableCount()
        o.poolMu.Lock()
        o.poolStatus = status
        o.poolAvail = avail
        o.poolMu.Unlock()
}

// ─── Cache ────────────────────────────────────────────────────────────────────

func (o *AIOrchestrator) getCached(tokenAddress string) (*TradingDecision, bool) {
        o.cacheMu.Lock()
        defer o.cacheMu.Unlock()
        if c, ok := o.cache[tokenAddress]; ok && time.Now().Before(c.expiresAt) {
                return c.decision, true
        }
        return nil, false
}

func (o *AIOrchestrator) setCached(tokenAddress string, d *TradingDecision) {
        o.cacheMu.Lock()
        defer o.cacheMu.Unlock()
        o.cache[tokenAddress] = &cachedDecision{decision: d, expiresAt: time.Now().Add(o.cacheTTL)}
}

// ─── Core Decision ────────────────────────────────────────────────────────────

func (o *AIOrchestrator) GetTradingDecision(tokenAddress string, marketData map[string]interface{}) *TradingDecision {
        if cached, ok := o.getCached(tokenAddress); ok {
                log.Printf("🤖 AI [%s] → %s (%.0f%%) [cached] | %v",
                        shortAddr(tokenAddress), cached.Action, cached.Confidence, cached.ProviderVotes)
                return cached
        }

        ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
        defer cancel()

        type result struct {
                provider string
                decision *TradingDecision
        }

        resultChan := make(chan result, 5)

        go func() {
                for k, v := range o.gemini.Analyze(ctx, tokenAddress, marketData) {
                        resultChan <- result{k, v}
                }
                o.refreshPoolStatus()
        }()
        go func() {
                for k, v := range o.groq.Analyze(ctx, tokenAddress, marketData) {
                        resultChan <- result{k, v}
                }
        }()
        go func() {
                for k, v := range o.openrouter.Analyze(ctx, tokenAddress, marketData) {
                        resultChan <- result{k, v}
                }
        }()
        go func() {
                for k, v := range o.together.Analyze(ctx, tokenAddress, marketData) {
                        resultChan <- result{k, v}
                }
        }()
        go func() {
                for k, v := range o.huangfing.Analyze(ctx, tokenAddress, marketData) {
                        resultChan <- result{k, v}
                }
        }()

        decisions := make(map[string]*TradingDecision)
        timeout := time.After(12 * time.Second)
        for i := 0; i < 5; i++ {
                select {
                case r := <-resultChan:
                        decisions[r.provider] = r.decision
                        o.mu.Lock()
                        o.LastDecisions[r.provider] = r.decision
                        o.mu.Unlock()
                case <-timeout:
                        i = 5
                }
        }

        // Detect Gemini all-keys-exhausted and log a clear fallback message.
        if gd, ok := decisions["gemini"]; ok && gd.Reasoning == "all_keys_rate_limited" {
                pool := o.gemini.KeyPool()
                log.Printf("🔄 Gemini ALL %d key(s) rate-limited — falling back to Groq + Huangfing", pool.Size())
        }

        final := o.consolidate(tokenAddress, decisions)
        o.setCached(tokenAddress, final)

        log.Printf("🤖 AI [%s] → %s (%.0f%%) | %v",
                shortAddr(tokenAddress), final.Action, final.Confidence, final.ProviderVotes)
        return final
}

// ─── Consolidation ───────────────────────────────────────────────────────────

// isFailedDecision returns true when a provider returned a fallback error HOLD
// with zero confidence — no real signal, should not affect the weighted vote.
func isFailedDecision(d *TradingDecision) bool {
        return d.Action == "HOLD" && d.Confidence == 0
}

func (o *AIOrchestrator) consolidate(tokenAddress string, decisions map[string]*TradingDecision) *TradingDecision {
        actionVotes := make(map[string]float64)
        totalWeight := 0.0
        providerVotes := make(map[string]string)

        // When ALL Gemini keys are limited, give Groq + Huangfing the Gemini weight
        // so the vote quality doesn't degrade.
        geminiAllLimited := false
        if gd, ok := decisions["gemini"]; ok && gd.Reasoning == "all_keys_rate_limited" {
                geminiAllLimited = true
        }

        for provider, decision := range decisions {
                if isFailedDecision(decision) {
                        if provider == "gemini" && geminiAllLimited {
                                providerVotes[provider] = "ALL_LIMITED"
                        } else {
                                providerVotes[provider] = "ERR"
                        }
                        continue
                }
                weight := o.weights[provider]
                if weight == 0 {
                        weight = 0.25
                }
                // Redistribute Gemini weight to Groq and Huangfing when all keys exhausted
                if geminiAllLimited && (provider == "groq" || provider == "huangfing") {
                        extra := o.weights["gemini"] / 2.0
                        weight += extra
                }
                actionVotes[decision.Action] += weight * (decision.Confidence / 100.0)
                totalWeight += weight
                providerVotes[provider] = decision.Action
        }

        if totalWeight == 0 {
                return &TradingDecision{
                        Action:        "HOLD",
                        Confidence:    0,
                        TokenAddress:  tokenAddress,
                        ProviderVotes: providerVotes,
                        Reasoning:     "all providers failed — no API keys active or all rate-limited",
                }
        }

        finalAction := "HOLD"
        maxVotes := 0.0
        for action, votes := range actionVotes {
                if votes > maxVotes {
                        maxVotes = votes
                        finalAction = action
                }
        }

        confidence := (maxVotes / totalWeight) * 100.0

        reasoning := "weighted majority (active providers only)"
        if geminiAllLimited {
                reasoning = "weighted majority — Gemini all keys limited, Groq+Huangfing boosted"
        }

        return &TradingDecision{
                Action:        finalAction,
                Confidence:    confidence,
                TokenAddress:  tokenAddress,
                ProviderVotes: providerVotes,
                Reasoning:     reasoning,
        }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func (o *AIOrchestrator) GetLastDecisions() map[string]*TradingDecision {
        o.mu.RLock()
        defer o.mu.RUnlock()
        out := make(map[string]*TradingDecision)
        for k, v := range o.LastDecisions {
                out[k] = v
        }
        return out
}

func shortAddr(addr string) string {
        if len(addr) > 8 {
                return addr[:8]
        }
        return addr
}

func min(a, b int) int {
        if a < b {
                return a
        }
        return b
}
