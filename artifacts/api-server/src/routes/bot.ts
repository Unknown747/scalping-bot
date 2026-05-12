import { Router } from "express";
import { getBot, getWatchdog } from "../botInstance.js";
import { runSecurityAudit } from "../scalping/SecurityAudit.js";

const router = Router();

router.get("/bot/status", (req, res) => {
  const bot = getBot();
  res.json(bot.getStatus());
});

router.post("/bot/start", async (req, res) => {
  const bot = getBot();
  const config = bot.getConfig();

  // Block live mode if security audit fails
  if (config.mode === "live") {
    const audit = runSecurityAudit();
    if (!audit.canRunLive) {
      res.status(403).json({
        error: "SECURITY_AUDIT_FAILED",
        message: "Bot tidak dapat dijalankan di live mode karena ada masalah keamanan kritis.",
        criticalFailures: audit.criticalFailures,
        checks: audit.checks,
        fix: "Perbaiki semua masalah kritis di atas, lalu coba lagi.",
      });
      return;
    }
  }

  await bot.start();
  res.json(bot.getStatus());
});

router.post("/bot/stop", (req, res) => {
  const bot = getBot();
  bot.stop();
  res.json(bot.getStatus());
});

router.post("/bot/emergency-stop", async (req, res) => {
  const bot = getBot();
  await bot.emergencyStop();
  res.json(bot.getStatus());
});

// Manual trade endpoint: force buy a specific token
router.post("/bot/manual-buy", async (req, res) => {
  const bot = getBot();
  const { tokenAddress, amountEth } = req.body as { tokenAddress?: string; amountEth?: number };

  if (!tokenAddress) {
    res.status(400).json({ error: "tokenAddress required" });
    return;
  }

  try {
    const result = await bot.manualBuy(tokenAddress, amountEth);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Manual buy failed" });
  }
});

// Manual sell: sell token directly from wallet (even without tracked position)
router.post("/bot/manual-sell", async (req, res) => {
  const bot = getBot();
  const { tokenAddress, amountEthEstimate } = req.body as { tokenAddress?: string; amountEthEstimate?: number };

  if (!tokenAddress) {
    res.status(400).json({ error: "tokenAddress required" });
    return;
  }

  try {
    const result = await bot.manualSell(tokenAddress, amountEthEstimate);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Manual sell failed" });
  }
});

router.get("/bot/watchdog", (req, res) => {
  const watchdog = getWatchdog();
  res.json(watchdog.getStats());
});

export default router;
