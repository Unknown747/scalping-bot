import { Router } from "express";
import { getBot } from "../botInstance.js";

const router = Router();

const VALID_MODES = new Set(["live", "paper"]);
const VALID_RISK_LEVELS = new Set(["conservative", "moderate", "aggressive"]);

const NUMERIC_FIELDS = new Set([
  "totalCapitalEth", "maxTradeAmountEth", "maxConcurrentPositions", "minPositionEth",
  "min5mVolumeUsd", "minLiquidityUsd", "maxTokenAgeMinutes", "minMomentumPercent",
  "tp1Percent", "tp1SellPercent", "tp2Percent", "tp2SellPercent", "tp3Percent", "tp3SellPercent",
  "stopLossPercent", "trailingStopActivatePercent", "trailingStopDistancePercent",
  "maxHoldMinutes", "maxDailyLossEth", "cooldownMinutesAfterLoss",
  "maxSlippagePercent", "maxPriorityFeeGwei", "maxFeePerGasGwei",
  "minSafetyScore", "maxSellTaxPercent", "scanIntervalSeconds", "priceCheckIntervalSeconds",
  "minMemeScore", "twapSlices", "twapIntervalMs",
  "cooldownAfterCloseSeconds", "maxBuysPerFiveMinutes",
  "peakProfitDropPercent", "maxDeployerTokens24h",
  "compoundThresholdEth", "maxPositionSizeMultiplier",
  "aiFilterMinConfidence",
  "newListingMaxAgeMinutes", "newListingMaxHoldMinutes", "newListingMinBuySellRatio",
  "volumeSpikeMinMultiplier",
  "trailingStopMinProfitToActivate", "trailingStopLockMinProfitPercent",
  "tokenBlacklistMinutes",
]);

router.get("/config", (req, res) => {
  const bot = getBot();
  res.json(bot.getConfig());
});

router.put("/config", (req, res) => {
  const body = req.body as Record<string, unknown>;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ error: "Request body must be a JSON object." });
    return;
  }

  if ("mode" in body && !VALID_MODES.has(body.mode as string)) {
    res.status(400).json({ error: `mode must be "live" or "paper".` });
    return;
  }

  if ("riskLevel" in body && !VALID_RISK_LEVELS.has(body.riskLevel as string)) {
    res.status(400).json({ error: `riskLevel must be "conservative", "moderate", or "aggressive".` });
    return;
  }

  for (const [key, value] of Object.entries(body)) {
    if (NUMERIC_FIELDS.has(key) && typeof value !== "number") {
      res.status(400).json({ error: `Field "${key}" must be a number.` });
      return;
    }
  }

  const bot = getBot();
  const updated = bot.saveConfig(body);
  res.json(updated);
});

export default router;
