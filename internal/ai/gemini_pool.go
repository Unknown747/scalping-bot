package ai

import (
        "fmt"
        "log"
        "os"
        "strings"
        "sync"
        "time"
)

// rateLimitEntry tracks cooldown state for a single API key.
type rateLimitEntry struct {
        cooldownUntil time.Time
        hitCount      int
}

// GeminiKeyPool manages multiple Gemini API keys with round-robin rotation
// and per-key rate-limit cooldown tracking.
//
// Keys are loaded from:
//   - GEMINI_API_KEY        (comma-separated list OR single key)
//   - GEMINI_API_KEY_2 … GEMINI_API_KEY_9  (individual extras)
//
// When a key returns HTTP 429 it is put into cooldown for `cooldown` duration.
// NextAvailableKey() skips cooling-down keys and returns the next ready one.
// If all keys are cooling down, it returns ("", 0) — the caller should fall
// back to Groq / Huangfing.
type GeminiKeyPool struct {
        mu       sync.Mutex
        keys     []string
        current  int // round-robin cursor
        limited  map[string]*rateLimitEntry
        cooldown time.Duration
}

// newGeminiKeyPool loads all Gemini API keys and creates the pool.
// cooldown is how long a key is suspended after a 429 response.
func newGeminiKeyPool(cooldown time.Duration) *GeminiKeyPool {
        seen := make(map[string]bool)
        var keys []string

        addKey := func(raw string) {
                k := strings.TrimSpace(raw)
                if k != "" && !seen[k] {
                        seen[k] = true
                        keys = append(keys, k)
                }
        }

        // Primary var — supports comma-separated list for easy multi-key setup
        for _, part := range strings.Split(os.Getenv("GEMINI_API_KEY"), ",") {
                addKey(part)
        }
        // Indexed extras: GEMINI_API_KEY_2 … GEMINI_API_KEY_9
        for i := 2; i <= 9; i++ {
                addKey(os.Getenv(fmt.Sprintf("GEMINI_API_KEY_%d", i)))
        }

        if len(keys) > 0 {
                log.Printf("🔑 Gemini key pool: %d key(s) loaded", len(keys))
        }

        return &GeminiKeyPool{
                keys:     keys,
                limited:  make(map[string]*rateLimitEntry),
                cooldown: cooldown,
        }
}

// Size returns the total number of configured keys (zero = none set).
func (p *GeminiKeyPool) Size() int {
        p.mu.Lock()
        defer p.mu.Unlock()
        return len(p.keys)
}

// NextAvailableKey returns the next non-rate-limited key and its 1-based
// position in the pool, or ("", 0) when every key is currently cooling down.
func (p *GeminiKeyPool) NextAvailableKey() (key string, keyNum int) {
        p.mu.Lock()
        defer p.mu.Unlock()

        n := len(p.keys)
        for attempt := 0; attempt < n; attempt++ {
                idx := (p.current + attempt) % n
                k := p.keys[idx]
                if rl, ok := p.limited[k]; ok && time.Now().Before(rl.cooldownUntil) {
                        continue // key still in cooldown
                }
                p.current = (idx + 1) % n
                return k, idx + 1
        }
        return "", 0
}

// MarkRateLimited applies a cooldown to the given key after a 429 response.
func (p *GeminiKeyPool) MarkRateLimited(key string) {
        p.mu.Lock()
        defer p.mu.Unlock()

        rl, ok := p.limited[key]
        if !ok {
                rl = &rateLimitEntry{}
                p.limited[key] = rl
        }
        rl.hitCount++
        rl.cooldownUntil = time.Now().Add(p.cooldown)

        for i, k := range p.keys {
                if k == key {
                        log.Printf("⚠️  Gemini key #%d rate-limited — cooldown %s (hit #%d total)", i+1, p.cooldown, rl.hitCount)
                        return
                }
        }
}

// AvailableCount returns how many keys are currently ready (not cooling down).
func (p *GeminiKeyPool) AvailableCount() int {
        p.mu.Lock()
        defer p.mu.Unlock()
        n := 0
        for _, k := range p.keys {
                if rl, ok := p.limited[k]; !ok || time.Now().After(rl.cooldownUntil) {
                        n++
                }
        }
        return n
}

// Status returns a map keyed by "key#N" with value "ok" or "limited(Xs)".
// Actual key values are never exposed — only their 1-based index.
func (p *GeminiKeyPool) Status() map[string]string {
        p.mu.Lock()
        defer p.mu.Unlock()

        out := make(map[string]string, len(p.keys))
        for i, k := range p.keys {
                label := fmt.Sprintf("key#%d", i+1)
                if rl, ok := p.limited[k]; ok && time.Now().Before(rl.cooldownUntil) {
                        out[label] = fmt.Sprintf("limited(%ds)", int(time.Until(rl.cooldownUntil).Seconds()))
                } else {
                        out[label] = "ok"
                }
        }
        return out
}

// KeyStat holds detailed per-key stats for the dashboard.
type KeyStat struct {
        Label        string `json:"label"`         // "key#1", "key#2", …
        Status       string `json:"status"`        // "ok" | "limited"
        CooldownSecs int    `json:"cooldown_secs"` // seconds remaining (0 if ok)
        HitCount     int    `json:"hit_count"`     // total 429s received
        LastThrottle string `json:"last_throttle"` // "never" or "HH:MM:SS DD/MM"
}

// DetailedStats returns per-key stats suitable for the System tab table.
// Actual key values are never exposed.
func (p *GeminiKeyPool) DetailedStats() []KeyStat {
        p.mu.Lock()
        defer p.mu.Unlock()

        out := make([]KeyStat, len(p.keys))
        now := time.Now()
        for i, k := range p.keys {
                stat := KeyStat{
                        Label:        fmt.Sprintf("key#%d", i+1),
                        Status:       "ok",
                        LastThrottle: "never",
                }
                if rl, ok := p.limited[k]; ok {
                        stat.HitCount = rl.hitCount
                        if rl.hitCount > 0 {
                                // cooldownUntil - cooldown = when the last 429 happened
                                lastHit := rl.cooldownUntil.Add(-p.cooldown)
                                stat.LastThrottle = lastHit.Format("15:04:05 02/01")
                        }
                        if now.Before(rl.cooldownUntil) {
                                stat.Status = "limited"
                                stat.CooldownSecs = int(rl.cooldownUntil.Sub(now).Seconds())
                        }
                }
                out[i] = stat
        }
        return out
}
