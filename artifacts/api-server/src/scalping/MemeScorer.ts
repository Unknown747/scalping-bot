import { logger } from "../lib/logger.js";

export interface MemeTokenData {
  ageMinutes: number;
  liquidityUSD: number;
  volume5mUSD: number;
  priceChange5m: number;
  buySellRatio5m: number;
}

export interface MemeScoreResult {
  score: number;
  breakdown: {
    volumeLiquidity: number;
    priceChange: number;
    buySellRatio: number;
    age: number;
    liquidity: number;
  };
  passed: boolean;
}

export function calculateMemeScore(data: MemeTokenData, minScore = 70): MemeScoreResult {
  let score = 0;
  const breakdown = {
    volumeLiquidity: 0,
    priceChange: 0,
    buySellRatio: 0,
    age: 0,
    liquidity: 0,
  };

  // 1. Volume/Liquidity ratio (weight 30)
  if (data.liquidityUSD > 0) {
    const volLiqRatio = data.volume5mUSD / data.liquidityUSD;
    if (volLiqRatio > 2) breakdown.volumeLiquidity = 30;
    else if (volLiqRatio > 1) breakdown.volumeLiquidity = 20;
    else if (volLiqRatio > 0.5) breakdown.volumeLiquidity = 10;
    else if (volLiqRatio > 0.2) breakdown.volumeLiquidity = 5;
  }
  score += breakdown.volumeLiquidity;

  // 2. Price change 5m (weight 25)
  if (data.priceChange5m > 20) breakdown.priceChange = 25;
  else if (data.priceChange5m > 10) breakdown.priceChange = 18;
  else if (data.priceChange5m > 5) breakdown.priceChange = 10;
  else if (data.priceChange5m > 2) breakdown.priceChange = 5;
  score += breakdown.priceChange;

  // 3. Buy/Sell ratio (weight 20)
  if (data.buySellRatio5m > 2) breakdown.buySellRatio = 20;
  else if (data.buySellRatio5m > 1.5) breakdown.buySellRatio = 15;
  else if (data.buySellRatio5m > 1) breakdown.buySellRatio = 10;
  else if (data.buySellRatio5m > 0.8) breakdown.buySellRatio = 5;
  score += breakdown.buySellRatio;

  // 4. Age (weight 15) - younger is better
  if (data.ageMinutes < 5) breakdown.age = 15;
  else if (data.ageMinutes < 10) breakdown.age = 12;
  else if (data.ageMinutes < 15) breakdown.age = 10;
  else if (data.ageMinutes < 30) breakdown.age = 5;
  score += breakdown.age;

  // 5. Minimum liquidity (weight 10)
  if (data.liquidityUSD > 20000) breakdown.liquidity = 10;
  else if (data.liquidityUSD > 10000) breakdown.liquidity = 7;
  else if (data.liquidityUSD > 5000) breakdown.liquidity = 3;
  score += breakdown.liquidity;

  const finalScore = Math.min(100, score);

  logger.debug(
    { score: finalScore, breakdown },
    "MemeScore calculated"
  );

  return {
    score: finalScore,
    breakdown,
    passed: finalScore >= minScore,
  };
}
