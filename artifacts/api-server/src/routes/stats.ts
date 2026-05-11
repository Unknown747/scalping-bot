import { Router } from "express";
import { getBot } from "../botInstance.js";

const router = Router();

router.get("/stats", async (req, res) => {
  const bot = getBot();
  const stats = await bot.buildStats();
  res.json(stats);
});

export default router;
