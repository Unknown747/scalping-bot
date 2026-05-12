import { Router } from "express";
import { getBot } from "../botInstance.js";
import * as db from "../scalping/database.js";
import { PriceMonitor } from "../scalping/PriceMonitor.js";

const router = Router();
const priceMonitor = new PriceMonitor();

router.get("/stats", async (req, res) => {
  const bot = getBot();
  const stats = await bot.buildStats();
  res.json(stats);
});

/**
 * GET /api/stats/both
 * Returns stats for LIVE and PAPER modes simultaneously.
 * Useful for showing both modes side-by-side in the dashboard.
 */
router.get("/stats/both", async (req, res) => {
  try {
    const bot = getBot();
    const ethPrice = await priceMonitor.getEthPrice();
    const usdToIdr = 16000;

    const liveToday = db.getTodayStats("live");
    const liveAllTime = db.getAllTimeStats("live");
    const paperToday = db.getTodayStats("paper");
    const paperAllTime = db.getAllTimeStats("paper");

    const buildModeStats = (
      mode: "live" | "paper",
      today: ReturnType<typeof db.getTodayStats>,
      allTime: ReturnType<typeof db.getAllTimeStats>
    ) => ({
      mode,
      todayPnlEth: today.pnlEth,
      todayPnlIdr: today.pnlEth * ethPrice * usdToIdr,
      totalTradesDay: today.totalTrades,
      winningTradesDay: today.winningTrades,
      losingTradesDay: today.losingTrades,
      winRateDay: today.totalTrades > 0 ? (today.winningTrades / today.totalTrades) * 100 : 0,
      avgHoldSeconds: allTime.avgHoldSeconds,
      avgProfitPercent: allTime.avgProfitPercent,
      largestWin: allTime.largestWin,
      largestLoss: allTime.largestLoss,
      totalPnlAllTime: allTime.totalPnlEth,
      ethPriceUsd: ethPrice,
    });

    const config = (bot as any).config;
    const capitalEth = config?.totalCapitalEth ?? 0;

    res.json({
      live: buildModeStats("live", liveToday, liveAllTime),
      paper: buildModeStats("paper", paperToday, paperAllTime),
      currentMode: (bot as any).config?.mode ?? "paper",
      capitalEth,
      capitalIdr: capitalEth * ethPrice * usdToIdr,
      ethPriceUsd: ethPrice,
    });
  } catch (err) {
    req.log.error({ err }, "Stats/both error");
    res.status(500).json({ error: "Failed to fetch combined stats" });
  }
});

export default router;
