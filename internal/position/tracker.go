package position

import (
        "sync"
        "time"
)

type Position struct {
        TokenAddress      string
        Symbol            string
        EntryPrice        float64
        CurrentPrice      float64
        SizeUSD           float64
        OrigSizeUSD       float64
        RemainFrac        float64
        WETHAmount        float64
        WETHPriceEntry    float64
        EntryTime         time.Time
        TPPrice           float64
        SLPrice           float64
        TP1Price          float64
        TP2Price          float64
        TP3Price          float64
        TP1Hit            bool
        TP2Hit            bool
        MaxHoldMins       int
        SimMode           bool
        TrailingActivated bool
        AIConfidence      float64
}

type Tracker struct {
        mu     sync.RWMutex
        open   map[string]*Position
        traded map[string]time.Time
}

func NewTracker() *Tracker {
        return &Tracker{
                open:   make(map[string]*Position),
                traded: make(map[string]time.Time),
        }
}

func (t *Tracker) Open(p *Position) {
        t.mu.Lock()
        defer t.mu.Unlock()
        if p.OrigSizeUSD == 0 {
                p.OrigSizeUSD = p.SizeUSD
        }
        if p.RemainFrac == 0 {
                p.RemainFrac = 1.0
        }
        t.open[p.TokenAddress] = p
        t.traded[p.TokenAddress] = time.Now()
}

func (t *Tracker) MarkTP1Hit(addr string) {
        t.mu.Lock()
        defer t.mu.Unlock()
        if p, ok := t.open[addr]; ok {
                p.TP1Hit = true
                p.RemainFrac = 0.75
        }
}

func (t *Tracker) MarkTP2Hit(addr string) {
        t.mu.Lock()
        defer t.mu.Unlock()
        if p, ok := t.open[addr]; ok {
                p.TP2Hit = true
                p.RemainFrac = 0.50
        }
}

func (t *Tracker) Close(addr string) (*Position, bool) {
        t.mu.Lock()
        defer t.mu.Unlock()
        p, ok := t.open[addr]
        if ok {
                delete(t.open, addr)
        }
        return p, ok
}

func (t *Tracker) UpdateCurrentPrice(addr string, price float64) {
        t.mu.Lock()
        defer t.mu.Unlock()
        if p, ok := t.open[addr]; ok {
                p.CurrentPrice = price
        }
}

// UpdateTrailingSL raises the stop-loss if newSL is higher than the current one.
// Returns (effectiveSL, firstActivation).
func (t *Tracker) UpdateTrailingSL(addr string, newSL float64) (float64, bool) {
        t.mu.Lock()
        defer t.mu.Unlock()
        p, ok := t.open[addr]
        if !ok {
                return newSL, false
        }
        if newSL > p.SLPrice {
                firstActivation := !p.TrailingActivated
                p.SLPrice = newSL
                p.TrailingActivated = true
                return newSL, firstActivation
        }
        return p.SLPrice, false
}

func (t *Tracker) AlreadyTraded(addr string) bool {
        t.mu.RLock()
        defer t.mu.RUnlock()
        _, exists := t.traded[addr]
        return exists
}

func (t *Tracker) HasOpen(addr string) bool {
        t.mu.RLock()
        defer t.mu.RUnlock()
        _, exists := t.open[addr]
        return exists
}

func (t *Tracker) GetAllOpen() []*Position {
        t.mu.RLock()
        defer t.mu.RUnlock()
        out := make([]*Position, 0, len(t.open))
        for _, p := range t.open {
                cp := *p
                out = append(out, &cp)
        }
        return out
}

func (t *Tracker) OpenCount() int {
        t.mu.RLock()
        defer t.mu.RUnlock()
        return len(t.open)
}

func (t *Tracker) CloseAll() []*Position {
        t.mu.Lock()
        defer t.mu.Unlock()
        out := make([]*Position, 0, len(t.open))
        for addr, p := range t.open {
                cp := *p
                out = append(out, &cp)
                delete(t.open, addr)
        }
        return out
}

func (t *Tracker) CleanupTraded(cutoff time.Duration) {
        t.mu.Lock()
        defer t.mu.Unlock()
        now := time.Now()
        for addr, ts := range t.traded {
                if _, open := t.open[addr]; !open {
                        if now.Sub(ts) > cutoff {
                                delete(t.traded, addr)
                        }
                }
        }
}
