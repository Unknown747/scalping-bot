export interface ScalpingConfigData {
  totalCapitalEth: number;
  maxTradeAmountEth: number;
  maxConcurrentPositions: number;
  minPositionEth: number;
  min5mVolumeUsd: number;
  minLiquidityUsd: number;
  maxTokenAgeMinutes: number;
  minMomentumPercent: number;
  tp1Percent: number;
  tp1SellPercent: number;
  tp2Percent: number;
  tp2SellPercent: number;
  tp3Percent: number;
  tp3SellPercent: number;
  stopLossPercent: number;
  trailingStopActivatePercent: number;
  trailingStopDistancePercent: number;
  maxHoldMinutes: number;
  maxDailyLossEth: number;
  cooldownMinutesAfterLoss: number;
  maxSlippagePercent: number;
  maxPriorityFeeGwei: number;
  maxFeePerGasGwei: number;
  minSafetyScore: number;
  maxSellTaxPercent: number;
  scanIntervalSeconds: number;
  priceCheckIntervalSeconds: number;
  riskLevel: "conservative" | "moderate" | "aggressive";
  mode: "live" | "paper";
}

export const DEFAULT_CONFIG: ScalpingConfigData = {
  totalCapitalEth: 0.04,
  maxTradeAmountEth: 0.002,
  maxConcurrentPositions: 3,
  minPositionEth: 0.001,
  min5mVolumeUsd: 5000,
  minLiquidityUsd: 10000,
  maxTokenAgeMinutes: 30,
  minMomentumPercent: 15,
  tp1Percent: 3,
  tp1SellPercent: 50,
  tp2Percent: 6,
  tp2SellPercent: 30,
  tp3Percent: 10,
  tp3SellPercent: 20,
  stopLossPercent: 5,
  trailingStopActivatePercent: 4,
  trailingStopDistancePercent: 2,
  maxHoldMinutes: 15,
  maxDailyLossEth: 0.003,
  cooldownMinutesAfterLoss: 120,
  maxSlippagePercent: 5,
  maxPriorityFeeGwei: 0.002,
  maxFeePerGasGwei: 0.02,
  minSafetyScore: 70,
  maxSellTaxPercent: 10,
  scanIntervalSeconds: 8,
  priceCheckIntervalSeconds: 2,
  riskLevel: "conservative",
  mode: "paper",
};

// Risk level presets
export const RISK_PRESETS: Record<string, Partial<ScalpingConfigData>> = {
  conservative: {
    maxTradeAmountEth: 0.001,
    maxConcurrentPositions: 2,
    minMomentumPercent: 20,
    minSafetyScore: 75,
    stopLossPercent: 4,
    tp1Percent: 3,
    tp2Percent: 6,
    tp3Percent: 10,
    maxHoldMinutes: 10,
  },
  moderate: {
    maxTradeAmountEth: 0.002,
    maxConcurrentPositions: 3,
    minMomentumPercent: 15,
    minSafetyScore: 70,
    stopLossPercent: 5,
    tp1Percent: 3,
    tp2Percent: 6,
    tp3Percent: 10,
    maxHoldMinutes: 15,
  },
  aggressive: {
    maxTradeAmountEth: 0.003,
    maxConcurrentPositions: 4,
    minMomentumPercent: 10,
    minSafetyScore: 60,
    stopLossPercent: 7,
    tp1Percent: 5,
    tp2Percent: 10,
    tp3Percent: 15,
    maxHoldMinutes: 20,
  },
};

// Base network contract addresses
export const BASE_CONTRACTS = {
  WETH: "0x4200000000000000000000000000000000000006",
  UNISWAP_V3_ROUTER: "0x2626664c2603336E57B271c5C0b26F421741e481",
  UNISWAP_V3_FACTORY: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
  UNISWAP_V3_QUOTER: "0x3d4e44Eb1374240CE5F1B136041212501e4a0439",
} as const;
