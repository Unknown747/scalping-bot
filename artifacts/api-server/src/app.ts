import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import router from "./routes/index.js";
import authRouter from "./routes/auth.js";
import { logger } from "./lib/logger.js";
import { requireAuth } from "./middleware/auth.js";
import { runSecurityAudit } from "./scalping/SecurityAudit.js";

const SESSION_SECRET = process.env["SESSION_SECRET"];
if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware
app.use(
  session({
    secret: SESSION_SECRET,
    name: "scalper.sid",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

// Public routes — auth endpoints, health check, and security audit
app.use("/api", authRouter);
app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));

// Security audit is public — shows only pass/fail status, no sensitive values
app.get("/api/security-audit", (_req, res) => {
  const result = runSecurityAudit();
  res.status(result.canRunLive ? 200 : 503).json(result);
});

// All other /api routes require authentication
app.use("/api", requireAuth, router);

export default app;
