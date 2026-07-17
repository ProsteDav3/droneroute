import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../services/authService.js";
import { getDb } from "../models/db.js";
import { AUTH_COOKIE_NAME } from "../lib/authCookie.js";

export interface AuthRequest extends Request {
  userId?: string;
  isAdmin?: boolean;
}

/**
 * The session JWT arrives one of two ways: the `droneroute_token` httpOnly
 * cookie (the browser SPA, set by auth.ts on login/register/etc.), or an
 * `Authorization: Bearer <token>` header (the CLI and any script/API
 * client, which can't receive or send cookies the way a browser does). The
 * cookie is checked first since it's what the SPA now uses.
 */
function extractToken(req: Request): string | null {
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
  if (typeof cookieToken === "string" && cookieToken) return cookieToken;

  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);

  return null;
}

export function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const token = extractToken(req);
  if (!token) {
    res
      .status(401)
      .json({ error: "Chybí nebo je neplatná autorizační hlavička" });
    return;
  }

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
  const token = extractToken(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.userId = payload.userId;
    }
  }
  next();
}
