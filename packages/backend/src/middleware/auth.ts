import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../services/authService.js";
import { getDb } from "../models/db.js";

export interface AuthRequest extends Request {
  userId?: string;
  isAdmin?: boolean;
}

export function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res
      .status(401)
      .json({ error: "Chybí nebo je neplatná autorizační hlavička" });
    return;
  }

  const token = header.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Neplatný nebo vypršený token" });
    return;
  }

  // Check if user is banned
  const db = getDb();
  const user = db
    .prepare(
      "SELECT is_banned, is_admin, email_verified, token_version FROM users WHERE id = ?",
    )
    .get(payload.userId) as any;
  if (!user) {
    res.status(401).json({ error: "Uživatel nenalezen" });
    return;
  }
  if (user.is_banned) {
    res.status(403).json({ error: "Váš účet byl pozastaven", banned: true });
    return;
  }

  // A password change/reset bumps token_version, which immediately
  // invalidates every JWT issued before that point — even ones that
  // haven't otherwise expired yet — without needing a server-side
  // session/token blocklist.
  if ((user.token_version ?? 0) !== payload.tokenVersion) {
    res.status(401).json({ error: "Neplatný nebo vypršený token" });
    return;
  }

  // In cloud mode, require email verification
  const selfHosted = (process.env.SELF_HOSTED ?? "true") === "true";
  if (!selfHosted && !user.email_verified) {
    res.status(403).json({
      error:
        "E-mail není ověřen. Přihlaste se prosím přes Google pro ověření účtu.",
      code: "EMAIL_NOT_VERIFIED",
    });
    return;
  }

  req.userId = payload.userId;
  req.isAdmin = !!user.is_admin;
  next();
}

/** Optional auth - sets userId if token present, but doesn't reject */
export function optionalAuth(
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7);
    const payload = verifyToken(token);
    if (payload) {
      req.userId = payload.userId;
    }
  }
  next();
}
