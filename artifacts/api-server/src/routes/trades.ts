import { Router } from "express";
import * as db from "../scalping/database.js";

const router = Router();

router.get("/trades", (req, res) => {
  const filter = (req.query["filter"] as string) || "today";
  const limit = Math.min(parseInt((req.query["limit"] as string) || "100", 10), 500);
  const page = Math.max(parseInt((req.query["page"] as string) || "1", 10), 1);
  const validFilters = ["today", "week", "all"];
  const safeFilter = validFilters.includes(filter) ? (filter as "today" | "week" | "all") : "today";
  const result = db.getTrades(safeFilter, limit, page);
  res.json(result);
});

export default router;
