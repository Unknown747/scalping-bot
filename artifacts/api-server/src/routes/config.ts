import { Router } from "express";
import { getBot } from "../botInstance.js";

const router = Router();

router.get("/config", (req, res) => {
  const bot = getBot();
  res.json(bot.getConfig());
});

router.put("/config", (req, res) => {
  const bot = getBot();
  const updated = bot.saveConfig(req.body);
  res.json(updated);
});

export default router;
