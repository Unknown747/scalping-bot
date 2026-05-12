package checker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

type CheckResult struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Message string `json:"message"`
	Latency int64  `json:"latency_ms"`
}

type CheckReport struct {
	Timestamp string        `json:"timestamp"`
	Results   []CheckResult `json:"results"`
	AllOK     bool          `json:"all_ok"`
}

var httpClient = &http.Client{Timeout: 10 * time.Second}

func RunAll(rpcEndpoints []string) *CheckReport {
	report := &CheckReport{
		Timestamp: time.Now().Format("2006-01-02 15:04:05"),
		AllOK:     true,
	}

	checks := []func() CheckResult{
		checkGeminiKey,
		checkGroqKey,
		checkHuangfingKey,
		checkTelegramBot,
		checkGeckoTerminal,
		checkDexScreener,
	}

	for _, fn := range checks {
		r := fn()
		if r.Status != "ok" && r.Status != "missing" {
			report.AllOK = false
		}
		report.Results = append(report.Results, r)
	}

	for i, ep := range rpcEndpoints {
		if i >= 3 {
			break
		}
		r := checkRPC(ep)
		if r.Status != "ok" {
			report.AllOK = false
		}
		report.Results = append(report.Results, r)
	}

	return report
}

func checkGeminiKey() CheckResult {
	key := os.Getenv("GEMINI_API_KEY")
	if key == "" {
		return CheckResult{Name: "Gemini API Key", Status: "missing", Message: "GEMINI_API_KEY not set in .env"}
	}
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models?key=%s", key)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	resp, err := httpClient.Do(req)
	lat := time.Since(start).Milliseconds()
	if err != nil {
		return CheckResult{Name: "Gemini API Key", Status: "error", Message: err.Error(), Latency: lat}
	}
	defer resp.Body.Close()
	if resp.StatusCode == 200 {
		return CheckResult{Name: "Gemini API Key", Status: "ok", Message: "Connected", Latency: lat}
	}
	return CheckResult{Name: "Gemini API Key", Status: "error", Message: fmt.Sprintf("HTTP %d — check key", resp.StatusCode), Latency: lat}
}

func checkGroqKey() CheckResult {
	key := os.Getenv("GROQ_API_KEY")
	if key == "" {
		return CheckResult{Name: "Groq API Key", Status: "missing", Message: "GROQ_API_KEY not set in .env"}
	}
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.groq.com/openai/v1/models", nil)
	req.Header.Set("Authorization", "Bearer "+key)
	resp, err := httpClient.Do(req)
	lat := time.Since(start).Milliseconds()
	if err != nil {
		return CheckResult{Name: "Groq API Key", Status: "error", Message: err.Error(), Latency: lat}
	}
	defer resp.Body.Close()
	if resp.StatusCode == 200 {
		return CheckResult{Name: "Groq API Key", Status: "ok", Message: "Connected", Latency: lat}
	}
	return CheckResult{Name: "Groq API Key", Status: "error", Message: fmt.Sprintf("HTTP %d — check key", resp.StatusCode), Latency: lat}
}

func checkHuangfingKey() CheckResult {
	key := os.Getenv("HUANGFING_API_KEY")
	if key == "" {
		return CheckResult{Name: "Huangfing API Key", Status: "missing", Message: "HUANGFING_API_KEY not set (optional)"}
	}
	return CheckResult{Name: "Huangfing API Key", Status: "ok", Message: "Key present (provider endpoint not verified)"}
}

func checkTelegramBot() CheckResult {
	token := os.Getenv("TELEGRAM_BOT_TOKEN")
	chatID := os.Getenv("TELEGRAM_CHAT_ID")
	if token == "" {
		return CheckResult{Name: "Telegram Bot", Status: "missing", Message: "TELEGRAM_BOT_TOKEN not set (optional)"}
	}
	if chatID == "" {
		return CheckResult{Name: "Telegram Bot", Status: "missing", Message: "Token set but TELEGRAM_CHAT_ID missing"}
	}
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	url := fmt.Sprintf("https://api.telegram.org/bot%s/getMe", token)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	resp, err := httpClient.Do(req)
	lat := time.Since(start).Milliseconds()
	if err != nil {
		return CheckResult{Name: "Telegram Bot", Status: "error", Message: err.Error(), Latency: lat}
	}
	defer resp.Body.Close()
	var result struct {
		OK     bool `json:"ok"`
		Result struct {
			Username string `json:"username"`
		} `json:"result"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if result.OK {
		return CheckResult{Name: "Telegram Bot", Status: "ok", Message: "@" + result.Result.Username + " ready", Latency: lat}
	}
	return CheckResult{Name: "Telegram Bot", Status: "error", Message: "Invalid token", Latency: lat}
}

func checkGeckoTerminal() CheckResult {
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://api.geckoterminal.com/api/v2/networks/base/trending_pools?page=1", nil)
	req.Header.Set("Accept", "application/json")
	resp, err := httpClient.Do(req)
	lat := time.Since(start).Milliseconds()
	if err != nil {
		return CheckResult{Name: "GeckoTerminal API", Status: "error", Message: err.Error(), Latency: lat}
	}
	defer resp.Body.Close()
	if resp.StatusCode == 200 {
		return CheckResult{Name: "GeckoTerminal API", Status: "ok", Message: "Reachable", Latency: lat}
	}
	return CheckResult{Name: "GeckoTerminal API", Status: "error", Message: fmt.Sprintf("HTTP %d", resp.StatusCode), Latency: lat}
}

func checkDexScreener() CheckResult {
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://api.dexscreener.com/latest/dex/tokens/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", nil)
	req.Header.Set("Accept", "application/json")
	resp, err := httpClient.Do(req)
	lat := time.Since(start).Milliseconds()
	if err != nil {
		return CheckResult{Name: "DexScreener API", Status: "error", Message: err.Error(), Latency: lat}
	}
	defer resp.Body.Close()
	if resp.StatusCode == 200 {
		return CheckResult{Name: "DexScreener API", Status: "ok", Message: "Reachable", Latency: lat}
	}
	return CheckResult{Name: "DexScreener API", Status: "error", Message: fmt.Sprintf("HTTP %d", resp.StatusCode), Latency: lat}
}

func checkRPC(endpoint string) CheckResult {
	name := endpoint
	if len(name) > 8 {
		name = name[8:]
	}
	if len(name) > 30 {
		name = name[:30]
	}
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	payload := []byte(`{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}`)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewBuffer(payload))
	lat := time.Since(start).Milliseconds()
	if err != nil {
		return CheckResult{Name: "RPC " + name, Status: "error", Message: err.Error(), Latency: lat}
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	lat = time.Since(start).Milliseconds()
	if err != nil {
		return CheckResult{Name: "RPC " + name, Status: "error", Message: "unreachable", Latency: lat}
	}
	defer resp.Body.Close()
	var result struct {
		Result string `json:"result"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if result.Result != "" {
		return CheckResult{Name: "RPC " + name, Status: "ok", Message: "Block: " + result.Result, Latency: lat}
	}
	return CheckResult{Name: "RPC " + name, Status: "error", Message: "No block number returned", Latency: lat}
}
