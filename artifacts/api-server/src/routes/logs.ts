import { Router } from "express";
import * as db from "../scalping/database.js";

const router = Router();

router.get("/logs", (req, res) => {
  const limit = Math.min(parseInt((req.query["limit"] as string) || "100", 10), 500);
  const page = Math.max(parseInt((req.query["page"] as string) || "1", 10), 1);
  const level = req.query["level"] as string | undefined;
  const logs = db.getLogs(limit, page, level);
  res.json(logs.reverse()); // chronological order
});

export default router;
