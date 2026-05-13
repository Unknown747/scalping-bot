package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"time"
)

type HuangfingClient struct {
	baseURL string
	model   string
	http    *http.Client
}

func NewHuangfingClient(baseURL, model string, timeoutSecs int) *HuangfingClient {
	return &HuangfingClient{
		baseURL: baseURL,
		model:   model,
		http:    &http.Client{Timeout: time.Duration(timeoutSecs) * time.Second},
	}
}

func (h *HuangfingClient) Analyze(ctx context.Context, tokenAddress string, marketData map[string]interface{}) map[string]*TradingDecision {
	apiKey := os.Getenv("HUANGFING_API_KEY")
	if apiKey == "" {
		return map[string]*TradingDecision{"huangfing": {Action: "HOLD", Confidence: 0, Reasoning: "no API key"}}
	}

	prompt := buildPrompt(tokenAddress, marketData)

	reqBody := map[string]interface{}{
		"model": h.model,
		"messages": []map[string]interface{}{
			{"role": "system", "content": "You are an expert crypto scalping AI. Always respond with valid JSON only."},
			{"role": "user", "content": prompt},
		},
		"temperature": 0.35,
		"max_tokens":  600,
	}

	data, _ := json.Marshal(reqBody)
	url := h.baseURL + "/chat/completions"

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewBuffer(data))
	if err != nil {
		return map[string]*TradingDecision{"huangfing": {Action: "HOLD", Confidence: 0, Reasoning: err.Error()}}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := h.http.Do(req)
	if err != nil {
		return map[string]*TradingDecision{"huangfing": {Action: "HOLD", Confidence: 0, Reasoning: "provider unavailable"}}
	}
	defer resp.Body.Close()

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return map[string]*TradingDecision{"huangfing": {Action: "HOLD", Confidence: 0, Reasoning: "parse error"}}
	}

	if len(result.Choices) == 0 {
		return map[string]*TradingDecision{"huangfing": {Action: "HOLD", Confidence: 0, Reasoning: "empty response"}}
	}

	text := result.Choices[0].Message.Content
	decision := parseAIResponse("huangfing", text, tokenAddress)
	return map[string]*TradingDecision{"huangfing": decision}
}
