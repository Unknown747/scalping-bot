package data

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const geckoBaseURL = "https://api.geckoterminal.com/api/v2"

type TokenData struct {
	Address       string  `json:"address"`
	Symbol        string  `json:"symbol"`
	PriceUSD      float64 `json:"price_usd"`
	Volume24h     float64 `json:"volume_24h_usd"`
	LiquidityUSD  float64 `json:"liquidity_usd"`
	PriceChange5m float64 `json:"price_change_5m"`
	PriceChange1h float64 `json:"price_change_1h"`
	TxCount5m     int     `json:"tx_count_5m"`
	Buys5m        int     `json:"buys_5m"`
	Sells5m       int     `json:"sells_5m"`
}

type GeckoClient struct {
	http    *http.Client
	baseURL string
}

func NewGeckoClient() *GeckoClient {
	return &GeckoClient{
		http:    &http.Client{Timeout: 10 * time.Second},
		baseURL: geckoBaseURL,
	}
}

func (g *GeckoClient) GetTopPools(ctx context.Context, network string) ([]TokenData, error) {
	url := fmt.Sprintf("%s/networks/%s/trending_pools?include=base_token&page=1", g.baseURL, network)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := g.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gecko request failed: %w", err)
	}
	defer resp.Body.Close()

	var raw struct {
		Data []struct {
			Attributes struct {
				Address       string `json:"address"`
				BaseTokenSymbol string `json:"name"`
				PriceUSD      string `json:"base_token_price_usd"`
				VolumeUSD     struct {
					H24 string `json:"h24"`
				} `json:"volume_usd"`
				ReserveInUSD  string `json:"reserve_in_usd"`
				PriceChange   struct {
					M5  string `json:"m5"`
					H1  string `json:"h1"`
				} `json:"price_change_percentage"`
				Transactions struct {
					M5 struct {
						Buys  int `json:"buys"`
						Sells int `json:"sells"`
					} `json:"m5"`
				} `json:"transactions"`
			} `json:"attributes"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}

	tokens := make([]TokenData, 0, len(raw.Data))
	for _, d := range raw.Data {
		a := d.Attributes
		var price, vol, liq, chg5m, chg1h float64
		fmt.Sscanf(a.PriceUSD, "%f", &price)
		fmt.Sscanf(a.VolumeUSD.H24, "%f", &vol)
		fmt.Sscanf(a.ReserveInUSD, "%f", &liq)
		fmt.Sscanf(a.PriceChange.M5, "%f", &chg5m)
		fmt.Sscanf(a.PriceChange.H1, "%f", &chg1h)

		tokens = append(tokens, TokenData{
			Address:       a.Address,
			Symbol:        a.BaseTokenSymbol,
			PriceUSD:      price,
			Volume24h:     vol,
			LiquidityUSD:  liq,
			PriceChange5m: chg5m,
			PriceChange1h: chg1h,
			TxCount5m:     a.Transactions.M5.Buys + a.Transactions.M5.Sells,
			Buys5m:        a.Transactions.M5.Buys,
			Sells5m:       a.Transactions.M5.Sells,
		})
	}
	return tokens, nil
}

func (g *GeckoClient) ToMarketMap(t TokenData) map[string]interface{} {
	return map[string]interface{}{
		"symbol":         t.Symbol,
		"price_usd":      t.PriceUSD,
		"volume_24h":     t.Volume24h,
		"liquidity_usd":  t.LiquidityUSD,
		"price_change_5m": t.PriceChange5m,
		"price_change_1h": t.PriceChange1h,
		"tx_count_5m":    t.TxCount5m,
		"buys_5m":        t.Buys5m,
		"sells_5m":       t.Sells5m,
	}
}
