import { Router } from "express";
import { runSecurityAudit } from "../scalping/SecurityAudit.js";

const router = Router();

router.get("/security-audit", (_req, res) => {
  const result = runSecurityAudit();
  const statusCode = result.canRunLive ? 200 : 503;
  res.status(statusCode).json(result);
});

export default router;
