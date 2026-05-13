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

type AIOrchestrator struct {
	gemini    *GeminiClient
	groq      *GroqClient
	huangfing *HuangfingClient
	weights   map[string]float64
	mu        sync.RWMutex

	LastDecisions map[string]*TradingDecision
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
		huangfing:     NewHuangfingClient(huangfingURL, huangfingModel, huangfingTimeout),
		weights:       weights,
		LastDecisions: make(map[string]*TradingDecision),
	}
}

func (o *AIOrchestrator) GetTradingDecision(tokenAddress string, marketData map[string]interface{}) *TradingDecision {
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	type result struct {
		provider string
		decision *TradingDecision
	}

	resultChan := make(chan result, 3)

	go func() {
		r := o.gemini.Analyze(ctx, tokenAddress, marketData)
		for k, v := range r {
			resultChan <- result{k, v}
		}
	}()
	go func() {
		r := o.groq.Analyze(ctx, tokenAddress, marketData)
		for k, v := range r {
			resultChan <- result{k, v}
		}
	}()
	go func() {
		r := o.huangfing.Analyze(ctx, tokenAddress, marketData)
		for k, v := range r {
			resultChan <- result{k, v}
		}
	}()

	decisions := make(map[string]*TradingDecision)
	timeout := time.After(12 * time.Second)
	for i := 0; i < 3; i++ {
		select {
		case r := <-resultChan:
			decisions[r.provider] = r.decision
			o.mu.Lock()
			o.LastDecisions[r.provider] = r.decision
			o.mu.Unlock()
		case <-timeout:
			i = 3
		}
	}

	final := o.consolidate(tokenAddress, decisions)
	log.Printf("🤖 AI [%s] → %s (confidence=%.0f%%) | %v",
		tokenAddress[:min(8, len(tokenAddress))],
		final.Action, final.Confidence, final.ProviderVotes)
	return final
}

// isFailedDecision returns true when a provider returned a fallback/error HOLD
// (no API key, quota, parse error, network error). These should NOT be counted
// in the weighted vote because they carry no real signal.
func isFailedDecision(d *TradingDecision) bool {
	return d.Action == "HOLD" && d.Confidence == 0
}

func (o *AIOrchestrator) consolidate(tokenAddress string, decisions map[string]*TradingDecision) *TradingDecision {
	actionVotes := make(map[string]float64)
	totalWeight := 0.0
	providerVotes := make(map[string]string)

	for provider, decision := range decisions {
		// Skip providers that failed — they have no real signal
		if isFailedDecision(decision) {
			providerVotes[provider] = "ERR"
			continue
		}

		weight := o.weights[provider]
		if weight == 0 {
			weight = 0.33
		}
		actionVotes[decision.Action] += weight * (decision.Confidence / 100.0)
		totalWeight += weight
		providerVotes[provider] = decision.Action
	}

	// No provider gave a real response
	if totalWeight == 0 {
		return &TradingDecision{
			Action:        "HOLD",
			Confidence:    0,
			TokenAddress:  tokenAddress,
			ProviderVotes: providerVotes,
			Reasoning:     "all providers failed or no API keys",
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
		Reasoning:     "weighted majority vote (active providers only)",
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

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
