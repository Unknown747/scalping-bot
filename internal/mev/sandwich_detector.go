package mev

import (
        "math/rand"
        "time"
)

type SandwichDetector struct {
        maxRiskPct float64
        delayMin   int
        delayMax   int
}

type MEVRisk struct {
        RiskLevel   string
        RiskPercent float64
        ShouldSkip  bool
        Reason      string
}

func NewSandwichDetector(maxRiskPct float64, delayMin, delayMax int) *SandwichDetector {
        return &SandwichDetector{
                maxRiskPct: maxRiskPct,
                delayMin:   delayMin,
                delayMax:   delayMax,
        }
}

func (s *SandwichDetector) Assess(priceImpactPct, liquidityUSD, volumeSpike float64) *MEVRisk {
        risk := &MEVRisk{}

        riskScore := 0.0

        if priceImpactPct > 1.0 {
                riskScore += priceImpactPct * 10
        }
        if liquidityUSD < 10000 {
                riskScore += 30
        } else if liquidityUSD < 50000 {
                riskScore += 15
        }
        if volumeSpike > 5.0 {
                riskScore += 20
        }

        risk.RiskPercent = riskScore
        switch {
        case riskScore >= 75:
                risk.RiskLevel = "HIGH"
                risk.ShouldSkip = true
                risk.Reason = "high sandwich risk detected"
        case riskScore >= s.maxRiskPct:
                risk.RiskLevel = "MEDIUM"
                risk.ShouldSkip = true
                risk.Reason = "sandwich risk exceeds threshold"
        case riskScore >= 15:
                risk.RiskLevel = "LOW"
                risk.ShouldSkip = false
                risk.Reason = "low risk, proceed with caution"
        default:
                risk.RiskLevel = "SAFE"
                risk.ShouldSkip = false
                risk.Reason = "safe to execute"
        }

        return risk
}

func (s *SandwichDetector) RandomDelay() {
        if s.delayMax <= s.delayMin {
                time.Sleep(time.Duration(s.delayMin) * time.Millisecond)
                return
        }
        delay := s.delayMin + rand.Intn(s.delayMax-s.delayMin+1)
        time.Sleep(time.Duration(delay) * time.Millisecond)
}

