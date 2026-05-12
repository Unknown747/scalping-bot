import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes/index.js";
import authRouter from "./routes/auth.js";
import { logger } from "./lib/logger.js";
import { requireAuth } from "./middleware/auth.js";
import { runSecurityAudit } from "./scalping/SecurityAudit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SESSION_SECRET = process.env["SESSION_SECRET"];
if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

const app: Express = express();

// Trust Nginx reverse proxy — required for correct IP, X-Forwarded-Proto, etc.
app.set("trust proxy", 1);

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
      // Set COOKIE_SECURE=true di .env hanya jika VPS pakai HTTPS.
      // Default false supaya VPS dengan HTTP biasa bisa login.
      secure: process.env["COOKIE_SECURE"] === "true",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

// Public routes — auth endpoints and security audit
app.use("/api", authRouter);

// Security audit is public — shows only pass/fail status, no sensitive values
app.get("/api/security-audit", (_req, res) => {
  const result = runSecurityAudit();
  res.status(result.canRunLive ? 200 : 503).json(result);
});

// All other /api routes require authentication
app.use("/api", requireAuth, router);

// ── Production: serve built dashboard static files ────────────────────────────
// In production, Vite builds the dashboard to artifacts/scalping-dashboard/dist/public.
// The API server serves those files directly, so only one process/port is needed.
if (process.env["NODE_ENV"] === "production") {
  const staticDir = path.resolve(__dirname, "../../scalping-dashboard/dist/public");
  app.use(express.static(staticDir, { maxAge: "1h", etag: true }));
  // SPA fallback — all non-API routes serve index.html
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
  logger.info({ staticDir }, "Serving dashboard static files (production mode)");
}

export default app;
