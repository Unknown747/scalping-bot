package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

type GroqClient struct {
	model   string
	timeout time.Duration
	http    *http.Client
}

func NewGroqClient(model string, timeoutSecs int) *GroqClient {
	return &GroqClient{
		model:   model,
		timeout: time.Duration(timeoutSecs) * time.Second,
		http:    &http.Client{Timeout: time.Duration(timeoutSecs) * time.Second},
	}
}

func (g *GroqClient) Analyze(ctx context.Context, tokenAddress string, marketData map[string]interface{}) map[string]*TradingDecision {
	apiKey := os.Getenv("GROQ_API_KEY")
	if apiKey == "" {
		return map[string]*TradingDecision{"groq": {Action: "HOLD", Confidence: 0, Reasoning: "no API key"}}
	}

	prompt := buildPrompt(tokenAddress, marketData)

	reqBody := map[string]interface{}{
		"model": g.model,
		"messages": []map[string]interface{}{
			{"role": "system", "content": "You are an expert crypto scalping AI. Always respond with valid JSON only."},
			{"role": "user", "content": prompt},
		},
		"temperature": 0.2,
		"max_tokens":  400,
	}

	data, _ := json.Marshal(reqBody)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.groq.com/openai/v1/chat/completions", bytes.NewBuffer(data))
	if err != nil {
		return map[string]*TradingDecision{"groq": {Action: "HOLD", Confidence: 0, Reasoning: err.Error()}}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := g.http.Do(req)
	if err != nil {
		return map[string]*TradingDecision{"groq": {Action: "HOLD", Confidence: 0, Reasoning: err.Error()}}
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return map[string]*TradingDecision{"groq": {Action: "HOLD", Confidence: 0, Reasoning: fmt.Sprintf("HTTP %d", resp.StatusCode)}}
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return map[string]*TradingDecision{"groq": {Action: "HOLD", Confidence: 0, Reasoning: "parse error"}}
	}

	if len(result.Choices) == 0 {
		return map[string]*TradingDecision{"groq": {Action: "HOLD", Confidence: 0, Reasoning: "empty response"}}
	}

	text := result.Choices[0].Message.Content
	decision := parseAIResponse("groq", text, tokenAddress)
	return map[string]*TradingDecision{"groq": decision}
}
