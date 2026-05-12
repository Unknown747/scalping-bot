package ai

import (
	"context"
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
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
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
	timeout := time.After(500 * time.Millisecond)
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

	return o.consolidate(tokenAddress, decisions)
}

func (o *AIOrchestrator) consolidate(tokenAddress string, decisions map[string]*TradingDecision) *TradingDecision {
	actionVotes := make(map[string]float64)
	totalWeight := 0.0
	providerVotes := make(map[string]string)

	for provider, decision := range decisions {
		weight := o.weights[provider]
		if weight == 0 {
			weight = 0.33
		}
		actionVotes[decision.Action] += weight * (decision.Confidence / 100.0)
		totalWeight += weight
		providerVotes[provider] = decision.Action
	}

	finalAction := "HOLD"
	maxVotes := 0.0
	for action, votes := range actionVotes {
		if votes > maxVotes {
			maxVotes = votes
			finalAction = action
		}
	}

	confidence := 0.0
	if totalWeight > 0 {
		confidence = (maxVotes / totalWeight) * 100.0
	}

	return &TradingDecision{
		Action:        finalAction,
		Confidence:    confidence,
		TokenAddress:  tokenAddress,
		ProviderVotes: providerVotes,
		Reasoning:     "weighted majority vote",
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
