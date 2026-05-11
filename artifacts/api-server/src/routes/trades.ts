import { Router } from "express";
import * as db from "../scalping/database.js";

const router = Router();

router.get("/trades", (req, res) => {
  const filter = (req.query["filter"] as string) || "today";
  const limit = parseInt((req.query["limit"] as string) || "100", 10);
  const validFilters = ["today", "week", "all"];
  const safeFilter = validFilters.includes(filter) ? (filter as "today" | "week" | "all") : "today";
  const trades = db.getTrades(safeFilter, limit);
  res.json(trades);
});

export default router;
