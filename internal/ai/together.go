package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

type TogetherClient struct {
	model string
	http  *http.Client
}

func NewTogetherClient(model string, timeoutSecs int) *TogetherClient {
	return &TogetherClient{
		model: model,
		http:  &http.Client{Timeout: time.Duration(timeoutSecs) * time.Second},
	}
}

func (t *TogetherClient) Analyze(ctx context.Context, tokenAddress string, marketData map[string]interface{}) map[string]*TradingDecision {
	apiKey := os.Getenv("TOGETHER_API_KEY")
	if apiKey == "" {
		return map[string]*TradingDecision{"together": {Action: "HOLD", Confidence: 0, Reasoning: "no API key"}}
	}

	prompt := buildPrompt(tokenAddress, marketData)

	reqBody := map[string]interface{}{
		"model": t.model,
		"messages": []map[string]interface{}{
			{"role": "system", "content": "You are an expert crypto scalping AI on Base Network. Always respond with valid JSON only. No extra text."},
			{"role": "user", "content": prompt},
		},
		"temperature": 0.2,
		"max_tokens":  300,
	}

	data, _ := json.Marshal(reqBody)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.together.ai/v1/chat/completions", bytes.NewBuffer(data))
	if err != nil {
		log.Printf("🤖 Together ERR: build request: %v", err)
		return map[string]*TradingDecision{"together": {Action: "HOLD", Confidence: 0, Reasoning: err.Error()}}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := t.http.Do(req)
	if err != nil {
		log.Printf("🤖 Together ERR: network: %v", err)
		return map[string]*TradingDecision{"together": {Action: "HOLD", Confidence: 0, Reasoning: "network: " + err.Error()}}
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode == 429 {
		log.Printf("🤖 Together ERR: rate limited (429)")
		return map[string]*TradingDecision{"together": {Action: "HOLD", Confidence: 0, Reasoning: "rate limited"}}
	}
	if resp.StatusCode != 200 {
		snippet := string(body)
		if len(snippet) > 200 {
			snippet = snippet[:200]
		}
		log.Printf("🤖 Together ERR: HTTP %d | model=%s | body=%s", resp.StatusCode, t.model, snippet)
		return map[string]*TradingDecision{"together": {Action: "HOLD", Confidence: 0, Reasoning: fmt.Sprintf("HTTP %d", resp.StatusCode)}}
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		log.Printf("🤖 Together ERR: parse: %v | body=%s", err, string(body)[:min(200, len(body))])
		return map[string]*TradingDecision{"together": {Action: "HOLD", Confidence: 0, Reasoning: "parse error"}}
	}
	if len(result.Choices) == 0 {
		log.Printf("🤖 Together ERR: empty choices | body=%s", string(body)[:min(200, len(body))])
		return map[string]*TradingDecision{"together": {Action: "HOLD", Confidence: 0, Reasoning: "empty response"}}
	}

	text := result.Choices[0].Message.Content
	decision := parseAIResponse("together", text, tokenAddress)
	return map[string]*TradingDecision{"together": decision}
}
