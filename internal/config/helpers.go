package config

type ScalpingStrategiesHelper struct {
	MomentumTP float64
	MomentumSL float64
	GridTP     float64
	GridSL     float64
}

func (c *Config) ScalpingStrategies() ScalpingStrategiesHelper {
	tp := c.Scalping.Momentum.TakeProfitPercent
	sl := c.Scalping.Momentum.StopLossPercent
	gtp := c.Scalping.Grid.TakeProfitPercent
	gsl := c.Scalping.Grid.StopLossPercent

	if tp == 0 {
		tp = 1.5
	}
	if sl == 0 {
		sl = 0.8
	}
	if gtp == 0 {
		gtp = 1.2
	}
	if gsl == 0 {
		gsl = 0.6
	}

	return ScalpingStrategiesHelper{
		MomentumTP: tp,
		MomentumSL: sl,
		GridTP:     gtp,
		GridSL:     gsl,
	}
}
