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
                checkWETHContract,
        }

        for _, fn := range checks {
                r := fn()
                // "warning" (e.g. zero WETH balance) is informational, not a failure.
                if r.Status != "ok" && r.Status != "missing" && r.Status != "warning" {
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

        // Check WETH balance if wallet is configured
        walletAddr := os.Getenv("WALLET_ADDRESS")
        if walletAddr != "" && len(rpcEndpoints) > 0 {
                r := checkWETHBalance(rpcEndpoints[0], walletAddr)
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

func checkWETHContract() CheckResult {
        const wethAddr = "0x4200000000000000000000000000000000000006"
        const rpc = "https://mainnet.base.org"

        payload := fmt.Sprintf(`{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"%s","data":"0x06fdde03"},"latest"],"id":1}`, wethAddr)
        start := time.Now()
        ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
        defer cancel()
        req, err := http.NewRequestWithContext(ctx, http.MethodPost, rpc, bytes.NewBufferString(payload))
        if err != nil {
                return CheckResult{Name: "WETH Contract (Base)", Status: "error", Message: err.Error()}
        }
        req.Header.Set("Content-Type", "application/json")
        resp, err := httpClient.Do(req)
        lat := time.Since(start).Milliseconds()
        if err != nil {
                return CheckResult{Name: "WETH Contract (Base)", Status: "error", Message: err.Error(), Latency: lat}
        }
        defer resp.Body.Close()
        var result struct {
                Result string `json:"result"`
        }
        json.NewDecoder(resp.Body).Decode(&result)
        if result.Result != "" && result.Result != "0x" {
                return CheckResult{Name: "WETH Contract (Base)", Status: "ok", Message: "0x4200...0006 reachable", Latency: lat}
        }
        return CheckResult{Name: "WETH Contract (Base)", Status: "error", Message: "No response from WETH contract", Latency: lat}
}

func checkWETHBalance(rpcEndpoint, walletAddr string) CheckResult {
        const wethAddr = "0x4200000000000000000000000000000000000006"

        // balanceOf(address) = 0x70a08231 + address padded to 32 bytes
        addr := walletAddr
        if len(addr) >= 2 && addr[:2] == "0x" {
                addr = addr[2:]
        }
        for len(addr) < 64 {
                addr = "0" + addr
        }
        data := "0x70a08231" + addr

        payload := fmt.Sprintf(`{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"%s","data":"%s"},"latest"],"id":1}`, wethAddr, data)
        start := time.Now()
        ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
        defer cancel()
        req, err := http.NewRequestWithContext(ctx, http.MethodPost, rpcEndpoint, bytes.NewBufferString(payload))
        if err != nil {
                return CheckResult{Name: "WETH Balance", Status: "error", Message: err.Error()}
        }
        req.Header.Set("Content-Type", "application/json")
        resp, err := httpClient.Do(req)
        lat := time.Since(start).Milliseconds()
        if err != nil {
                return CheckResult{Name: "WETH Balance", Status: "error", Message: err.Error(), Latency: lat}
        }
        defer resp.Body.Close()
        var result struct {
                Result string `json:"result"`
        }
        json.NewDecoder(resp.Body).Decode(&result)
        if result.Result == "" || result.Result == "0x" {
                return CheckResult{Name: "WETH Balance", Status: "error", Message: "Could not fetch balance", Latency: lat}
        }
        // Parse hex balance (18 decimals)
        hexVal := result.Result
        if len(hexVal) > 2 {
                hexVal = hexVal[2:]
        }
        var balance float64
        for _, c := range hexVal {
                v := 0
                if c >= '0' && c <= '9' {
                        v = int(c - '0')
                } else if c >= 'a' && c <= 'f' {
                        v = int(c-'a') + 10
                } else if c >= 'A' && c <= 'F' {
                        v = int(c-'A') + 10
                }
                balance = balance*16 + float64(v)
        }
        balanceWETH := balance / 1e18
        status := "ok"
        msg := fmt.Sprintf("%.6f WETH", balanceWETH)
        if balanceWETH == 0 {
                status = "warning"
                msg = "0 WETH — top up wallet before live trading"
        }
        return CheckResult{Name: "WETH Balance", Status: status, Message: msg, Latency: lat}
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
