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
 * DEFAULT CONFIG — optimized for micro-trading ~$1 per trade on Base meme coins.
 *
 * KEY CONSTRAINTS at $1 trade size:
 * - Base gas fees: ~$0.001–$0.01 per swap (negligible, but still present)
 * - DEX fee: 0.3% × 2 (buy+sell) = 0.6% minimum cost
 * - Slippage at micro size: 0.5–2% (tiny impact due to small position)
 * - Breakeven threshold: ~3–4% → TP1 must be at least +8% for real profit
 *
 * STRATEGY — Fresh meme coin pump window:
 * - Enter within first 10 minutes (peak FOMO window)
 * - Require strong buy/sell ratio + min $5k volume to avoid fake pumps
 * - TP1 at +8% (secure 60% of position — locks real cash profit even on $1)
 * - Let remainder trail — meme can 2–5x in minutes
 * - Hard stop -5% (dump cycles are violent and fast)
 * - Max hold 8 min; for brand-new listings max 5 min
 * - Max 2 concurrent positions (don't over-diversify with micro capital)
 */
export const DEFAULT_CONFIG: ScalpingConfigData = {
  // ── Capital — tuned for ~$1 per trade ────────────────────────────────────────
  totalCapitalEth: 0.002,       // ~$5 total reserve (covers 5 full trades)
  maxTradeAmountEth: 0.0004,    // ~$1 per trade at $2500/ETH
  maxConcurrentPositions: 2,    // max 2 open at once — don't spread micro capital thin
  minPositionEth: 0.00005,      // minimum valid position size

  // ── Scanner Filters ──────────────────────────────────────────────────────────
  min5mVolumeUsd: 5000,         // $5k min 5m volume — filters fake low-activity pumps
  minLiquidityUsd: 15000,       // $15k min liquidity — enough depth for clean exit
  maxTokenAgeMinutes: 10,       // only tokens < 10 min old — peak FOMO window
  minMomentumPercent: 12,       // 12%+ 5m move — requires real momentum, not noise

  // ── Take Profit ——— must cover fees+slippage on tiny trades ──────────────────
  // At $1 size: breakeven ~3–4%. TP1 at +8% = ~$0.04 real profit after costs.
  tp1Percent: 8,                // TP1 at +8% — first secure target
  tp1SellPercent: 60,           // sell 60% at TP1 — lock majority of profit early
  tp2Percent: 20,               // TP2 at +20% — only reached on strong pumps
  tp2SellPercent: 100,          // sell 100% remaining at TP2 — close all, no tiny leftover
  tp3Percent: 40,               // TP3 kept for reference but won't trigger (position closed at TP2)
  tp3SellPercent: 100,          // sell 100% if TP3 somehow reached

  // ── Stop Loss ────────────────────────────────────────────────────────────────
  stopLossPercent: 7,                     // -7% hard stop — room for normal meme volatility, avoid noise exits
  trailingStopActivatePercent: 8,         // trailing activates only after +8% (TP1 zone)
  trailingStopDistancePercent: 7,         // 7% trail — enough breathing room on volatile memes, avoids whipsaw
  trailingStopMinProfitToActivate: 8,     // must be 8%+ in profit before trailing kicks in
  trailingStopLockMinProfitPercent: 3,    // lock at least +3% profit when trailing active

  // ── Time Management ──────────────────────────────────────────────────────────
  maxHoldMinutes: 8,            // 8 min max — pump window is short, exit before dump
  maxDailyLossEth: 0.001,       // max $2.50 loss per day (caps 2–3 bad trades)
  cooldownMinutesAfterLoss: 30, // 30 min cooldown after a stop loss hit

  // ── Execution ─────────────────────────────────────────────────────────────
  // Small size = minimal price impact, but still need slippage room for thin liquidity
  maxSlippagePercent: 12,       // 12% cap — covers thin liquidity new coins
  maxPriorityFeeGwei: 0.3,      // slightly elevated priority to get filled fast
  maxFeePerGasGwei: 0.5,

  // ── Safety Filters ───────────────────────────────────────────────────────────
  minSafetyScore: 65,           // stricter than default — filter obvious honeypots/rugs
  maxSellTaxPercent: 8,         // reject if sell tax > 8%

  // ── Scan Config ──────────────────────────────────────────────────────────────
  scanIntervalSeconds: 5,       // scan every 5s — responsive for new listings
  priceCheckIntervalSeconds: 2,
  riskLevel: "aggressive",
  mode: "live",

  // ── Meme Score Filter ────────────────────────────────────────────────────────
  minMemeScore: 55,             // min 55/100 — new listings get age bonus so this is fair
  enableMemeScore: true,

  // ── TWAP Execution ───────────────────────────────────────────────────────────
  enableTWAP: false,            // OFF — our size is too small to need order splitting
  twapSlices: 3,
  twapIntervalMs: 5000,

  // ── Dynamic Slippage ─────────────────────────────────────────────────────────
  enableDynamicSlippage: true,  // ON — adjusts slippage per token liquidity dynamically

  // ── Multi-DEX Router ─────────────────────────────────────────────────────────
  enableMultiDEX: true,         // ON — routes to best DEX for best price

  // ── Anti-FOMO & Rate Limiting ────────────────────────────────────────────────
  cooldownAfterCloseSeconds: 30, // 30s cooldown before next entry
  maxBuysPerFiveMinutes: 2,      // max 2 buys per 5 min — prevent over-trading

  // ── Peak Profit Exit ─────────────────────────────────────────────────────────
  enablePeakProfitExit: true,
  peakProfitDropPercent: 15,    // exit if price drops 15% from the peak — tighter to protect accumulated profit

  // ── Telegram ─────────────────────────────────────────────────────────────────
  enableTelegram: !!(process.env["TELEGRAM_BOT_TOKEN"] && process.env["TELEGRAM_CHAT_ID"]),
  telegramBotToken: process.env["TELEGRAM_BOT_TOKEN"] || "",
  telegramChatId: process.env["TELEGRAM_CHAT_ID"] || "",

  // ── Deployer Reputation ──────────────────────────────────────────────────────
  enableDeployerCheck: true,
  maxDeployerTokens24h: 2,      // flag deployers with 2+ launches in 24h — stricter, serial rugger filter

  // ── Auto-Compounding ─────────────────────────────────────────────────────────
  enableAutoCompound: false,    // OFF — capital too small to meaningfully compound
  compoundThresholdEth: 0.005,

  // ── Dynamic Position Sizing ──────────────────────────────────────────────────
  enableDynamicPositionSizing: false, // OFF — size already micro, scaling up risks blowout
  maxPositionSizeMultiplier: 1.0,

  // ── Post-TP1 Break-Even ──────────────────────────────────────────────────────
  enableBreakEvenAfterTP1: true, // ON — once TP1 hit, move stop to entry (can't lose)

  // ── Token Blacklist ──────────────────────────────────────────────────────────
  enableTokenBlacklist: true,
  tokenBlacklistMinutes: 30,    // blacklist for 30 min after stop loss

  // ── 1h Momentum Confirmation ─────────────────────────────────────────────────
  require1hMomentum: false,     // OFF — new listings have no 1h history yet

  // ── AI Filter ────────────────────────────────────────────────────────────────
  enableAIFilter: !!(process.env["AI_INTEGRATIONS_GEMINI_API_KEY"] || process.env["GROQ_API_KEY"] || process.env["HUGGINGFACE_API_KEY"]),
  aiFilterMinConfidence: 60,
  aiPrimaryProvider: "gemini",

  // ── New Listing Mode ─────────────────────────────────────────────────────────
  enableNewListingMode: true,
  newListingMaxAgeMinutes: 10,    // tokens < 10 min = full new listing treatment
  newListingMinBuySellRatio: 2.0, // require 2x more buyers than sellers (strong conviction)
  newListingMaxHoldMinutes: 5,    // max 5 min for brand-new listings (extreme caution)
};

// ─── Risk Presets — all calibrated for micro $1 trade sizes ──────────────────

export const RISK_PRESETS: Record<string, Partial<ScalpingConfigData>> = {
  conservative: {
    // ~$0.50 per trade — ultra safe, only clear setups
    maxTradeAmountEth: 0.0002,
    maxConcurrentPositions: 1,    // only 1 open at a time
    minMomentumPercent: 20,       // wait for very strong momentum
    minSafetyScore: 75,
    stopLossPercent: 6,           // -6% hard stop — room for normal volatility without premature exit
    tp1Percent: 6,                // lower TP1 — easier to hit
    tp1SellPercent: 70,           // sell 70% at TP1 — very conservative, take profits fast
    tp2Percent: 15,
    tp2SellPercent: 100,          // close 100% remaining at TP2 — no tiny leftover
    tp3Percent: 30,
    tp3SellPercent: 100,
    trailingStopDistancePercent: 6,  // 6% trail — tighter for conservative but still avoids whipsaw
    maxHoldMinutes: 6,
    minMemeScore: 70,
    enablePeakProfitExit: true,
    peakProfitDropPercent: 15,    // tighter peak exit — protect profits aggressively
    cooldownAfterCloseSeconds: 60,
    maxBuysPerFiveMinutes: 1,
    enableBreakEvenAfterTP1: true,
    enableTokenBlacklist: true,
    tokenBlacklistMinutes: 60,
    require1hMomentum: false,
    enableDynamicPositionSizing: false,
    newListingMaxHoldMinutes: 4,
    newListingMinBuySellRatio: 2.5,
    maxDeployerTokens24h: 2,      // stricter — flag serial ruggers at 2 launches
    maxSellTaxPercent: 5,
  },
  moderate: {
    // ~$1 per trade — balanced risk/reward
    maxTradeAmountEth: 0.0004,
    maxConcurrentPositions: 2,
    minMomentumPercent: 12,
    minSafetyScore: 65,
    stopLossPercent: 7,           // -7% hard stop — matches default, avoids noise exits
    tp1Percent: 8,
    tp1SellPercent: 60,
    tp2Percent: 20,
    tp2SellPercent: 100,          // close 100% remaining at TP2 — no tiny leftover
    tp3Percent: 40,
    tp3SellPercent: 100,
    trailingStopDistancePercent: 7,  // 7% trail — breathing room for volatile memes
    maxHoldMinutes: 8,
    minMemeScore: 55,
    enablePeakProfitExit: true,
    peakProfitDropPercent: 15,    // tighter peak exit — protect profits
    cooldownAfterCloseSeconds: 30,
    maxBuysPerFiveMinutes: 2,
    enableBreakEvenAfterTP1: true,
    enableTokenBlacklist: true,
    tokenBlacklistMinutes: 30,
    require1hMomentum: false,
    enableDynamicPositionSizing: false,
    newListingMaxHoldMinutes: 5,
    newListingMinBuySellRatio: 2.0,
    maxDeployerTokens24h: 2,      // stricter — flag serial ruggers at 2 launches
    maxSellTaxPercent: 8,
  },
  aggressive: {
    // ~$1.50 per trade — higher risk, chasing bigger pumps
    maxTradeAmountEth: 0.0006,
    maxConcurrentPositions: 2,
    minMomentumPercent: 10,
    minSafetyScore: 60,
    stopLossPercent: 8,           // -8% hard stop — wider for aggressive plays, avoids shakeouts
    tp1Percent: 8,
    tp1SellPercent: 50,           // keep more riding for bigger moves
    tp2Percent: 25,
    tp2SellPercent: 100,          // close 100% remaining at TP2 — clean exit, redeploy to fresh trade
    tp3Percent: 50,
    tp3SellPercent: 100,
    trailingStopDistancePercent: 8,  // 8% trail — widest for aggressive, lets winners run longer
    maxHoldMinutes: 10,
    minMemeScore: 50,
    enablePeakProfitExit: true,
    peakProfitDropPercent: 15,    // tighter peak exit — protect profits even on aggressive trades
    cooldownAfterCloseSeconds: 20,
    maxBuysPerFiveMinutes: 2,
    enableAutoCompound: false,
    enableBreakEvenAfterTP1: true,
    enableTokenBlacklist: true,
    tokenBlacklistMinutes: 20,
    require1hMomentum: false,
    enableDynamicPositionSizing: false,
    maxPositionSizeMultiplier: 1.0,
    newListingMaxHoldMinutes: 6,
    newListingMinBuySellRatio: 1.8,
    maxDeployerTokens24h: 2,      // stricter — flag serial ruggers at 2 launches
    maxSellTaxPercent: 8,
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
  if (liquidityUSD <= 0) return 12;

  const volLiqRatio = volume5mUSD / liquidityUSD;
  let slippage = 7; // base for new meme coins at micro size

  // Good liquidity = tighter slippage needed
  if (volLiqRatio > 2 && liquidityUSD > 30000) slippage = 4;
  else if (volLiqRatio > 1 && liquidityUSD > 20000) slippage = 5;
  else if (liquidityUSD > 15000) slippage = 6;

  // High volatility = needs more room
  if (Math.abs(priceChange5m) > 50) slippage = Math.max(slippage, 15);
  else if (Math.abs(priceChange5m) > 30) slippage = Math.max(slippage, 12);
  else if (Math.abs(priceChange5m) > 15) slippage = Math.max(slippage, 9);
  else if (Math.abs(priceChange5m) > 8) slippage = Math.max(slippage, 7);

  // Very thin liquidity = high impact even for small size
  if (liquidityUSD < 5000) slippage = Math.max(slippage, 14);
  else if (liquidityUSD < 10000) slippage = Math.max(slippage, 10);
  else if (liquidityUSD < 15000) slippage = Math.max(slippage, 8);

  return Math.min(15, Math.max(3, slippage));
}
