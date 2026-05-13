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

// groqModels lists Groq models tried in order when the primary fails.
var groqModels = []string{
	"llama-3.1-8b-instant",
	"llama3-8b-8192",
	"llama3-70b-8192",
	"mixtral-8x7b-32768",
	"gemma2-9b-it",
}

type GroqClient struct {
	model   string
	timeout time.Duration
	http    *http.Client
}

func NewGroqClient(model string, timeoutSecs int) *GroqClient {
	primary := "llama-3.1-8b-instant"
	if model != "" {
		primary = model
	}
	return &GroqClient{
		model:   primary,
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

	// Build model list: primary first, then fallbacks (deduplicated)
	modelsToTry := []string{g.model}
	for _, m := range groqModels {
		if m != g.model {
			modelsToTry = append(modelsToTry, m)
		}
	}

	var lastErr string
	for attempt, model := range modelsToTry {
		decision, errStr := g.callGroqModel(ctx, apiKey, prompt, model, tokenAddress)
		if decision != nil {
			if attempt > 0 {
				log.Printf("🤖 Groq: success with fallback model=%s (attempt %d)", model, attempt+1)
			}
			return map[string]*TradingDecision{"groq": decision}
		}
		lastErr = errStr
		log.Printf("🤖 Groq: model=%s failed: %s — trying next", model, errStr)

		select {
		case <-ctx.Done():
			return map[string]*TradingDecision{"groq": {Action: "HOLD", Confidence: 0, Reasoning: "timeout"}}
		default:
		}
	}

	log.Printf("🤖 Groq ERR: all %d models failed. last=%s", len(modelsToTry), lastErr)
	return map[string]*TradingDecision{"groq": {Action: "HOLD", Confidence: 0, Reasoning: "all models failed: " + lastErr}}
}

func (g *GroqClient) callGroqModel(ctx context.Context, apiKey, prompt, model, tokenAddress string) (*TradingDecision, string) {
	reqBody := map[string]interface{}{
		"model": model,
		"messages": []map[string]interface{}{
			{"role": "system", "content": "You are an expert crypto scalping AI on Base Network. Always respond with valid JSON only. No extra text."},
			{"role": "user", "content": prompt},
		},
		"temperature": 0.2,
		"max_tokens":  400,
	}

	data, _ := json.Marshal(reqBody)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.groq.com/openai/v1/chat/completions", bytes.NewBuffer(data))
	if err != nil {
		return nil, "build request: " + err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := g.http.Do(req)
	if err != nil {
		return nil, "network: " + err.Error()
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	snippet := string(body)
	if len(snippet) > 300 {
		snippet = snippet[:300]
	}

	if resp.StatusCode == 429 {
		return nil, fmt.Sprintf("rate limited (429) model=%s", model)
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Sprintf("HTTP %d model=%s body=%s", resp.StatusCode, model, snippet)
	}
	if len(body) == 0 {
		return nil, fmt.Sprintf("empty body model=%s", model)
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Sprintf("parse error: %v body=%s", err, snippet)
	}
	if result.Error.Message != "" {
		return nil, fmt.Sprintf("API error: %s model=%s", result.Error.Message, model)
	}
	if len(result.Choices) == 0 || result.Choices[0].Message.Content == "" {
		return nil, fmt.Sprintf("empty choices model=%s body=%s", model, snippet)
	}

	text := result.Choices[0].Message.Content
	decision := parseAIResponse("groq", text, tokenAddress)
	log.Printf("🤖 Groq [%s] model=%s → %s (%.0f%%)", shortAddr(tokenAddress), model, decision.Action, decision.Confidence)
	return decision, ""
}
