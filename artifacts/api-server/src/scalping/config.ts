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

  // Feature: Meme Score Filter
  minMemeScore: number;
  enableMemeScore: boolean;

  // Feature: TWAP Execution
  enableTWAP: boolean;
  twapSlices: number;
  twapIntervalMs: number;

  // Feature: Dynamic Slippage
  enableDynamicSlippage: boolean;

  // Feature: Multi-DEX Router
  enableMultiDEX: boolean;

  // Feature: Cooldown & Anti-FOMO
  cooldownAfterCloseSeconds: number;
  maxBuysPerFiveMinutes: number;

  // Feature: Force Exit (Peak Profit Tracking)
  enablePeakProfitExit: boolean;
  peakProfitDropPercent: number;

  // Feature: Telegram Alert
  enableTelegram: boolean;
  telegramBotToken: string;
  telegramChatId: string;

  // Feature: Deployer Reputation Check
  enableDeployerCheck: boolean;
  maxDeployerTokens24h: number;

  // Feature: Auto-Compounding
  enableAutoCompound: boolean;
  compoundThresholdEth: number;

  // Optimization: Dynamic Position Sizing
  enableDynamicPositionSizing: boolean;
  maxPositionSizeMultiplier: number;

  // Optimization: Break-even stop after TP1
  enableBreakEvenAfterTP1: boolean;

  // Optimization: Token Blacklist (avoid re-entering recent losers)
  enableTokenBlacklist: boolean;
  tokenBlacklistMinutes: number;

  // Optimization: 1h Momentum Confirmation
  require1hMomentum: boolean;
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

  // Meme Score Filter
  minMemeScore: 70,
  enableMemeScore: true,

  // TWAP Execution
  enableTWAP: false,
  twapSlices: 4,
  twapIntervalMs: 10000,

  // Dynamic Slippage
  enableDynamicSlippage: true,

  // Multi-DEX Router
  enableMultiDEX: false,

  // Cooldown & Anti-FOMO
  cooldownAfterCloseSeconds: 30,
  maxBuysPerFiveMinutes: 3,

  // Force Exit
  enablePeakProfitExit: true,
  peakProfitDropPercent: 50,

  // Telegram Alert
  enableTelegram: false,
  telegramBotToken: "",
  telegramChatId: "",

  // Deployer Reputation
  enableDeployerCheck: true,
  maxDeployerTokens24h: 3,

  // Auto-Compounding
  enableAutoCompound: false,
  compoundThresholdEth: 0.005,

  // Dynamic Position Sizing
  enableDynamicPositionSizing: false,
  maxPositionSizeMultiplier: 1.5,

  // Break-even stop after TP1
  enableBreakEvenAfterTP1: true,

  // Token Blacklist
  enableTokenBlacklist: true,
  tokenBlacklistMinutes: 30,

  // 1h Momentum Confirmation
  require1hMomentum: false,
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
    minMemeScore: 75,
    enablePeakProfitExit: true,
    peakProfitDropPercent: 40,
    cooldownAfterCloseSeconds: 45,
    maxBuysPerFiveMinutes: 2,
    enableBreakEvenAfterTP1: true,
    enableTokenBlacklist: true,
    tokenBlacklistMinutes: 45,
    require1hMomentum: true,
    enableDynamicPositionSizing: false,
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
    minMemeScore: 70,
    enablePeakProfitExit: true,
    peakProfitDropPercent: 50,
    cooldownAfterCloseSeconds: 30,
    maxBuysPerFiveMinutes: 3,
    enableBreakEvenAfterTP1: true,
    enableTokenBlacklist: true,
    tokenBlacklistMinutes: 30,
    require1hMomentum: false,
    enableDynamicPositionSizing: false,
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
    minMemeScore: 60,
    enablePeakProfitExit: true,
    peakProfitDropPercent: 60,
    cooldownAfterCloseSeconds: 15,
    maxBuysPerFiveMinutes: 4,
    enableAutoCompound: true,
    enableBreakEvenAfterTP1: true,
    enableTokenBlacklist: true,
    tokenBlacklistMinutes: 15,
    require1hMomentum: false,
    enableDynamicPositionSizing: true,
    maxPositionSizeMultiplier: 1.5,
  },
};

// Base network contract addresses
export const BASE_CONTRACTS = {
  WETH: "0x4200000000000000000000000000000000000006",
  UNISWAP_V3_ROUTER: "0x2626664c2603336E57B271c5C0b26F421741e481",
  UNISWAP_V3_FACTORY: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
  UNISWAP_V3_QUOTER: "0x3d4e44Eb1374240CE5F1B136041212501e4a0439",
} as const;

export function calculateDynamicSlippage(
  volume5mUSD: number,
  liquidityUSD: number,
  priceChange5m: number
): number {
  if (liquidityUSD <= 0) return 8;

  const volLiqRatio = volume5mUSD / liquidityUSD;

  let slippage = 5; // default

  // Low volatility + healthy liquidity = tighter slippage
  if (volLiqRatio > 2 && liquidityUSD > 20000) slippage = 3;
  else if (volLiqRatio > 1 && liquidityUSD > 15000) slippage = 4;

  // High volatility = needs more room
  if (Math.abs(priceChange5m) > 30) slippage = Math.max(slippage, 10);
  else if (Math.abs(priceChange5m) > 20) slippage = Math.max(slippage, 8);
  else if (Math.abs(priceChange5m) > 10) slippage = Math.max(slippage, 6);

  // Very low liquidity = higher slippage risk
  if (liquidityUSD < 5000) slippage = Math.max(slippage, 9);
  else if (liquidityUSD < 10000) slippage = Math.max(slippage, 7);

  return Math.min(10, Math.max(2, slippage));
}
