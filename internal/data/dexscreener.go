package data

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	dexScreenerBase = "https://api.dexscreener.com"
	dexSearchURL    = "https://api.dexscreener.com/latest/dex/search?q=%s"
	dexTokensURL    = "https://api.dexscreener.com/latest/dex/tokens/%s"
	dexMaxAddresses = 30
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

// GetLatestTokens fetches trending Base-chain tokens via DexScreener search.
// Searches for active WETH pairs on Base, then deduplicates by token address.
func (d *DexScreenerClient) GetLatestTokens(ctx context.Context, chainID string) ([]TokenData, error) {
	// Search for WETH pairs on Base — this reliably returns active Base pairs.
	searchQuery := url.QueryEscape("WETH " + chainID)
	searchURL := fmt.Sprintf(dexSearchURL, searchQuery)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, searchURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "MemeScalperBot/2.0")

	resp, err := d.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("dexscreener search request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("dexscreener search API: HTTP %d", resp.StatusCode)
	}

	var raw struct {
		Pairs []dexPair `json:"pairs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("dexscreener search decode: %w", err)
	}

	return pairsToTokens(raw.Pairs, chainID, dexMaxAddresses)
}

type dexPair struct {
	ChainID   string `json:"chainId"`
	BaseToken struct {
		Address string `json:"address"`
		Symbol  string `json:"symbol"`
	} `json:"baseToken"`
	PriceUsd      string  `json:"priceUsd"`
	PairCreatedAt int64   `json:"pairCreatedAt"`
	Volume        struct {
		M5  float64 `json:"m5"`
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
}

func pairsToTokens(pairs []dexPair, chainID string, limit int) ([]TokenData, error) {
	// Deduplicate by token address — keep the pair with best liquidity.
	bestPair := make(map[string]dexPair)
	for _, p := range pairs {
		if !strings.EqualFold(p.ChainID, chainID) {
			continue
		}
		addr := strings.ToLower(p.BaseToken.Address)
		if prev, ok := bestPair[addr]; !ok || p.Liquidity.Usd > prev.Liquidity.Usd {
			bestPair[addr] = p
		}
		if len(bestPair) >= limit {
			break
		}
	}

	if len(bestPair) == 0 {
		return nil, fmt.Errorf("dexscreener: no valid pairs found for chain %s", chainID)
	}

	tokens := make([]TokenData, 0, len(bestPair))
	for _, p := range bestPair {
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
			Volume5m:      p.Volume.M5,
			LiquidityUSD:  p.Liquidity.Usd,
			PriceChange5m: p.PriceChange.M5,
			PriceChange1h: p.PriceChange.H1,
			TxCount5m:     p.Txns.M5.Buys + p.Txns.M5.Sells,
			Buys5m:        p.Txns.M5.Buys,
			Sells5m:       p.Txns.M5.Sells,
			AgeSeconds:    ageSecs,
		})
	}
	return tokens, nil
}
