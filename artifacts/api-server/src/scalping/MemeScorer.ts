import { logger } from "../lib/logger.js";

export interface MemeTokenData {
  ageMinutes: number;
  liquidityUSD: number;
  volume5mUSD: number;
  priceChange5m: number;
  buySellRatio5m: number;
  // Optional enriched fields for new listing detection
  priceChange1h?: number;
  txnCount5m?: number; // total txns in 5m
}

export interface MemeScoreResult {
  score: number;
  breakdown: {
    volumeLiquidity: number;
    priceChange: number;
    buySellRatio: number;
    age: number;
    liquidity: number;
    newListingBonus: number;
    volumeSpike: number;
  };
  passed: boolean;
  tier: "new_listing" | "trending" | "established" | "unknown";
}

/**
 * MemeScorer v2 — optimized for new meme coin listings.
 *
 * Key insight: New meme coins (< 15 min) are the highest risk/reward.
 * We reward:
 *   - Very fresh age (< 5 min = huge bonus)
 *   - Strong buy pressure (buy/sell > 2)
 *   - Volume spike relative to liquidity (vol > liq = huge momentum)
 *   - Consistent pump (5m price change > 15%)
 * We penalize:
 *   - Stale tokens (> 30 min — the pump is likely over)
 *   - No buy pressure (ratio < 1)
 *   - Low liquidity (< $5k = dump risk)
 */
export function calculateMemeScore(data: MemeTokenData, minScore = 55): MemeScoreResult {
  let score = 0;
  const breakdown = {
    volumeLiquidity: 0,
    priceChange: 0,
    buySellRatio: 0,
    age: 0,
    liquidity: 0,
    newListingBonus: 0,
    volumeSpike: 0,
  };

  // ── 1. Volume / Liquidity ratio (weight: 25) ─────────────────────────────
  // High vol/liq = strong momentum, money flowing in fast
  if (data.liquidityUSD > 0) {
    const volLiqRatio = data.volume5mUSD / data.liquidityUSD;
    if (volLiqRatio > 5)       breakdown.volumeLiquidity = 25; // insane spike
    else if (volLiqRatio > 2)  breakdown.volumeLiquidity = 20;
    else if (volLiqRatio > 1)  breakdown.volumeLiquidity = 15;
    else if (volLiqRatio > 0.5) breakdown.volumeLiquidity = 8;
    else if (volLiqRatio > 0.2) breakdown.volumeLiquidity = 4;
  }
  score += breakdown.volumeLiquidity;

  // ── 2. Price change 5m (weight: 25) ──────────────────────────────────────
  // Strong 5m pump = momentum still alive
  if (data.priceChange5m > 50)      breakdown.priceChange = 25;
  else if (data.priceChange5m > 25) breakdown.priceChange = 20;
  else if (data.priceChange5m > 15) breakdown.priceChange = 15;
  else if (data.priceChange5m > 8)  breakdown.priceChange = 10;
  else if (data.priceChange5m > 3)  breakdown.priceChange = 5;
  else if (data.priceChange5m > 0)  breakdown.priceChange = 2;
  score += breakdown.priceChange;

  // ── 3. Buy/Sell ratio (weight: 20) ──────────────────────────────────────
  // High buy pressure = buyers in control = bullish
  if (data.buySellRatio5m > 4)      breakdown.buySellRatio = 20;
  else if (data.buySellRatio5m > 3) breakdown.buySellRatio = 17;
  else if (data.buySellRatio5m > 2) breakdown.buySellRatio = 14;
  else if (data.buySellRatio5m > 1.5) breakdown.buySellRatio = 10;
  else if (data.buySellRatio5m > 1) breakdown.buySellRatio = 6;
  else if (data.buySellRatio5m > 0.8) breakdown.buySellRatio = 2;
  // Negative: sell pressure
  score += breakdown.buySellRatio;

  // ── 4. Age (weight: 15) — younger = more potential ────────────────────────
  if (data.ageMinutes < 3)       breakdown.age = 15; // just launched
  else if (data.ageMinutes < 8)  breakdown.age = 13;
  else if (data.ageMinutes < 15) breakdown.age = 10;
  else if (data.ageMinutes < 30) breakdown.age = 6;
  else if (data.ageMinutes < 60) breakdown.age = 3;
  // > 60 min = 0 (stale, pump likely over)
  score += breakdown.age;

  // ── 5. Liquidity floor (weight: 10) ──────────────────────────────────────
  // Need enough liquidity to enter/exit without massive impact
  if (data.liquidityUSD > 50000)      breakdown.liquidity = 10;
  else if (data.liquidityUSD > 20000) breakdown.liquidity = 8;
  else if (data.liquidityUSD > 10000) breakdown.liquidity = 6;
  else if (data.liquidityUSD > 5000)  breakdown.liquidity = 3;
  else if (data.liquidityUSD > 2000)  breakdown.liquidity = 1;
  // < $2k = too thin, 0 points
  score += breakdown.liquidity;

  // ── 6. NEW LISTING BONUS (weight: 10) ─────────────────────────────────────
  // Fresh launch + strong signals = highest probability window
  const isVeryFresh = data.ageMinutes < 8;
  const hasStrongMomentum = data.priceChange5m > 10;
  const hasBuyPressure = data.buySellRatio5m > 1.5;
  const hasMinLiquidity = data.liquidityUSD > 5000;

  if (isVeryFresh && hasStrongMomentum && hasBuyPressure && hasMinLiquidity) {
    breakdown.newListingBonus = 10;
  } else if (isVeryFresh && (hasStrongMomentum || hasBuyPressure)) {
    breakdown.newListingBonus = 5;
  }
  score += breakdown.newListingBonus;

  // ── 7. VOLUME SPIKE BONUS (weight: 5) ─────────────────────────────────────
  // Extreme volume spike = viral / being promoted
  if (data.liquidityUSD > 0) {
    const ratio = data.volume5mUSD / data.liquidityUSD;
    if (ratio > 10) breakdown.volumeSpike = 5;
    else if (ratio > 5) breakdown.volumeSpike = 3;
  }
  score += breakdown.volumeSpike;

  const finalScore = Math.min(100, Math.max(0, score));

  // ── Tier classification ───────────────────────────────────────────────────
  let tier: MemeScoreResult["tier"] = "unknown";
  if (data.ageMinutes < 15) tier = "new_listing";
  else if (data.ageMinutes < 60 && data.priceChange5m > 5) tier = "trending";
  else if (data.liquidityUSD > 50000) tier = "established";

  logger.debug({ score: finalScore, breakdown, tier }, "MemeScore v2 calculated");

  return {
    score: finalScore,
    breakdown,
    passed: finalScore >= minScore,
    tier,
  };
}
