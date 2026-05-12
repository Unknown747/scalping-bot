package config

import (
        "encoding/json"
        "fmt"
        "os"
)

type BotConfig struct {
        Name        string `json:"name"`
        Version     string `json:"version"`
        Network     string `json:"network"`
        ChainID     int    `json:"chain_id"`
        LogLevel    string `json:"log_level"`
        Environment string `json:"environment"`
}

type RPCConfig struct {
        PrimaryEndpoints        []string `json:"primary_endpoints"`
        BackupEndpoints         []string `json:"backup_endpoints"`
        WebsocketEndpoints      []string `json:"websocket_endpoints"`
        HealthCheckIntervalSecs int      `json:"health_check_interval_seconds"`
        FailoverEnabled         bool     `json:"failover_enabled"`
        MaxRetriesPerRequest    int      `json:"max_retries_per_request"`
        RequestTimeoutSecs      int      `json:"request_timeout_seconds"`
}

type TradingConfig struct {
        PositionSizeUSD     float64 `json:"position_size_usd"`
        MaxConcurrentPos    int     `json:"max_concurrent_positions"`
        MaxDailyTrades      int     `json:"max_daily_trades"`
        SlippagePct         float64 `json:"slippage_tolerance_percent"`
        MaxGasPriceGwei     float64 `json:"max_gas_price_gwei"`
        GasPriceMultiplier  float64 `json:"gas_price_multiplier"`
        AutoCompound        bool    `json:"auto_compound_profits"`
        MinProfitToCompound float64 `json:"min_profit_to_compound_usd"`
}

type AIProviderConfig struct {
        Enabled        bool    `json:"enabled"`
        Model          string  `json:"model"`
        BaseURL        string  `json:"base_url"`
        Temperature    float64 `json:"temperature"`
        MaxTokens      int     `json:"max_tokens"`
        TimeoutSeconds int     `json:"timeout_seconds"`
        Priority       int     `json:"priority"`
}

type AIConfig struct {
        Enabled                bool               `json:"enabled"`
        UpdateIntervalSecs     int                `json:"update_interval_seconds"`
        MinConfidenceThreshold float64            `json:"min_confidence_threshold"`
        MaxDecisionTimeMs      int                `json:"max_decision_time_ms"`
        Gemini                 AIProviderConfig   `json:"gemini"`
        Groq                   AIProviderConfig   `json:"groq"`
        Huangfing              AIProviderConfig   `json:"huangfing"`
        VotingMechanism        string             `json:"voting_mechanism"`
        AIWeights              map[string]float64 `json:"ai_weights"`
}

type MEVConfig struct {
        Enabled            bool           `json:"enabled"`
        PrivateMempool     bool           `json:"private_mempool"`
        FlashbotsRelay     string         `json:"flashbots_relay"`
        BackupRelay        string         `json:"backup_relay"`
        RandomDelayMs      map[string]int `json:"random_delay_ms"`
        SandwichDetection  bool           `json:"sandwich_detection"`
        MaxSandwichRiskPct float64        `json:"max_sandwich_risk_percent"`
        FrontrunDetection  bool           `json:"frontrun_detection"`
        MinerTipGwei       float64        `json:"miner_tip_gwei"`
        UseMEVBoost        bool           `json:"use_mev_boost"`
}

type TokenFilters struct {
        MinLiquidityUSD float64 `json:"min_liquidity_usd"`
        MinAgeSecs      int     `json:"min_age_seconds"`
        MaxAgeSecs      int     `json:"max_age_seconds"`
        MinVolume24hUSD float64 `json:"min_volume_24h_usd"`
        MaxPriceUSD     float64 `json:"max_price_usd"`
        ExcludeHoneypot bool    `json:"exclude_honeypot"`
        ExcludeMintable bool    `json:"exclude_mintable"`
        MinTxCount5m    int     `json:"min_tx_count_5m"`
        MinBuySellRatio float64 `json:"min_buy_sell_ratio"`
        MaxBuySellRatio float64 `json:"max_buy_sell_ratio"`
}

type MonitoringConfig struct {
        DataSource           string       `json:"data_source"`
        FallbackSource       string       `json:"fallback_source"`
        PollIntervalSecs     int          `json:"poll_interval_seconds"`
        WsReconnectDelaySecs int          `json:"websocket_reconnect_delay_seconds"`
        TokenFilters         TokenFilters `json:"token_filters"`
        PairsToWatch         []string     `json:"pairs_to_watch"`
        BlacklistedTokens    []string     `json:"blacklisted_tokens"`
        WhitelistedTokens    []string     `json:"whitelisted_tokens"`
}

type CircuitBreaker struct {
        Enabled                    bool `json:"enabled"`
        ConsecutiveLossesThreshold int  `json:"consecutive_losses_threshold"`
        PauseMinutes               int  `json:"pause_minutes"`
}

type RiskConfig struct {
        MaxDailyLossUSD float64        `json:"max_daily_loss_usd"`
        MaxDrawdownPct  float64        `json:"max_drawdown_percent"`
        CircuitBreaker  CircuitBreaker `json:"circuit_breaker"`
}

type MomentumScalpConfig struct {
        VolumeSpikeThreshold    float64 `json:"volume_spike_threshold"`
        PriceChangeThresholdPct float64 `json:"price_change_threshold_percent"`
        LookbackCandles         int     `json:"lookback_candles"`
        TakeProfitPercent       float64 `json:"take_profit_percent"`
        StopLossPercent         float64 `json:"stop_loss_percent"`
}

type GridScalpConfig struct {
        Levels             int     `json:"levels"`
        GridSpacingPercent float64 `json:"grid_spacing_percent"`
        TakeProfitPercent  float64 `json:"take_profit_percent"`
        StopLossPercent    float64 `json:"stop_loss_percent"`
}

type TrailingStopConfig struct {
        Enabled             bool    `json:"enabled"`
        ActivationPercent   float64 `json:"activation_percent"`
        TrailingDistancePct float64 `json:"trailing_distance_percent"`
}

type ScalpingConfig struct {
        Primary           string              `json:"primary"`
        Secondary         string              `json:"secondary"`
        Momentum          MomentumScalpConfig `json:"momentum"`
        Grid              GridScalpConfig     `json:"grid"`
        TrailingStop      TrailingStopConfig  `json:"trailing_stop"`
        CooldownSecs      int                 `json:"cooldown_seconds"`
        MaxHoldingMinutes int                 `json:"max_holding_minutes"`
}

type DevFilterConfig struct {
        Enabled              bool     `json:"enabled"`
        MinTokenAgeSecs      int      `json:"min_token_age_seconds"`
        MaxSerialLaunchCount int      `json:"max_serial_launch_count"`
        BlacklistedAddresses []string `json:"blacklisted_addresses"`
}

type KellyConfig struct {
        Enabled           bool    `json:"enabled"`
        Fraction          float64 `json:"fraction"`
        MinMultiplier     float64 `json:"min_multiplier"`
        MaxMultiplier     float64 `json:"max_multiplier"`
        MinTradesRequired int     `json:"min_trades_required"`
        DrawdownDampen    bool    `json:"drawdown_dampen"`
        DrawdownMaxPct    float64 `json:"drawdown_max_pct"`
}

type Config struct {
        Bot         BotConfig        `json:"bot"`
        RPCConfig   RPCConfig        `json:"rpc_config"`
        Trading     TradingConfig    `json:"trading"`
        DexPriority []string         `json:"dex_priority"`
        AIConfig    AIConfig         `json:"ai_config"`
        MEV         MEVConfig        `json:"mev_protection"`
        Monitoring  MonitoringConfig `json:"monitoring"`
        Risk        RiskConfig       `json:"risk_management"`
        Scalping    ScalpingConfig   `json:"scalping_strategies"`
        DevFilter   DevFilterConfig  `json:"dev_filter"`
        Kelly       KellyConfig      `json:"kelly"`
}

func Load(path string) (*Config, error) {
        data, err := os.ReadFile(path)
        if err != nil {
                return nil, fmt.Errorf("failed to read config file: %w", err)
        }
        var cfg Config
        if err := json.Unmarshal(data, &cfg); err != nil {
                return nil, fmt.Errorf("failed to parse config: %w", err)
        }
        return &cfg, nil
}
