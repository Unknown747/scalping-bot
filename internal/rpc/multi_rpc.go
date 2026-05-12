package rpc

import (
        "bytes"
        "fmt"
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
        httpClient *http.Client
}

func NewMultiRPCClient(primaries, backups []string) *MultiRPCClient {
        m := &MultiRPCClient{
                primaries:  primaries,
                backups:    backups,
                healthy:    make(map[string]bool),
                latency:    make(map[string]time.Duration),
                httpClient: &http.Client{Timeout: 10 * time.Second},
        }

        for _, ep := range m.allEndpoints() {
                m.healthy[ep] = true
        }

        go m.healthChecker()
        return m
}

// allEndpoints returns a fresh slice of primaries followed by backups,
// avoiding the Go slice-aliasing bug from append(m.primaries, m.backups...).
func (m *MultiRPCClient) allEndpoints() []string {
        all := make([]string, 0, len(m.primaries)+len(m.backups))
        all = append(all, m.primaries...)
        all = append(all, m.backups...)
        return all
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
        all := m.allEndpoints()
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

        all := m.allEndpoints()
        for _, ep := range all {
                if m.healthy[ep] {
                        return ep, nil
                }
        }
        if len(all) > 0 {
                return all[0], nil
        }
        return "", fmt.Errorf("no RPC endpoints available")
}

func (m *MultiRPCClient) GetAllStatuses() []EndpointStatus {
        m.mu.RLock()
        defer m.mu.RUnlock()

        all := m.allEndpoints()
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

