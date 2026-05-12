import { Router } from "express";
import * as db from "../scalping/database.js";
import { getBot } from "../botInstance.js";

const router = Router();

router.get("/trades", (req, res) => {
  const filter = (req.query["filter"] as string) || "today";
  const limit = Math.min(parseInt((req.query["limit"] as string) || "100", 10), 500);
  const page = Math.max(parseInt((req.query["page"] as string) || "1", 10), 1);
  const validFilters = ["today", "week", "all"];
  const safeFilter = validFilters.includes(filter) ? (filter as "today" | "week" | "all") : "today";

  // mode param: "live" | "paper" | "all" — defaults to current bot mode if not provided
  const modeParam = req.query["mode"] as string | undefined;
  let modeFilter: "live" | "paper" | undefined;
  if (modeParam === "live") {
    modeFilter = "live";
  } else if (modeParam === "paper") {
    modeFilter = "paper";
  } else if (modeParam === "all") {
    modeFilter = undefined; // no filter
  } else {
    // backward compat: default to current bot mode
    const bot = getBot();
    modeFilter = bot.getConfig().mode as "live" | "paper";
  }

  const result = db.getTrades(safeFilter, limit, page, modeFilter);
  res.json(result);
});

export default router;
