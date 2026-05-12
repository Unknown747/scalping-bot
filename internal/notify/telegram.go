package notify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

type TelegramBot struct {
	token   string
	chatID  string
	http    *http.Client
	enabled bool
}

type TestResult struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
	BotName string `json:"bot_name,omitempty"`
}

func NewTelegramBot() *TelegramBot {
	token := os.Getenv("TELEGRAM_BOT_TOKEN")
	chatID := os.Getenv("TELEGRAM_CHAT_ID")
	return &TelegramBot{
		token:   token,
		chatID:  chatID,
		http:    &http.Client{Timeout: 10 * time.Second},
		enabled: token != "" && chatID != "",
	}
}

func (t *TelegramBot) IsEnabled() bool {
	return t.enabled
}

func (t *TelegramBot) Test() *TestResult {
	if t.token == "" {
		return &TestResult{OK: false, Message: "TELEGRAM_BOT_TOKEN not set in .env"}
	}

	url := fmt.Sprintf("https://api.telegram.org/bot%s/getMe", t.token)
	resp, err := t.http.Get(url)
	if err != nil {
		return &TestResult{OK: false, Message: "Cannot reach Telegram API: " + err.Error()}
	}
	defer resp.Body.Close()

	var result struct {
		OK     bool `json:"ok"`
		Result struct {
			Username  string `json:"username"`
			FirstName string `json:"first_name"`
		} `json:"result"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return &TestResult{OK: false, Message: "Invalid response from Telegram"}
	}
	if !result.OK {
		return &TestResult{OK: false, Message: "Bot token invalid: " + result.Description}
	}

	botName := fmt.Sprintf("@%s (%s)", result.Result.Username, result.Result.FirstName)

	if t.chatID == "" {
		return &TestResult{OK: false, Message: "Bot token OK (" + botName + ") but TELEGRAM_CHAT_ID not set", BotName: botName}
	}

	err = t.Send("🤖 *MemeScalper AI Pro*\n✅ Telegram notification test successful!\n\n_Bot is connected and ready._")
	if err != nil {
		return &TestResult{OK: false, Message: "Token OK but failed to send message: " + err.Error(), BotName: botName}
	}

	return &TestResult{OK: true, Message: "Test message sent successfully to chat " + t.chatID, BotName: botName}
}

func (t *TelegramBot) Send(text string) error {
	if !t.enabled {
		return nil
	}

	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", t.token)
	body := map[string]interface{}{
		"chat_id":    t.chatID,
		"text":       text,
		"parse_mode": "Markdown",
	}
	data, _ := json.Marshal(body)

	resp, err := t.http.Post(url, "application/json", bytes.NewBuffer(data))
	if err != nil {
		return fmt.Errorf("telegram send error: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if !result.OK {
		return fmt.Errorf("telegram API error: %s", result.Description)
	}
	return nil
}

func (t *TelegramBot) NotifyTrade(symbol, action string, pnl, confidence float64, simMode bool) {
	if !t.enabled {
		return
	}
	mode := ""
	if simMode {
		mode = " \\[SIM\\]"
	}
	emoji := "✅"
	if pnl < 0 {
		emoji = "❌"
	}
	msg := fmt.Sprintf(
		"⚡ *MemeScalper AI Pro*%s\n%s *%s* on `%s`\nPnL: `$%.4f`\nConfidence: `%.0f%%`\n🕐 %s",
		mode, emoji, action, symbol, pnl, confidence, time.Now().Format("15:04:05"),
	)
	go t.Send(msg)
}

func (t *TelegramBot) NotifyCircuitBreaker(consecutiveLoss, pauseMinutes int) {
	if !t.enabled {
		return
	}
	msg := fmt.Sprintf(
		"⚡ *MemeScalper AI Pro*\n🚨 *Circuit Breaker Triggered!*\nConsecutive losses: `%d`\nPausing for `%d` minutes\n🕐 %s",
		consecutiveLoss, pauseMinutes, time.Now().Format("15:04:05"),
	)
	go t.Send(msg)
}

func (t *TelegramBot) NotifyBotStart(simMode bool) {
	if !t.enabled {
		return
	}
	mode := "LIVE"
	if simMode {
		mode = "SIMULATION"
	}
	msg := fmt.Sprintf("🚀 *MemeScalper AI Pro*\n▶️ Bot started in *%s* mode\n🕐 %s", mode, time.Now().Format("15:04:05"))
	go t.Send(msg)
}

func (t *TelegramBot) NotifyBotStop(stats map[string]interface{}) {
	if !t.enabled {
		return
	}
	msg := fmt.Sprintf(
		"🛑 *MemeScalper AI Pro*\n■ Bot stopped\nTrades: `%v` | PnL: `$%v`\n🕐 %s",
		stats["totalTrades"], stats["totalProfitUSD"], time.Now().Format("15:04:05"),
	)
	go t.Send(msg)
}
