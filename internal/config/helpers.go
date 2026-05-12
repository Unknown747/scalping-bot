package config

type ScalpingStrategiesHelper struct {
	MomentumTP float64
	MomentumSL float64
	GridTP     float64
	GridSL     float64
}

func (c *Config) ScalpingStrategies() ScalpingStrategiesHelper {
	return ScalpingStrategiesHelper{
		MomentumTP: 2.0,
		MomentumSL: 1.0,
		GridTP:     1.5,
		GridSL:     0.8,
	}
}
