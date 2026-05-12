package ai

import (
        "bytes"
        "context"
        "encoding/json"
        "fmt"
        "net/http"
        "os"
        "strings"
        "time"
)

type GeminiClient struct {
        apiKey  string
        model   string
        timeout time.Duration
        http    *http.Client
}

func NewGeminiClient(model string, timeoutSecs int) *GeminiClient {
        return &GeminiClient{
                apiKey:  os.Getenv("GEMINI_API_KEY"),
                model:   model,
                timeout: time.Duration(timeoutSecs) * time.Second,
                http:    &http.Client{Timeout: time.Duration(timeoutSecs) * time.Second},
        }
}

func (g *GeminiClient) Analyze(ctx context.Context, tokenAddress string, marketData map[string]interface{}) map[string]*TradingDecision {
        if g.apiKey == "" {
                return map[string]*TradingDecision{"gemini": {Action: "HOLD", Confidence: 0, Reasoning: "no API key"}}
        }

        prompt := buildPrompt(tokenAddress, marketData)

        reqBody := map[string]interface{}{
                "contents": []map[string]interface{}{
                        {
                                "parts": []map[string]interface{}{
                                        {"text": prompt},
                                },
                        },
                },
                "generationConfig": map[string]interface{}{
                        "temperature":     0.3,
                        "maxOutputTokens": 500,
                },
        }

        data, _ := json.Marshal(reqBody)
        url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s", g.model, g.apiKey)

        req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewBuffer(data))
        if err != nil {
                return map[string]*TradingDecision{"gemini": {Action: "HOLD", Confidence: 0, Reasoning: err.Error()}}
        }
        req.Header.Set("Content-Type", "application/json")

        resp, err := g.http.Do(req)
        if err != nil {
                return map[string]*TradingDecision{"gemini": {Action: "HOLD", Confidence: 0, Reasoning: err.Error()}}
        }
        defer resp.Body.Close()

        var result struct {
                Candidates []struct {
                        Content struct {
                                Parts []struct {
                                        Text string `json:"text"`
                                } `json:"parts"`
                        } `json:"content"`
                } `json:"candidates"`
        }

        if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
                return map[string]*TradingDecision{"gemini": {Action: "HOLD", Confidence: 0, Reasoning: "parse error"}}
        }

        if len(result.Candidates) == 0 || len(result.Candidates[0].Content.Parts) == 0 {
                return map[string]*TradingDecision{"gemini": {Action: "HOLD", Confidence: 0, Reasoning: "empty response"}}
        }

        text := result.Candidates[0].Content.Parts[0].Text
        decision := parseAIResponse("gemini", text, tokenAddress)
        return map[string]*TradingDecision{"gemini": decision}
}

func buildPrompt(tokenAddress string, data map[string]interface{}) string {
        dataJSON, _ := json.Marshal(data)
        return fmt.Sprintf(`You are an expert crypto scalping AI on Base Network.
Analyze this token and market data, then give a trading decision.

Token: %s
Market Data: %s

Respond ONLY in this exact JSON format:
{"action":"BUY|SELL|HOLD","confidence":0-100,"reasoning":"brief reason"}

Rules:
- BUY if strong momentum, volume spike > 2.5x, price up > 1.5%%
- SELL if price down > 1%% or volume declining
- HOLD if uncertain
- confidence must be 0-100 integer`, tokenAddress, string(dataJSON))
}

func parseAIResponse(provider, text, tokenAddress string) *TradingDecision {
        text = strings.TrimSpace(text)

        start := strings.Index(text, "{")
        end := strings.LastIndex(text, "}")
        if start != -1 && end != -1 && end > start {
                text = text[start : end+1]
        }

        var parsed struct {
                Action     string  `json:"action"`
                Confidence float64 `json:"confidence"`
                Reasoning  string  `json:"reasoning"`
        }

        if err := json.Unmarshal([]byte(text), &parsed); err != nil {
                return &TradingDecision{Action: "HOLD", Confidence: 50, Reasoning: "parse error: " + text[:min(50, len(text))], TokenAddress: tokenAddress}
        }

        action := strings.ToUpper(parsed.Action)
        if action != "BUY" && action != "SELL" && action != "HOLD" {
                action = "HOLD"
        }

        return &TradingDecision{
                Action:       action,
                Confidence:   parsed.Confidence,
                Reasoning:    parsed.Reasoning,
                TokenAddress: tokenAddress,
        }
}

