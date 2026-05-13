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

type OpenRouterClient struct {
        model string
        http  *http.Client
}

func NewOpenRouterClient(model string, timeoutSecs int) *OpenRouterClient {
        return &OpenRouterClient{
                model: model,
                http:  &http.Client{Timeout: time.Duration(timeoutSecs) * time.Second},
        }
}

func (o *OpenRouterClient) Analyze(ctx context.Context, tokenAddress string, marketData map[string]interface{}) map[string]*TradingDecision {
        apiKey := os.Getenv("OPENROUTER_API_KEY")
        if apiKey == "" {
                return map[string]*TradingDecision{"openrouter": {Action: "HOLD", Confidence: 0, Reasoning: "no API key"}}
        }

        prompt := buildPrompt(tokenAddress, marketData)

        reqBody := map[string]interface{}{
                "model": o.model,
                "messages": []map[string]interface{}{
                        {"role": "system", "content": "You are an expert crypto scalping AI on Base Network. Always respond with valid JSON only. No extra text."},
                        {"role": "user", "content": prompt},
                },
                "temperature": 0.2,
                "max_tokens":  300,
        }

        data, _ := json.Marshal(reqBody)
        req, err := http.NewRequestWithContext(ctx, http.MethodPost,
                "https://openrouter.ai/api/v1/chat/completions", bytes.NewBuffer(data))
        if err != nil {
                log.Printf("🤖 OpenRouter ERR: build request: %v", err)
                return map[string]*TradingDecision{"openrouter": {Action: "HOLD", Confidence: 0, Reasoning: err.Error()}}
        }
        req.Header.Set("Content-Type", "application/json")
        req.Header.Set("Authorization", "Bearer "+apiKey)
        req.Header.Set("HTTP-Referer", "https://memescalper.bot")
        req.Header.Set("X-Title", "MemeScalper AI Pro")

        resp, err := o.http.Do(req)
        if err != nil {
                log.Printf("🤖 OpenRouter ERR: network: %v", err)
                return map[string]*TradingDecision{"openrouter": {Action: "HOLD", Confidence: 0, Reasoning: "network: " + err.Error()}}
        }
        defer resp.Body.Close()

        body, _ := io.ReadAll(resp.Body)

        if resp.StatusCode == 429 {
                log.Printf("🤖 OpenRouter ERR: rate limited (429)")
                return map[string]*TradingDecision{"openrouter": {Action: "HOLD", Confidence: 0, Reasoning: "rate limited"}}
        }
        if resp.StatusCode != 200 {
                snippet := string(body)
                if len(snippet) > 200 {
                        snippet = snippet[:200]
                }
                log.Printf("🤖 OpenRouter ERR: HTTP %d | model=%s | body=%s", resp.StatusCode, o.model, snippet)
                return map[string]*TradingDecision{"openrouter": {Action: "HOLD", Confidence: 0, Reasoning: fmt.Sprintf("HTTP %d", resp.StatusCode)}}
        }

        // Guard against empty body (can happen on network hiccup or 0-byte response)
        if len(body) == 0 {
                log.Printf("🤖 OpenRouter ERR: empty response body (model=%s)", o.model)
                return map[string]*TradingDecision{"openrouter": {Action: "HOLD", Confidence: 0, Reasoning: "empty body"}}
        }

        var result struct {
                Choices []struct {
                        Message struct {
                                Content string `json:"content"`
                        } `json:"message"`
                } `json:"choices"`
        }
        if err := json.Unmarshal(body, &result); err != nil {
                bodySnip := string(body)
                if len(bodySnip) > 200 {
                        bodySnip = bodySnip[:200]
                }
                log.Printf("🤖 OpenRouter ERR: parse: %v | body=%s", err, bodySnip)
                return map[string]*TradingDecision{"openrouter": {Action: "HOLD", Confidence: 0, Reasoning: "parse error"}}
        }
        if len(result.Choices) == 0 {
                bodySnip := string(body)
                if len(bodySnip) > 200 {
                        bodySnip = bodySnip[:200]
                }
                log.Printf("🤖 OpenRouter ERR: empty choices | body=%s", bodySnip)
                return map[string]*TradingDecision{"openrouter": {Action: "HOLD", Confidence: 0, Reasoning: "empty response"}}
        }

        text := result.Choices[0].Message.Content
        decision := parseAIResponse("openrouter", text, tokenAddress)
        return map[string]*TradingDecision{"openrouter": decision}
}
