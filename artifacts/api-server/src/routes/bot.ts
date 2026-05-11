import { Router } from "express";
import { getBot } from "../botInstance.js";

const router = Router();

router.get("/bot/status", (req, res) => {
  const bot = getBot();
  res.json(bot.getStatus());
});

router.post("/bot/start", async (req, res) => {
  const bot = getBot();
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

export default router;
