package kelly

import "math"

// Config holds the Kelly Criterion tuning parameters loaded from config.json.
type Config struct {
	Enabled           bool    `json:"enabled"`
	Fraction          float64 `json:"fraction"`
	MinMultiplier     float64 `json:"min_multiplier"`
	MaxMultiplier     float64 `json:"max_multiplier"`
	MinTradesRequired int     `json:"min_trades_required"`
	DrawdownDampen    bool    `json:"drawdown_dampen"`
	DrawdownMaxPct    float64 `json:"drawdown_max_pct"`
}

// Result holds the output of the Kelly sizing calculation.
type Result struct {
	SizeUSD    float64
	Multiplier float64
	Fraction   float64
	Mode       string
}

// referenceHalfKelly is the half-Kelly fraction at neutral conditions:
// ~55% win rate, reward/risk ratio ≈ 1.875 (TP 1.5% / SL 0.8%).
// This maps to a 1.0× multiplier — the "baseline" trade size.
const referenceHalfKelly = 0.155

// compute returns the raw Kelly fraction f* = (b·p − q) / b.
// p = win probability, b = avg_win / avg_loss (reward:risk ratio).
func compute(p, b float64) float64 {
	if b <= 0 || p <= 0 || p >= 1 {
		return 0
	}
	q := 1.0 - p
	return (b*p - q) / b
}

// GetPositionSize returns the Kelly-adjusted position size and metadata.
//
//   - baseSize      — configured base position size in USD
//   - winRate       — win rate as fraction [0,1], e.g. 0.6 for 60 %
//   - avgWinPct     — average winning trade return in % (e.g. 1.5)
//   - avgLossPct    — average losing trade loss in % as a positive number (e.g. 0.8)
//   - drawdownPct   — current max drawdown in % (e.g. 12.5)
//   - tradeCount    — number of closed trades available for calibration
//   - cfg           — Kelly configuration
func GetPositionSize(
	baseSize float64,
	winRate float64,
	avgWinPct float64,
	avgLossPct float64,
	drawdownPct float64,
	tradeCount int,
	cfg Config,
) Result {
	if !cfg.Enabled {
		return Result{SizeUSD: baseSize, Multiplier: 1.0, Fraction: 0, Mode: "disabled"}
	}

	minMult := cfg.MinMultiplier
	if minMult <= 0 {
		minMult = 0.25
	}
	maxMult := cfg.MaxMultiplier
	if maxMult <= 0 {
		maxMult = 3.0
	}
	fraction := cfg.Fraction
	if fraction <= 0 {
		fraction = 0.5
	}
	minTrades := cfg.MinTradesRequired
	if minTrades <= 0 {
		minTrades = 10
	}
	ddMax := cfg.DrawdownMaxPct
	if ddMax <= 0 {
		ddMax = 20.0
	}

	// Warm-up: not enough trade history yet, use base size unchanged.
	if tradeCount < minTrades {
		return Result{
			SizeUSD:    baseSize,
			Multiplier: 1.0,
			Fraction:   0,
			Mode:       "warmup",
		}
	}

	// Reward:risk ratio b = avg_win / avg_loss.
	b := 1.0
	if avgLossPct > 0 {
		b = avgWinPct / avgLossPct
	}

	rawKelly := compute(winRate, b)

	// Negative edge: expected value is negative — trade at minimum size.
	if rawKelly <= 0 {
		size := baseSize * minMult
		return Result{SizeUSD: size, Multiplier: minMult, Fraction: rawKelly, Mode: "neg_edge"}
	}

	// Apply fractional Kelly (half-Kelly by default).
	halfKelly := rawKelly * fraction

	// Convert to a multiplier relative to the reference (neutral) conditions.
	multiplier := halfKelly / referenceHalfKelly
	multiplier = math.Round(multiplier*100) / 100

	mode := "adaptive"

	// Drawdown damping: linearly scale multiplier down toward minMult as
	// drawdown increases, reaching minMult exactly at drawdownMaxPct.
	if cfg.DrawdownDampen && drawdownPct > 0 {
		dampRatio := drawdownPct / ddMax
		if dampRatio >= 1.0 {
			// Fully drawn down: hard floor.
			multiplier = minMult
			mode = "dd_floor"
		} else {
			// Interpolate: multiplier = minMult + (raw − minMult) × (1 − dampRatio)
			dampedMult := minMult + (multiplier-minMult)*(1.0-dampRatio)
			if dampedMult < multiplier {
				multiplier = dampedMult
				mode = "dd_damped"
			}
		}
	}

	// Clamp to configured bounds.
	if multiplier < minMult {
		multiplier = minMult
		if mode == "adaptive" {
			mode = "floor"
		}
	}
	if multiplier > maxMult {
		multiplier = maxMult
		mode = "ceiling"
	}

	size := baseSize * multiplier
	// Round to 6 decimal places to avoid floating-point noise in logs.
	size = math.Round(size*1e6) / 1e6

	return Result{SizeUSD: size, Multiplier: multiplier, Fraction: rawKelly, Mode: mode}
}
