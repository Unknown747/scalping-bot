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

// freeModels lists OpenRouter free models tried in order when the primary fails.
// All have ":free" suffix — no credits required.
// Updated May 2026 — verified available on OpenRouter free tier.
var freeModels = []string{
        "meta-llama/llama-3.2-3b-instruct:free",
        "meta-llama/llama-4-scout:free",
        "deepseek/deepseek-r1:free",
        "deepseek/deepseek-chat-v3-0324:free",
        "google/gemma-3-4b-it:free",
        "microsoft/mai-ds-r1:free",
}

type OpenRouterClient struct {
        model   string
        timeout time.Duration
        http    *http.Client
}

func NewOpenRouterClient(model string, timeoutSecs int) *OpenRouterClient {
        // Always use a known-good free model as primary regardless of config
        primary := "meta-llama/llama-3.2-3b-instruct:free"
        if model != "" && model != "openai/gpt-oss-20b:free" {
                primary = model
        }
        return &OpenRouterClient{
                model:   primary,
                timeout: time.Duration(timeoutSecs) * time.Second,
                http:    &http.Client{Timeout: time.Duration(timeoutSecs) * time.Second},
        }
}

func (o *OpenRouterClient) Analyze(ctx context.Context, tokenAddress string, marketData map[string]interface{}) map[string]*TradingDecision {
        apiKey := os.Getenv("OPENROUTER_API_KEY")
        if apiKey == "" {
                return map[string]*TradingDecision{"openrouter": {Action: "HOLD", Confidence: 0, Reasoning: "no API key"}}
        }

        prompt := buildPrompt(tokenAddress, marketData)

        // Build list of models to try: primary first, then fallbacks
        modelsToTry := []string{o.model}
        for _, m := range freeModels {
                if m != o.model {
                        modelsToTry = append(modelsToTry, m)
                }
        }

        var lastErr string
        for attempt, model := range modelsToTry {
                decision, errStr, fatal := o.callModel(ctx, apiKey, prompt, model, tokenAddress)
                if decision != nil {
                        if attempt > 0 {
                                log.Printf("🤖 OpenRouter: success with fallback model=%s (attempt %d)", model, attempt+1)
                        }
                        return map[string]*TradingDecision{"openrouter": decision}
                }
                lastErr = errStr

                // 429 on the primary means we are rate-limited for this key.
                // Fallback models for this account are 404, so stop immediately.
                if fatal {
                        log.Printf("🤖 OpenRouter rate-limited (429) — skipping fallbacks")
                        break
                }

                log.Printf("🤖 OpenRouter: model=%s failed: %s — trying next", model, errStr)

                // If context already done, stop trying
                select {
                case <-ctx.Done():
                        return map[string]*TradingDecision{"openrouter": {Action: "HOLD", Confidence: 0, Reasoning: "timeout"}}
                default:
                }
        }

        log.Printf("🤖 OpenRouter ERR: %s", lastErr)
        return map[string]*TradingDecision{"openrouter": {Action: "HOLD", Confidence: 0, Reasoning: lastErr}}
}

// callModel returns (decision, errStr, fatal).
// fatal=true means stop trying further models (e.g. rate-limited — all fallbacks will also fail).
func (o *OpenRouterClient) callModel(ctx context.Context, apiKey, prompt, model, tokenAddress string) (*TradingDecision, string, bool) {
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
                "https://openrouter.ai/api/v1/chat/completions", bytes.NewBuffer(data))
        if err != nil {
                return nil, "build request: " + err.Error(), false
        }
        req.Header.Set("Content-Type", "application/json")
        req.Header.Set("Authorization", "Bearer "+apiKey)
        req.Header.Set("HTTP-Referer", "https://memescalper.bot")
        req.Header.Set("X-Title", "MemeScalper AI Pro")

        resp, err := o.http.Do(req)
        if err != nil {
                return nil, "network: " + err.Error(), false
        }
        defer resp.Body.Close()

        body, _ := io.ReadAll(resp.Body)
        snippet := string(body)
        if len(snippet) > 300 {
                snippet = snippet[:300]
        }

        if resp.StatusCode == 429 {
                // Rate-limited — signal caller to stop trying fallbacks (they'll also fail)
                return nil, fmt.Sprintf("rate limited (429) model=%s", model), true
        }
        if resp.StatusCode == 400 {
                return nil, fmt.Sprintf("bad request (400) model=%s body=%s", model, snippet), false
        }
        if resp.StatusCode != 200 {
                return nil, fmt.Sprintf("HTTP %d model=%s body=%s", resp.StatusCode, model, snippet), false
        }
        if len(body) == 0 {
                return nil, fmt.Sprintf("empty body model=%s", model), false
        }

        var result struct {
                Choices []struct {
                        Message struct {
                                Content string `json:"content"`
                        } `json:"message"`
                } `json:"choices"`
                Error struct {
                        Message string `json:"message"`
                        Code    int    `json:"code"`
                } `json:"error"`
        }
        if err := json.Unmarshal(body, &result); err != nil {
                return nil, fmt.Sprintf("parse error: %v body=%s", err, snippet), false
        }
        if result.Error.Message != "" {
                return nil, fmt.Sprintf("API error: %s (code=%d) model=%s", result.Error.Message, result.Error.Code, model), false
        }
        if len(result.Choices) == 0 || result.Choices[0].Message.Content == "" {
                return nil, fmt.Sprintf("empty choices model=%s body=%s", model, snippet), false
        }

        text := result.Choices[0].Message.Content
        decision := parseAIResponse("openrouter", text, tokenAddress)
        log.Printf("🤖 OpenRouter [%s] model=%s → %s (%.0f%%)", shortAddr(tokenAddress), model, decision.Action, decision.Confidence)
        return decision, "", false
}
