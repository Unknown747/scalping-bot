import { Router } from "express";
import axios from "axios";
import * as db from "../scalping/database.js";
import { calculateMemeScore } from "../scalping/MemeScorer.js";

const router = Router();

router.get("/tokens/scanned", (req, res) => {
  const limit = parseInt((req.query["limit"] as string) || "20", 10);
  const tokens = db.getScannedTokens(Math.min(limit, 100));
  res.json(tokens);
});

// ─── Honeypot / FoT Blacklist endpoints ──────────────────────────────────────

router.get("/tokens/blacklist", (_req, res) => {
  res.json(db.getHoneypotBlacklist());
});

router.delete("/tokens/blacklist/:address", (req, res) => {
  const { address } = req.params;
  const removed = db.removeFromHoneypotBlacklist(address);
  if (removed) {
    res.json({ ok: true, message: `${address} dihapus dari blacklist` });
  } else {
    res.status(404).json({ ok: false, message: "Alamat tidak ditemukan di blacklist" });
  }
});

router.delete("/tokens/blacklist", (_req, res) => {
  const count = db.clearHoneypotBlacklist();
  res.json({ ok: true, deleted: count });
});

// Manual add to blacklist
router.post("/tokens/blacklist", (req, res) => {
  const { address, symbol, reason } = req.body as { address?: string; symbol?: string; reason?: string };
  if (!address || !symbol) {
    res.status(400).json({ error: "address dan symbol wajib diisi" });
    return;
  }
  db.addToHoneypotBlacklist(address, symbol, reason || "manual");
  res.json({ ok: true });
});

// ─── AI Score diagnostic ──────────────────────────────────────────────────────

router.get("/tokens/score/:address", async (req, res) => {
  const { address } = req.params;
  try {
    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${address}`,
      { timeout: 8000 }
    );
    const pairs: any[] = (response.data?.pairs || []).filter(
      (p: any) => p?.chainId === "base"
    );
    if (pairs.length === 0) {
      res.status(404).json({ error: "No Base pairs found for this token" });
      return;
    }
    const best = pairs.reduce((a: any, b: any) =>
      (b.liquidity?.usd || 0) > (a.liquidity?.usd || 0) ? b : a
    );

    const ageMinutes = best.pairCreatedAt
      ? (Date.now() - best.pairCreatedAt) / 60000
      : 9999;
    const buySell5m = best.txns?.m5 || { buys: 0, sells: 0 };
    const buySellRatio =
      buySell5m.sells > 0
        ? buySell5m.buys / buySell5m.sells
        : buySell5m.buys > 0
        ? 3
        : 1;

    const tokenData = {
      ageMinutes,
      liquidityUSD: best.liquidity?.usd || 0,
      volume5mUSD: best.volume?.m5 || 0,
      priceChange5m: best.priceChange?.m5 || 0,
      buySellRatio5m: buySellRatio,
    };

    const result = calculateMemeScore(tokenData, 70);

    res.json({
      address,
      symbol: best.baseToken?.symbol || "UNKNOWN",
      name: best.baseToken?.name || "UNKNOWN",
      priceUsd: parseFloat(best.priceUsd) || 0,
      liquidityUsd: tokenData.liquidityUSD,
      volume5mUsd: tokenData.volume5mUSD,
      priceChange5m: tokenData.priceChange5m,
      buySellRatio5m: tokenData.buySellRatio5m,
      ageMinutes: tokenData.ageMinutes,
      memeScore: result.score,
      memeScoreBreakdown: result.breakdown,
      passed: result.passed,
      aiStatus: "ok",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Score calculation failed", aiStatus: "error" });
  }
});

export default router;
