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

  // Optimization: Token Blacklist
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

  // New Listing Mode — ultra-aggressive for tokens < 10 min
  enableNewListingMode: boolean;
  newListingMaxAgeMinutes: number;   // tokens < this = new listing treatment
  newListingMinBuySellRatio: number; // must have strong buy pressure
  newListingMaxHoldMinutes: number;  // shorter hold for new listings
}

/**
 * DEFAULT CONFIG — tuned for new meme coin listings on Base.
 *
 * KEY INSIGHT for new meme coins:
 * - First 5-15 minutes: pump window (buy pressure high, retail FOMO)
 * - 15-30 min: stabilization or dump
 * - >30 min: pump usually over, much lower R/R
 *
 * Strategy:
 * - Enter early (< 15 min age, strong buy pressure, min 10% 5m move)
 * - Quick TP1 at +5% (take half off, de-risk fast)
 * - Let remainder ride with trailing stop
 * - Hard stop -6% (meme dumps are fast)
 * - Max hold 12 min (force exit before dump cycle)
 */
export const DEFAULT_CONFIG: ScalpingConfigData = {
  totalCapitalEth: 0.04,
  maxTradeAmountEth: 0.0005,
  maxConcurrentPositions: 3,
  minPositionEth: 0.0001,

  // Scanner filters
  min5mVolumeUsd: 2000,       // lower threshold to catch very new listings
  minLiquidityUsd: 6000,      // $6k min — enough to trade without excessive impact
  maxTokenAgeMinutes: 45,     // focus on fresh tokens
  minMomentumPercent: 8,      // 8%+ 5m momentum to enter

  // ── Take Profit Strategy (new listing optimized) ──────────────────────────
  // New meme coins: pump hard then dump. Take profits FAST.
  tp1Percent: 5,              // TP1 at +5% — quick de-risk
  tp1SellPercent: 50,         // sell 50% at TP1 (secure half position)
  tp2Percent: 12,             // TP2 at +12%
  tp2SellPercent: 30,         // sell 30% at TP2
  tp3Percent: 25,             // TP3 at +25% (moonshot target)
  tp3SellPercent: 20,         // sell remaining 20% at TP3

  // ── Stop Loss ─────────────────────────────────────────────────────────────
  stopLossPercent: 6,         // -6% hard stop
  trailingStopActivatePercent: 5,     // trailing activates at +5%
  trailingStopDistancePercent: 3,     // 3% trail distance (tight for volatile memes)
  trailingStopMinProfitToActivate: 5,
  trailingStopLockMinProfitPercent: 2,

  // ── Time Management ───────────────────────────────────────────────────────
  maxHoldMinutes: 12,         // force exit after 12 min (new listing pump window)
  maxDailyLossEth: 0.003,
  cooldownMinutesAfterLoss: 30,

  // ── Execution ─────────────────────────────────────────────────────────────
  maxSlippagePercent: 10,     // higher slippage for new coins (thin liquidity)
  maxPriorityFeeGwei: 0.1,
  maxFeePerGasGwei: 0.5,

  // ── Safety Filters ────────────────────────────────────────────────────────
  minSafetyScore: 55,         // slightly relaxed for new listings (GoPlus may lag)
  maxSellTaxPercent: 10,

  // ── Scan Config ───────────────────────────────────────────────────────────
  scanIntervalSeconds: 6,     // scan every 6s (faster for new listings)
  priceCheckIntervalSeconds: 2,
  riskLevel: "aggressive",
  mode: "live",

  // ── Meme Score Filter ─────────────────────────────────────────────────────
  minMemeScore: 50,           // min 50/100 (new listings get age bonus)
  enableMemeScore: true,

  // ── TWAP ──────────────────────────────────────────────────────────────────
  enableTWAP: false,          // disabled for speed (new listings move fast)
  twapSlices: 3,
  twapIntervalMs: 5000,

  // ── Dynamic Slippage ──────────────────────────────────────────────────────
  enableDynamicSlippage: true,

  // ── Multi-DEX ─────────────────────────────────────────────────────────────
  enableMultiDEX: true,

  // ── Anti-FOMO & Rate Limiting ─────────────────────────────────────────────
  cooldownAfterCloseSeconds: 15,
  maxBuysPerFiveMinutes: 3,

  // ── Peak Profit Exit ──────────────────────────────────────────────────────
  enablePeakProfitExit: true,
  peakProfitDropPercent: 35,  // force exit if drops 35% from peak

  // ── Telegram ──────────────────────────────────────────────────────────────
  enableTelegram: !!(process.env["TELEGRAM_BOT_TOKEN"] && process.env["TELEGRAM_CHAT_ID"]),
  telegramBotToken: process.env["TELEGRAM_BOT_TOKEN"] || "",
  telegramChatId: process.env["TELEGRAM_CHAT_ID"] || "",

  // ── Deployer Reputation ───────────────────────────────────────────────────
  enableDeployerCheck: true,
  maxDeployerTokens24h: 4,    // flag if deployer launched 4+ tokens in 24h (serial rug)

  // ── Auto-Compounding ──────────────────────────────────────────────────────
  enableAutoCompound: false,
  compoundThresholdEth: 0.005,

  // ── Position Sizing ───────────────────────────────────────────────────────
  enableDynamicPositionSizing: true,
  maxPositionSizeMultiplier: 1.5,

  // ── Post-TP1 Break-Even ───────────────────────────────────────────────────
  enableBreakEvenAfterTP1: true,

  // ── Token Blacklist ───────────────────────────────────────────────────────
  enableTokenBlacklist: true,
  tokenBlacklistMinutes: 15,

  // ── 1h Momentum Confirmation ──────────────────────────────────────────────
  require1hMomentum: false,   // disabled — new listings have no 1h history

  // ── AI Filter ─────────────────────────────────────────────────────────────
  enableAIFilter: !!(process.env["AI_INTEGRATIONS_GEMINI_API_KEY"] || process.env["AI_INTEGRATIONS_OPENROUTER_API_KEY"]),
  aiFilterMinConfidence: 60,
  aiPrimaryProvider: "gemini",

  // ── New Listing Mode ──────────────────────────────────────────────────────
  enableNewListingMode: true,
  newListingMaxAgeMinutes: 15,    // < 15 min = new listing treatment
  newListingMinBuySellRatio: 1.5, // must have 1.5x more buys than sells
  newListingMaxHoldMinutes: 8,    // max 8 min hold for brand new listings
};

// ─── Risk Presets ─────────────────────────────────────────────────────────────

export const RISK_PRESETS: Record<string, Partial<ScalpingConfigData>> = {
  conservative: {
    maxTradeAmountEth: 0.001,
    maxConcurrentPositions: 2,
    minMomentumPercent: 20,
    minSafetyScore: 75,
    stopLossPercent: 4,
    tp1Percent: 4,
    tp1SellPercent: 60,    // Take 60% off at TP1 — very conservative
    tp2Percent: 8,
    tp2SellPercent: 30,
    tp3Percent: 15,
    tp3SellPercent: 10,
    maxHoldMinutes: 8,
    minMemeScore: 70,
    enablePeakProfitExit: true,
    peakProfitDropPercent: 30,
    cooldownAfterCloseSeconds: 60,
    maxBuysPerFiveMinutes: 2,
    enableBreakEvenAfterTP1: true,
    enableTokenBlacklist: true,
    tokenBlacklistMinutes: 60,
    require1hMomentum: false,
    enableDynamicPositionSizing: false,
    newListingMaxHoldMinutes: 5,
    newListingMinBuySellRatio: 2.0,
  },
  moderate: {
    maxTradeAmountEth: 0.002,
    maxConcurrentPositions: 3,
    minMomentumPercent: 12,
    minSafetyScore: 65,
    stopLossPercent: 6,
    tp1Percent: 5,
    tp1SellPercent: 50,
    tp2Percent: 12,
    tp2SellPercent: 30,
    tp3Percent: 20,
    tp3SellPercent: 20,
    maxHoldMinutes: 12,
    minMemeScore: 60,
    enablePeakProfitExit: true,
    peakProfitDropPercent: 40,
    cooldownAfterCloseSeconds: 30,
    maxBuysPerFiveMinutes: 3,
    enableBreakEvenAfterTP1: true,
    enableTokenBlacklist: true,
    tokenBlacklistMinutes: 30,
    require1hMomentum: false,
    enableDynamicPositionSizing: true,
    newListingMaxHoldMinutes: 8,
    newListingMinBuySellRatio: 1.5,
  },
  aggressive: {
    maxTradeAmountEth: 0.003,
    maxConcurrentPositions: 4,
    minMomentumPercent: 8,
    minSafetyScore: 55,
    stopLossPercent: 7,
    tp1Percent: 5,
    tp1SellPercent: 40,
    tp2Percent: 15,
    tp2SellPercent: 35,
    tp3Percent: 30,
    tp3SellPercent: 25,
    maxHoldMinutes: 15,
    minMemeScore: 50,
    enablePeakProfitExit: true,
    peakProfitDropPercent: 40,
    cooldownAfterCloseSeconds: 10,
    maxBuysPerFiveMinutes: 4,
    enableAutoCompound: true,
    enableBreakEvenAfterTP1: true,
    enableTokenBlacklist: true,
    tokenBlacklistMinutes: 10,
    require1hMomentum: false,
    enableDynamicPositionSizing: true,
    maxPositionSizeMultiplier: 2.0,
    newListingMaxHoldMinutes: 10,
    newListingMinBuySellRatio: 1.2,
  },
};

// ─── Contract Addresses (Base Mainnet) ────────────────────────────────────────

export const BASE_CONTRACTS = {
  WETH: "0x4200000000000000000000000000000000000006",
  UNISWAP_V3_ROUTER: "0x2626664c2603336E57B271c5C0b26F421741e481",
  UNISWAP_V3_FACTORY: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
  UNISWAP_V3_QUOTER: "0x3d4e44Eb1374240CE5F1B136041212501e4a0439",
} as const;

// ─── Dynamic Slippage Calculator ──────────────────────────────────────────────

export function calculateDynamicSlippage(
  volume5mUSD: number,
  liquidityUSD: number,
  priceChange5m: number
): number {
  if (liquidityUSD <= 0) return 10;

  const volLiqRatio = volume5mUSD / liquidityUSD;
  let slippage = 6; // default for new meme coins

  // Good liquidity + moderate activity = tighter
  if (volLiqRatio > 2 && liquidityUSD > 30000) slippage = 4;
  else if (volLiqRatio > 1 && liquidityUSD > 15000) slippage = 5;

  // High volatility = needs more room
  if (Math.abs(priceChange5m) > 50) slippage = Math.max(slippage, 15);
  else if (Math.abs(priceChange5m) > 30) slippage = Math.max(slippage, 12);
  else if (Math.abs(priceChange5m) > 15) slippage = Math.max(slippage, 9);
  else if (Math.abs(priceChange5m) > 8) slippage = Math.max(slippage, 7);

  // Very thin liquidity = high impact
  if (liquidityUSD < 5000) slippage = Math.max(slippage, 12);
  else if (liquidityUSD < 10000) slippage = Math.max(slippage, 9);
  else if (liquidityUSD < 20000) slippage = Math.max(slippage, 7);

  return Math.min(15, Math.max(3, slippage));
}
