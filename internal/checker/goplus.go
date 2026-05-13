package checker

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const goPlusBaseURL = "https://api.gopluslabs.io/api/v1/token_security/8453"

type GoPlusResult struct {
	DevPercent      float64
	Top10HolderPct  float64
	SmartMoneyCount int
	BuyTax          float64
	SellTax         float64
	IsHoneypot      bool
	IsMintable      bool
	HolderCount     int
	OK              bool
	Skipped         bool
	Error           string
}

type goPlusHolder struct {
	Address    string `json:"address"`
	Percent    string `json:"percent"`
	IsContract int    `json:"is_contract"`
	Tag        string `json:"tag"`
}

type goPlusTokenData struct {
	CreatorAddress string         `json:"creator_address"`
	CreatorPercent string         `json:"creator_percent"`
	OwnerAddress   string         `json:"owner_address"`
	OwnerPercent   string         `json:"owner_percent"`
	HolderCount    string         `json:"holder_count"`
	Holders        []goPlusHolder `json:"holders"`
	BuyTax         string         `json:"buy_tax"`
	SellTax        string         `json:"sell_tax"`
	IsHoneypot     string         `json:"is_honeypot"`
	IsMintable     string         `json:"is_mintable"`
}

type goPlusResponse struct {
	Code    int                        `json:"code"`
	Message string                     `json:"message"`
	Result  map[string]goPlusTokenData `json:"result"`
}

type cachedGoPlusResult struct {
	result    GoPlusResult
	expiresAt time.Time
}

var (
	goPlusCache   = make(map[string]*cachedGoPlusResult)
	goPlusCacheMu sync.Mutex
	goPlusClient  = &http.Client{Timeout: 8 * time.Second}
	goPlusCacheTTL = 5 * time.Minute
)

func parseFloat(s string) float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return v
}

func parseInt(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return v
}

func CheckTokenSecurity(ctx context.Context, tokenAddress string) GoPlusResult {
	if strings.HasPrefix(strings.ToLower(tokenAddress), "0xsim") {
		return GoPlusResult{OK: true, Skipped: true}
	}

	addr := strings.ToLower(tokenAddress)

	goPlusCacheMu.Lock()
	if cached, ok := goPlusCache[addr]; ok && time.Now().Before(cached.expiresAt) {
		goPlusCacheMu.Unlock()
		return cached.result
	}
	goPlusCacheMu.Unlock()

	result := fetchGoPlusSecurity(ctx, addr)

	goPlusCacheMu.Lock()
	goPlusCache[addr] = &cachedGoPlusResult{
		result:    result,
		expiresAt: time.Now().Add(goPlusCacheTTL),
	}
	goPlusCacheMu.Unlock()

	return result
}

func fetchGoPlusSecurity(ctx context.Context, addr string) GoPlusResult {
	url := fmt.Sprintf("%s?contract_addresses=%s", goPlusBaseURL, addr)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return GoPlusResult{OK: false, Error: "build request: " + err.Error()}
	}
	req.Header.Set("Accept", "application/json")

	resp, err := goPlusClient.Do(req)
	if err != nil {
		return GoPlusResult{OK: false, Error: "http: " + err.Error()}
	}
	defer resp.Body.Close()

	var gpr goPlusResponse
	if err := json.NewDecoder(resp.Body).Decode(&gpr); err != nil {
		return GoPlusResult{OK: false, Error: "parse: " + err.Error()}
	}
	if gpr.Code != 1 {
		return GoPlusResult{OK: false, Error: fmt.Sprintf("GoPlus code %d: %s", gpr.Code, gpr.Message)}
	}

	td, ok := gpr.Result[addr]
	if !ok {
		for _, v := range gpr.Result {
			td = v
			ok = true
			break
		}
	}
	if !ok {
		return GoPlusResult{OK: false, Error: "token not found in GoPlus response"}
	}

	devPct := parseFloat(td.CreatorPercent) * 100
	ownerPct := parseFloat(td.OwnerPercent) * 100
	if ownerPct > devPct {
		devPct = ownerPct
	}

	var top10Pct float64
	smartMoneyCount := 0
	creatorLower := strings.ToLower(td.CreatorAddress)
	ownerLower := strings.ToLower(td.OwnerAddress)

	for i, h := range td.Holders {
		pct := parseFloat(h.Percent) * 100
		if i < 10 {
			top10Pct += pct
		}
		hAddr := strings.ToLower(h.Address)
		isDevWallet := hAddr == creatorLower || hAddr == ownerLower
		isBurnAddr := hAddr == "0x000000000000000000000000000000000000dead" ||
			hAddr == "0x0000000000000000000000000000000000000000"
		if !isDevWallet && !isBurnAddr && h.IsContract == 0 && pct > 0 {
			smartMoneyCount++
		}
	}

	return GoPlusResult{
		DevPercent:      devPct,
		Top10HolderPct:  top10Pct,
		SmartMoneyCount: smartMoneyCount,
		BuyTax:          parseFloat(td.BuyTax) * 100,
		SellTax:         parseFloat(td.SellTax) * 100,
		IsHoneypot:      td.IsHoneypot == "1",
		IsMintable:      td.IsMintable == "1",
		HolderCount:     parseInt(td.HolderCount),
		OK:              true,
	}
}

func CleanupGoPlusCache() {
	goPlusCacheMu.Lock()
	defer goPlusCacheMu.Unlock()
	now := time.Now()
	for k, v := range goPlusCache {
		if now.After(v.expiresAt) {
			delete(goPlusCache, k)
		}
	}
}
