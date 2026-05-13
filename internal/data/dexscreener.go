package data

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	dexScreenerBase   = "https://api.dexscreener.com"
	dexBoostsURL      = "https://api.dexscreener.com/token-boosts/latest/v1"
	dexTokensURL      = "https://api.dexscreener.com/latest/dex/tokens/%s"
	dexMaxAddresses   = 30
)

type DexScreenerClient struct {
	http    *http.Client
	baseURL string
}

func NewDexScreenerClient() *DexScreenerClient {
	return &DexScreenerClient{
		http:    &http.Client{Timeout: 12 * time.Second},
		baseURL: dexScreenerBase,
	}
}

// GetLatestTokens fetches trending Base-chain tokens via:
//  1. GET /token-boosts/latest/v1  → collect Base token addresses
//  2. GET /latest/dex/tokens/{addrs} → fetch live price/volume data
func (d *DexScreenerClient) GetLatestTokens(ctx context.Context, chainID string) ([]TokenData, error) {
	// ── Step 1: boosted token addresses for this chain ────────────────────────
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, dexBoostsURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "MemeScalperBot/2.0")

	resp, err := d.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("dexscreener boosts request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("dexscreener boosts API: HTTP %d", resp.StatusCode)
	}

	var boosts []struct {
		ChainID      string `json:"chainId"`
		TokenAddress string `json:"tokenAddress"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&boosts); err != nil {
		return nil, fmt.Errorf("dexscreener boosts decode: %w", err)
	}

	// Collect addresses for the target chain
	var addrs []string
	seen := make(map[string]bool)
	for _, b := range boosts {
		if strings.EqualFold(b.ChainID, chainID) && b.TokenAddress != "" && !seen[b.TokenAddress] {
			addrs = append(addrs, b.TokenAddress)
			seen[b.TokenAddress] = true
			if len(addrs) >= dexMaxAddresses {
				break
			}
		}
	}
	if len(addrs) == 0 {
		return nil, fmt.Errorf("dexscreener: no boosted tokens found for chain %s", chainID)
	}

	// ── Step 2: fetch live data for those addresses ───────────────────────────
	tokenURL := fmt.Sprintf(dexTokensURL, strings.Join(addrs, ","))
	req2, err := http.NewRequestWithContext(ctx, http.MethodGet, tokenURL, nil)
	if err != nil {
		return nil, err
	}
	req2.Header.Set("Accept", "application/json")
	req2.Header.Set("User-Agent", "MemeScalperBot/2.0")

	resp2, err := d.http.Do(req2)
	if err != nil {
		return nil, fmt.Errorf("dexscreener tokens request failed: %w", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != 200 {
		return nil, fmt.Errorf("dexscreener tokens API: HTTP %d", resp2.StatusCode)
	}

	var raw struct {
		Pairs []struct {
			ChainID   string `json:"chainId"`
			BaseToken struct {
				Address string `json:"address"`
				Symbol  string `json:"symbol"`
			} `json:"baseToken"`
			PriceUsd      string  `json:"priceUsd"`
			PairCreatedAt int64   `json:"pairCreatedAt"`
			Volume        struct {
				H24 float64 `json:"h24"`
			} `json:"volume"`
			Liquidity struct {
				Usd float64 `json:"usd"`
			} `json:"liquidity"`
			PriceChange struct {
				M5 float64 `json:"m5"`
				H1 float64 `json:"h1"`
			} `json:"priceChange"`
			Txns struct {
				M5 struct {
					Buys  int `json:"buys"`
					Sells int `json:"sells"`
				} `json:"m5"`
			} `json:"txns"`
		} `json:"pairs"`
	}

	if err := json.NewDecoder(resp2.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("dexscreener tokens decode: %w", err)
	}

	// Deduplicate by token address (keep best liquidity pair per token)
	bestPair := make(map[string]int) // address → index in raw.Pairs
	for i, p := range raw.Pairs {
		if !strings.EqualFold(p.ChainID, chainID) {
			continue
		}
		addr := strings.ToLower(p.BaseToken.Address)
		if prev, ok := bestPair[addr]; !ok || p.Liquidity.Usd > raw.Pairs[prev].Liquidity.Usd {
			bestPair[addr] = i
		}
	}

	tokens := make([]TokenData, 0, len(bestPair))
	for _, i := range bestPair {
		p := raw.Pairs[i]
		price, _ := strconv.ParseFloat(p.PriceUsd, 64)

		ageSecs := 0
		if p.PairCreatedAt > 0 {
			created := time.UnixMilli(p.PairCreatedAt)
			ageSecs = int(time.Since(created).Seconds())
		}

		tokens = append(tokens, TokenData{
			Address:       p.BaseToken.Address,
			Symbol:        p.BaseToken.Symbol,
			PriceUSD:      price,
			Volume24h:     p.Volume.H24,
			LiquidityUSD:  p.Liquidity.Usd,
			PriceChange5m: p.PriceChange.M5,
			PriceChange1h: p.PriceChange.H1,
			TxCount5m:     p.Txns.M5.Buys + p.Txns.M5.Sells,
			Buys5m:        p.Txns.M5.Buys,
			Sells5m:       p.Txns.M5.Sells,
			AgeSeconds:    ageSecs,
		})
	}

	if len(tokens) == 0 {
		return nil, fmt.Errorf("dexscreener: no valid pairs returned for chain %s", chainID)
	}
	return tokens, nil
}
