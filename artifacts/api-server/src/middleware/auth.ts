import type { Request, Response, NextFunction } from "express";

declare module "express-session" {
  interface SessionData {
    authenticated: boolean;
    authenticatedAt: string;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.authenticated) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized", message: "Login required" });
}
