package rpc

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"sync"
	"time"
)

type EndpointStatus struct {
	URL     string
	Healthy bool
	Latency time.Duration
}

type MultiRPCClient struct {
	primaries  []string
	backups    []string
	mu         sync.RWMutex
	healthy    map[string]bool
	latency    map[string]time.Duration
	currentIdx int
	httpClient *http.Client
}

func NewMultiRPCClient(primaries, backups []string) *MultiRPCClient {
	m := &MultiRPCClient{
		primaries:  primaries,
		backups:    backups,
		healthy:    make(map[string]bool),
		latency:    make(map[string]time.Duration),
		currentIdx: 0,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}

	all := append(primaries, backups...)
	for _, ep := range all {
		m.healthy[ep] = true
	}

	go m.healthChecker()
	return m
}

func (m *MultiRPCClient) checkEndpoint(endpoint string) (bool, time.Duration) {
	payload := `{"jsonrpc":"2.0","method":"net_listening","params":[],"id":1}`
	start := time.Now()
	resp, err := m.httpClient.Post(endpoint, "application/json", bytes.NewBufferString(payload))
	elapsed := time.Since(start)
	if err != nil {
		return false, 0
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK, elapsed
}

func (m *MultiRPCClient) healthChecker() {
	ticker := time.NewTicker(30 * time.Second)
	m.checkAll()
	for range ticker.C {
		m.checkAll()
	}
}

func (m *MultiRPCClient) checkAll() {
	all := append(m.primaries, m.backups...)
	var wg sync.WaitGroup
	for _, ep := range all {
		wg.Add(1)
		go func(endpoint string) {
			defer wg.Done()
			ok, lat := m.checkEndpoint(endpoint)
			m.mu.Lock()
			m.healthy[endpoint] = ok
			m.latency[endpoint] = lat
			m.mu.Unlock()
		}(ep)
	}
	wg.Wait()
}

func (m *MultiRPCClient) GetActiveEndpoint() (string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	all := append(m.primaries, m.backups...)
	for i := 0; i < len(all); i++ {
		idx := (m.currentIdx + i) % len(all)
		ep := all[idx]
		if m.healthy[ep] {
			return ep, nil
		}
	}
	if len(all) > 0 {
		return all[0], nil
	}
	return "", fmt.Errorf("no RPC endpoints available")
}

func (m *MultiRPCClient) GetRandomHealthyEndpoint() string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	all := append(m.primaries, m.backups...)
	var healthy []string
	for _, ep := range all {
		if m.healthy[ep] {
			healthy = append(healthy, ep)
		}
	}
	if len(healthy) == 0 {
		return all[0]
	}
	return healthy[rand.Intn(len(healthy))]
}

func (m *MultiRPCClient) Call(ctx context.Context, method string, params interface{}) (json.RawMessage, error) {
	endpoint, err := m.GetActiveEndpoint()
	if err != nil {
		return nil, err
	}

	reqBody := map[string]interface{}{
		"jsonrpc": "2.0",
		"method":  method,
		"params":  params,
		"id":      1,
	}
	data, _ := json.Marshal(reqBody)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewBuffer(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := m.httpClient.Do(req)
	if err != nil {
		m.mu.Lock()
		m.healthy[endpoint] = false
		m.mu.Unlock()
		return nil, fmt.Errorf("RPC call failed: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if result.Error != nil {
		return nil, fmt.Errorf("RPC error: %s", result.Error.Message)
	}
	return result.Result, nil
}

func (m *MultiRPCClient) GetAllStatuses() []EndpointStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()

	all := append(m.primaries, m.backups...)
	statuses := make([]EndpointStatus, 0, len(all))
	for _, ep := range all {
		statuses = append(statuses, EndpointStatus{
			URL:     ep,
			Healthy: m.healthy[ep],
			Latency: m.latency[ep],
		})
	}
	return statuses
}

func (m *MultiRPCClient) GetGasPrice(ctx context.Context) (float64, error) {
	result, err := m.Call(ctx, "eth_gasPrice", []interface{}{})
	if err != nil {
		return 0, err
	}

	var hexPrice string
	if err := json.Unmarshal(result, &hexPrice); err != nil {
		return 0, err
	}

	var price int64
	fmt.Sscanf(hexPrice, "0x%x", &price)
	gwei := float64(price) / 1e9
	return gwei, nil
}
