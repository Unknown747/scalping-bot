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
	// This prevents hammering APIs every 3 seconds for the same token.
	cacheMu sync.Mutex
	cache   map[string]*cachedDecision
	cacheTTL time.Duration
}

func NewOrchestrator(
	geminiModel string, geminiTimeout int,
	groqModel string, groqTimeout int,
	huangfingURL, huangfingModel string, huangfingTimeout int,
	weights map[string]float64,
) *AIOrchestrator {
	return &AIOrchestrator{
		gemini:        NewGeminiClient(geminiModel, geminiTimeout),
		groq:          NewGroqClient(groqModel, groqTimeout),
		openrouter:    NewOpenRouterClient("meta-llama/llama-3.2-3b-instruct:free", 8),
		together:      NewTogetherClient("meta-llama/Llama-3.2-3B-Instruct-Turbo", 8),
		huangfing:     NewHuangfingClient(huangfingURL, huangfingModel, huangfingTimeout),
		weights:       weights,
		LastDecisions: make(map[string]*TradingDecision),
		cache:         make(map[string]*cachedDecision),
		cacheTTL:      3 * time.Minute,
	}
}

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

func (o *AIOrchestrator) GetTradingDecision(tokenAddress string, marketData map[string]interface{}) *TradingDecision {
	// Return cached decision if still fresh — avoids re-calling APIs every cycle
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

	// All 5 providers run concurrently; only active ones (with API keys) contribute.
	resultChan := make(chan result, 5)

	go func() {
		for k, v := range o.gemini.Analyze(ctx, tokenAddress, marketData) {
			resultChan <- result{k, v}
		}
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

	final := o.consolidate(tokenAddress, decisions)
	o.setCached(tokenAddress, final)

	log.Printf("🤖 AI [%s] → %s (%.0f%%) | %v",
		shortAddr(tokenAddress), final.Action, final.Confidence, final.ProviderVotes)
	return final
}

// isFailedDecision returns true when a provider returned a fallback error HOLD
// with zero confidence — no real signal, should not affect the weighted vote.
func isFailedDecision(d *TradingDecision) bool {
	return d.Action == "HOLD" && d.Confidence == 0
}

func (o *AIOrchestrator) consolidate(tokenAddress string, decisions map[string]*TradingDecision) *TradingDecision {
	actionVotes := make(map[string]float64)
	totalWeight := 0.0
	providerVotes := make(map[string]string)

	for provider, decision := range decisions {
		if isFailedDecision(decision) {
			providerVotes[provider] = "ERR"
			continue
		}
		weight := o.weights[provider]
		if weight == 0 {
			weight = 0.25
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

	return &TradingDecision{
		Action:        finalAction,
		Confidence:    confidence,
		TokenAddress:  tokenAddress,
		ProviderVotes: providerVotes,
		Reasoning:     "weighted majority (active providers only)",
	}
}

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
