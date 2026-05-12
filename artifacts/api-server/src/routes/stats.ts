import { Router } from "express";
import { getBot } from "../botInstance.js";
import * as db from "../scalping/database.js";
import { PriceMonitor } from "../scalping/PriceMonitor.js";
import { USD_TO_IDR } from "../lib/constants.js";

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
 */
router.get("/stats/both", async (req, res) => {
  try {
    const bot = getBot();
    const ethPrice = await priceMonitor.getEthPrice();

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
      todayPnlIdr: today.pnlEth * ethPrice * USD_TO_IDR,
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
      capitalIdr: capitalEth * ethPrice * USD_TO_IDR,
      ethPriceUsd: ethPrice,
    });
  } catch (err) {
    req.log.error({ err }, "Stats/both error");
    res.status(500).json({ error: "Failed to fetch combined stats" });
  }
});

/**
 * DELETE /api/stats/reset?mode=live|paper|all
 * Hapus semua trade (dan daily_stats) sesuai mode.
 * Gunakan dengan hati-hati — data tidak bisa dikembalikan.
 */
router.delete("/stats/reset", (req, res) => {
  try {
    const mode = req.query["mode"] as string | undefined;
    if (!mode || !["live", "paper", "all"].includes(mode)) {
      res.status(400).json({ error: "mode harus live | paper | all" });
      return;
    }

    const database = db.getDb();

    if (mode === "all") {
      database.exec("DELETE FROM trades");
      database.exec("DELETE FROM daily_stats");
      req.log.info({}, "Stats reset: ALL modes");
      res.json({ ok: true, deleted: "all" });
    } else {
      database.prepare("DELETE FROM trades WHERE mode = ?").run(mode);
      database.exec("DELETE FROM daily_stats");
      req.log.info({ mode }, `Stats reset: ${mode}`);
      res.json({ ok: true, deleted: mode });
    }
  } catch (err) {
    req.log.error({ err }, "Stats reset error");
    res.status(500).json({ error: "Gagal reset stats" });
  }
});

export default router;
