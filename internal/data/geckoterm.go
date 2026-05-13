package data

import (
        "context"
        "encoding/json"
        "fmt"
        "net/http"
        "strings"
        "sync"
        "time"
)

const geckoBaseURL = "https://api.geckoterminal.com/api/v2"

var ErrRateLimited = fmt.Errorf("geckoterminal: rate limited (429)")

type TokenData struct {
        Address       string  `json:"address"`
        Symbol        string  `json:"symbol"`
        PriceUSD      float64 `json:"price_usd"`
        Volume24h     float64 `json:"volume_24h_usd"`
        Volume5m      float64 `json:"volume_5m_usd"`
        LiquidityUSD  float64 `json:"liquidity_usd"`
        PriceChange5m float64 `json:"price_change_5m"`
        PriceChange1h float64 `json:"price_change_1h"`
        TxCount5m     int     `json:"tx_count_5m"`
        Buys5m        int     `json:"buys_5m"`
        Sells5m       int     `json:"sells_5m"`
        AgeSeconds    int     `json:"age_seconds"`
}

type GeckoClient struct {
        http             *http.Client
        baseURL          string
        mu               sync.Mutex
        rateLimitedUntil time.Time
}

func NewGeckoClient() *GeckoClient {
        return &GeckoClient{
                http:    &http.Client{Timeout: 12 * time.Second},
                baseURL: geckoBaseURL,
        }
}

func (g *GeckoClient) IsRateLimited() bool {
        g.mu.Lock()
        defer g.mu.Unlock()
        return time.Now().Before(g.rateLimitedUntil)
}

func (g *GeckoClient) RateLimitedUntil() time.Time {
        g.mu.Lock()
        defer g.mu.Unlock()
        return g.rateLimitedUntil
}

func (g *GeckoClient) setRateLimit(d time.Duration) {
        g.mu.Lock()
        defer g.mu.Unlock()
        g.rateLimitedUntil = time.Now().Add(d)
}

type geckoPoolResponse struct {
        Data []struct {
                Attributes struct {
                        Address  string `json:"address"`
                        Name     string `json:"name"`
                        PriceUSD string `json:"base_token_price_usd"`
                        VolumeUSD struct {
                                M5  string `json:"m5"`
                                H24 string `json:"h24"`
                        } `json:"volume_usd"`
                        ReserveInUSD string `json:"reserve_in_usd"`
                        PriceChange  struct {
                                M5 string `json:"m5"`
                                H1 string `json:"h1"`
                        } `json:"price_change_percentage"`
                        Transactions struct {
                                M5 struct {
                                        Buys  int `json:"buys"`
                                        Sells int `json:"sells"`
                                } `json:"m5"`
                        } `json:"transactions"`
                        PoolCreatedAt string `json:"pool_created_at"`
                } `json:"attributes"`
                Relationships struct {
                        BaseToken struct {
                                Data struct {
                                        ID string `json:"id"`
                                } `json:"data"`
                        } `json:"base_token"`
                } `json:"relationships"`
        } `json:"data"`
}

func (g *GeckoClient) fetchPage(ctx context.Context, network string, page int) (*geckoPoolResponse, error) {
        url := fmt.Sprintf("%s/networks/%s/new_pools?include=base_token&page=%d", g.baseURL, network, page)
        req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
        if err != nil {
                return nil, err
        }
        req.Header.Set("Accept", "application/json")
        req.Header.Set("User-Agent", "MemeScalperBot/2.0 (trading-bot)")

        resp, err := g.http.Do(req)
        if err != nil {
                return nil, fmt.Errorf("gecko page %d: %w", page, err)
        }
        defer resp.Body.Close()

        if resp.StatusCode == 429 {
                return nil, ErrRateLimited
        }
        if resp.StatusCode != 200 {
                return nil, fmt.Errorf("gecko page %d: HTTP %d", page, resp.StatusCode)
        }

        var raw geckoPoolResponse
        if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
                return nil, fmt.Errorf("gecko page %d decode: %w", page, err)
        }
        return &raw, nil
}

// GetTopPools fetches pages 2–4 of new_pools sequentially with a short delay
// between each to avoid rate limiting. Page 1 contains pools < 5 min old
// (too fresh), while pages 2–4 cover the ~5 min – 1 hr window the age filter
// wants. Sequential fetching is slower than parallel but avoids the 429 burst
// that concurrent requests trigger on GeckoTerminal's free tier.
func (g *GeckoClient) GetTopPools(ctx context.Context, network string) ([]TokenData, error) {
        if g.IsRateLimited() {
                return nil, ErrRateLimited
        }

        seen := make(map[string]bool)
        var tokens []TokenData

        // Fetch pages 1-2 sequentially. Page 1 = pools < ~5 min old, page 2 = ~5–15 min old.
        // Keeping it at 2 pages avoids rate limiting on GeckoTerminal's free tier.
        for page := 1; page <= 2; page++ {
                raw, err := g.fetchPage(ctx, network, page)
                if err == ErrRateLimited {
                        g.setRateLimit(5 * time.Minute)
                        if len(tokens) == 0 {
                                return nil, ErrRateLimited
                        }
                        break
                }
                if err != nil || raw == nil {
                        break
                }

                for _, d := range raw.Data {
                        a := d.Attributes

                        tokenAddr := a.Address
                        relID := d.Relationships.BaseToken.Data.ID
                        if relID != "" {
                                if idx := strings.Index(relID, "_0x"); idx != -1 {
                                        tokenAddr = relID[idx+1:]
                                } else if parts := strings.SplitN(relID, "_", 2); len(parts) == 2 {
                                        tokenAddr = parts[1]
                                }
                        }
                        addrKey := strings.ToLower(tokenAddr)
                        if seen[addrKey] {
                                continue
                        }
                        seen[addrKey] = true

                        symbol := a.Name
                        if idx := strings.Index(symbol, " / "); idx != -1 {
                                symbol = symbol[:idx]
                        }
                        symbol = strings.TrimSpace(symbol)

                        var price, vol24h, vol5m, liq, chg5m, chg1h float64
                        fmt.Sscanf(a.PriceUSD, "%f", &price)
                        fmt.Sscanf(a.VolumeUSD.H24, "%f", &vol24h)
                        fmt.Sscanf(a.VolumeUSD.M5, "%f", &vol5m)
                        fmt.Sscanf(a.ReserveInUSD, "%f", &liq)
                        fmt.Sscanf(a.PriceChange.M5, "%f", &chg5m)
                        fmt.Sscanf(a.PriceChange.H1, "%f", &chg1h)
                        if liq < 0 {
                                liq = 0
                        }

                        ageSecs := 0
                        if a.PoolCreatedAt != "" {
                                if created, err := time.Parse(time.RFC3339, a.PoolCreatedAt); err == nil {
                                        ageSecs = int(time.Since(created).Seconds())
                                }
                        }

                        tokens = append(tokens, TokenData{
                                Address:       tokenAddr,
                                Symbol:        symbol,
                                PriceUSD:      price,
                                Volume24h:     vol24h,
                                Volume5m:      vol5m,
                                LiquidityUSD:  liq,
                                PriceChange5m: chg5m,
                                PriceChange1h: chg1h,
                                TxCount5m:     a.Transactions.M5.Buys + a.Transactions.M5.Sells,
                                Buys5m:        a.Transactions.M5.Buys,
                                Sells5m:       a.Transactions.M5.Sells,
                                AgeSeconds:    ageSecs,
                        })
                }

                // Small delay between pages to stay under the rate limit
                if page < 2 {
                        select {
                        case <-ctx.Done():
                                return tokens, nil
                        case <-time.After(300 * time.Millisecond):
                        }
                }
        }

        return tokens, nil
}

func (g *GeckoClient) GetTokenPrice(ctx context.Context, network, address string) (float64, error) {
        if g.IsRateLimited() {
                return 0, ErrRateLimited
        }
        url := fmt.Sprintf("%s/simple/networks/%s/token_price/%s", g.baseURL, network, address)
        req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
        if err != nil {
                return 0, err
        }
        req.Header.Set("Accept", "application/json")
        req.Header.Set("User-Agent", "MemeScalperBot/2.0 (trading-bot)")

        resp, err := g.http.Do(req)
        if err != nil {
                return 0, fmt.Errorf("price fetch failed: %w", err)
        }
        defer resp.Body.Close()
        if resp.StatusCode == 429 {
                g.setRateLimit(5 * time.Minute)
                return 0, ErrRateLimited
        }
        if resp.StatusCode != 200 {
                return 0, fmt.Errorf("geckoterminal price API: HTTP %d", resp.StatusCode)
        }

        var raw struct {
                Data struct {
                        Attributes struct {
                                TokenPrices map[string]string `json:"token_prices"`
                        } `json:"attributes"`
                } `json:"data"`
        }
        if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
                return 0, err
        }
        for _, v := range raw.Data.Attributes.TokenPrices {
                var price float64
                fmt.Sscanf(v, "%f", &price)
                if price > 0 {
                        return price, nil
                }
        }
        return 0, fmt.Errorf("price not found for %s", address)
}

const WETHAddressBase = "0x4200000000000000000000000000000000000006"

func (g *GeckoClient) GetWETHPrice(ctx context.Context) (float64, error) {
        return g.GetTokenPrice(ctx, "base", WETHAddressBase)
}

func (g *GeckoClient) ToMarketMap(t TokenData) map[string]interface{} {
        return map[string]interface{}{
                "symbol":          t.Symbol,
                "price_usd":       t.PriceUSD,
                "volume_24h":      t.Volume24h,
                "volume_5m":       t.Volume5m,
                "liquidity_usd":   t.LiquidityUSD,
                "price_change_5m": t.PriceChange5m,
                "price_change_1h": t.PriceChange1h,
                "tx_count_5m":     t.TxCount5m,
                "buys_5m":         t.Buys5m,
                "sells_5m":        t.Sells5m,
                "age_seconds":     t.AgeSeconds,
        }
}
