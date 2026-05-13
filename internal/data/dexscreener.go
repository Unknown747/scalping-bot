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
	dexScreenerBase  = "https://api.dexscreener.com"
	dexTokensURL     = "https://api.dexscreener.com/latest/dex/tokens/%s"
	dexBoostsURL     = "https://api.dexscreener.com/token-boosts/latest/v1"
	dexSearchURL     = "https://api.dexscreener.com/latest/dex/search?q=base"
	dexMaxAddresses  = 30
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

// GetLatestTokens tries two DexScreener strategies to find REAL new meme tokens on Base:
//  1. token-boosts/latest/v1 → lists recently boosted tokens (people pay to boost new tokens)
//  2. search?q=base as secondary fallback
//
// This replaces the old "known stable addresses" approach which only returned WETH/AERO.
func (d *DexScreenerClient) GetLatestTokens(ctx context.Context, chainID string) ([]TokenData, error) {
	// Strategy 1: token boosts — new meme tokens pay to appear here
	tokens, err := d.getFromBoosts(ctx, chainID)
	if err == nil && len(tokens) > 0 {
		return tokens, nil
	}

	// Strategy 2: search by chain to get recently active pairs
	tokens, err = d.getFromSearch(ctx, chainID)
	if err == nil && len(tokens) > 0 {
		return tokens, nil
	}

	return nil, fmt.Errorf("dexscreener: all strategies failed (boosts: %v)", err)
}

// getFromBoosts calls the /token-boosts/latest/v1 endpoint, collects Base token
// addresses from the result, and enriches them with pair data.
func (d *DexScreenerClient) getFromBoosts(ctx context.Context, chainID string) ([]TokenData, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, dexBoostsURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "MemeScalperBot/2.0")

	resp, err := d.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("dexscreener boosts request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("dexscreener boosts API: HTTP %d", resp.StatusCode)
	}

	var raw []struct {
		URL          string `json:"url"`
		ChainID      string `json:"chainId"`
		TokenAddress string `json:"tokenAddress"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("dexscreener boosts decode: %w", err)
	}

	// Collect Base chain token addresses
	var addrs []string
	seen := make(map[string]bool)
	for _, b := range raw {
		if !strings.EqualFold(b.ChainID, chainID) {
			continue
		}
		addr := strings.ToLower(b.TokenAddress)
		if addr == "" || seen[addr] {
			continue
		}
		seen[addr] = true
		addrs = append(addrs, b.TokenAddress)
		if len(addrs) >= dexMaxAddresses {
			break
		}
	}
	if len(addrs) == 0 {
		return nil, fmt.Errorf("dexscreener boosts: no Base tokens found")
	}

	// Fetch pair data for these addresses (batch, max 30)
	batchURL := fmt.Sprintf(dexTokensURL, strings.Join(addrs, ","))
	return d.fetchPairData(ctx, batchURL, chainID)
}

// getFromSearch calls the DexScreener search endpoint filtered to Base.
func (d *DexScreenerClient) getFromSearch(ctx context.Context, chainID string) ([]TokenData, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, dexSearchURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "MemeScalperBot/2.0")

	resp, err := d.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("dexscreener search request: %w", err)
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

	tokens, err := pairsToTokens(raw.Pairs, chainID, dexMaxAddresses)
	if err != nil {
		return nil, err
	}
	return tokens, nil
}

// fetchPairData fetches pair details from a DexScreener batch URL.
func (d *DexScreenerClient) fetchPairData(ctx context.Context, url, chainID string) ([]TokenData, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "MemeScalperBot/2.0")

	resp, err := d.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("dexscreener tokens request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("dexscreener tokens API: HTTP %d", resp.StatusCode)
	}

	var raw struct {
		Pairs []dexPair `json:"pairs"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("dexscreener tokens decode: %w", err)
	}

	return pairsToTokens(raw.Pairs, chainID, dexMaxAddresses)
}

type dexPair struct {
	ChainID   string `json:"chainId"`
	BaseToken struct {
		Address string `json:"address"`
		Symbol  string `json:"symbol"`
	} `json:"baseToken"`
	PriceUsd      string `json:"priceUsd"`
	PairCreatedAt int64  `json:"pairCreatedAt"`
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
