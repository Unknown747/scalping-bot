import { Router } from "express";
import * as db from "../scalping/database.js";

const router = Router();

router.get("/tokens/scanned", (req, res) => {
  const limit = parseInt((req.query["limit"] as string) || "20", 10);
  const tokens = db.getScannedTokens(Math.min(limit, 100));
  res.json(tokens);
});

export default router;
