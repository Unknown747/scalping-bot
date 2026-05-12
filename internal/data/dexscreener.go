package data

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

const dexScreenerBaseURL = "https://api.dexscreener.com/latest"

type DexScreenerClient struct {
	http    *http.Client
	baseURL string
}

func NewDexScreenerClient() *DexScreenerClient {
	return &DexScreenerClient{
		http:    &http.Client{Timeout: 10 * time.Second},
		baseURL: dexScreenerBaseURL,
	}
}

func (d *DexScreenerClient) GetLatestTokens(ctx context.Context, chainID string) ([]TokenData, error) {
	url := fmt.Sprintf("%s/dex/tokens/%s", d.baseURL, chainID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := d.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("dexscreener request failed: %w", err)
	}
	defer resp.Body.Close()

	var raw struct {
		Pairs []struct {
			BaseToken struct {
				Address string `json:"address"`
				Symbol  string `json:"symbol"`
			} `json:"baseToken"`
			PriceUsd  string `json:"priceUsd"`
			Volume    struct {
				H24 float64 `json:"h24"`
			} `json:"volume"`
			Liquidity struct {
				Usd float64 `json:"usd"`
			} `json:"liquidity"`
			PriceChange struct {
				M5  float64 `json:"m5"`
				H1  float64 `json:"h1"`
			} `json:"priceChange"`
			Txns struct {
				M5 struct {
					Buys  int `json:"buys"`
					Sells int `json:"sells"`
				} `json:"m5"`
			} `json:"txns"`
		} `json:"pairs"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}

	tokens := make([]TokenData, 0, len(raw.Pairs))
	for _, p := range raw.Pairs {
		price, _ := strconv.ParseFloat(p.PriceUsd, 64)
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
		})
	}
	return tokens, nil
}
