import { Router } from "express";
import { logger } from "../lib/logger.js";

const router = Router();

const DASHBOARD_PASSWORD = process.env["DASHBOARD_PASSWORD"] || "scalper2024";

if (!process.env["DASHBOARD_PASSWORD"]) {
  logger.warn("DASHBOARD_PASSWORD env var not set — using default password 'scalper2024'. Set it for production!");
}

router.post("/auth/login", (req, res) => {
  const { password } = req.body;

  if (!password || typeof password !== "string") {
    res.status(400).json({ error: "Password required" });
    return;
  }

  if (password !== DASHBOARD_PASSWORD) {
    logger.warn({ ip: req.ip }, "Failed login attempt");
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  req.session.authenticated = true;
  req.session.authenticatedAt = new Date().toISOString();
  req.session.save((err) => {
    if (err) {
      logger.error({ err }, "Session save error");
      res.status(500).json({ error: "Session error" });
      return;
    }
    logger.info({ ip: req.ip }, "Successful login");
    res.json({ success: true, authenticatedAt: req.session.authenticatedAt });
  });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      logger.error({ err }, "Session destroy error");
      res.status(500).json({ error: "Logout failed" });
      return;
    }
    res.clearCookie("scalper.sid");
    res.json({ success: true });
  });
});

router.get("/auth/me", (req, res) => {
  if (req.session?.authenticated) {
    res.json({ authenticated: true, authenticatedAt: req.session.authenticatedAt });
  } else {
    res.status(401).json({ authenticated: false });
  }
});

export default router;
