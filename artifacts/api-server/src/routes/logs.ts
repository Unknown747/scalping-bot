import { Router } from "express";
import * as db from "../scalping/database.js";

const router = Router();

router.get("/logs", (req, res) => {
  const limit = parseInt((req.query["limit"] as string) || "100", 10);
  const logs = db.getLogs(Math.min(limit, 500));
  res.json(logs.reverse()); // chronological order
});

export default router;
