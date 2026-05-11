import { Router } from "express";
import { getBot } from "../botInstance.js";
import * as db from "../scalping/database.js";
import { ClosePositionBody } from "@workspace/api-zod";

const router = Router();

router.get("/positions", (req, res) => {
  const positions = db.getPositions();
  res.json(positions.map((p) => ({
    ...p,
    tp1Hit: Boolean(p.tp1Hit),
    tp2Hit: Boolean(p.tp2Hit),
    trailingStopActive: Boolean(p.trailingStopActive),
  })));
});

router.post("/positions/:address/close", async (req, res) => {
  const { address } = req.params;
  const parsed = ClosePositionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const bot = getBot();
  await bot.closePosition(address, parsed.data.percent, "manual");

  const trades = db.getTrades("all", 1);
  res.json(trades[0] || { id: 0, tokenAddress: address, tokenSymbol: "UNKNOWN", tokenName: "UNKNOWN", entryPrice: 0, exitPrice: 0, amountEth: 0, profitPercent: 0, profitEth: 0, entryTime: new Date().toISOString(), exitTime: new Date().toISOString(), holdSeconds: 0, exitReason: "manual" });
});

export default router;
