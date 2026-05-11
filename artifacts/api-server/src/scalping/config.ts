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

  // Advanced Trailing Stop
  trailingStopMinProfitToActivate: number;
  trailingStopLockMinProfitPercent: number;

  // AI Filter
  enableAIFilter: boolean;
  aiFilterMinConfidence: number;
  aiPrimaryProvider: "gemini" | "groq" | "huggingface";
}

export const DEFAULT_CONFIG: ScalpingConfigData = {
  totalCapitalEth: 0.04,
  maxTradeAmountEth: 0.0005,
  maxConcurrentPositions: 3,
  minPositionEth: 0.0001,
  min5mVolumeUsd: 3000,
  minLiquidityUsd: 8000,
  maxTokenAgeMinutes: 60,
  minMomentumPercent: 10,
  tp1Percent: 3,
  tp1SellPercent: 40,
  tp2Percent: 8,
  tp2SellPercent: 35,
  tp3Percent: 15,
  tp3SellPercent: 25,
  stopLossPercent: 6,
  trailingStopActivatePercent: 4,
  trailingStopDistancePercent: 2.5,
  maxHoldMinutes: 20,
  maxDailyLossEth: 0.005,
  cooldownMinutesAfterLoss: 60,
  maxSlippagePercent: 8,
  maxPriorityFeeGwei: 0.1,
  maxFeePerGasGwei: 0.5,
  minSafetyScore: 60,
  maxSellTaxPercent: 12,
  scanIntervalSeconds: 8,
  priceCheckIntervalSeconds: 2,
  riskLevel: "moderate",
  mode: "live",

  // Meme Score Filter — lebih longgar untuk uji coba
  minMemeScore: 55,
  enableMemeScore: true,

  // TWAP Execution
  enableTWAP: false,
  twapSlices: 4,
  twapIntervalMs: 10000,

  // Dynamic Slippage
  enableDynamicSlippage: true,

  // Multi-DEX Router
  enableMultiDEX: true,

  // Cooldown & Anti-FOMO
  cooldownAfterCloseSeconds: 20,
  maxBuysPerFiveMinutes: 4,

  // Force Exit
  enablePeakProfitExit: true,
  peakProfitDropPercent: 45,

  // Telegram Alert — aktifkan via env vars
  enableTelegram: !!(process.env["TELEGRAM_BOT_TOKEN"] && process.env["TELEGRAM_CHAT_ID"]),
  telegramBotToken: process.env["TELEGRAM_BOT_TOKEN"] || "",
  telegramChatId: process.env["TELEGRAM_CHAT_ID"] || "",

  // Deployer Reputation
  enableDeployerCheck: true,
  maxDeployerTokens24h: 5,

  // Auto-Compounding
  enableAutoCompound: false,
  compoundThresholdEth: 0.005,

  // Dynamic Position Sizing
  enableDynamicPositionSizing: true,
  maxPositionSizeMultiplier: 1.5,

  // Break-even stop after TP1
  enableBreakEvenAfterTP1: true,

  // Token Blacklist
  enableTokenBlacklist: true,
  tokenBlacklistMinutes: 20,

  // 1h Momentum Confirmation — nonaktifkan untuk lebih banyak peluang
  require1hMomentum: false,

  // Advanced Trailing Stop
  trailingStopMinProfitToActivate: 4,
  trailingStopLockMinProfitPercent: 1.5,

  // AI Filter — aktifkan jika Gemini key tersedia
  enableAIFilter: !!process.env["AI_INTEGRATIONS_GEMINI_API_KEY"],
  aiFilterMinConfidence: 60,
  aiPrimaryProvider: "gemini",
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
