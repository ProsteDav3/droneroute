import type { Response } from "express";

export const AUTH_COOKIE_NAME = "droneroute_token";

// Matches authService.ts's TOKEN_EXPIRY ("7d") — the cookie shouldn't outlive
// the JWT it carries, since an expired-but-still-present cookie would just
// mean every request hits verifyToken()'s expiry check instead of skipping
// the request entirely.
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether the auth cookie should be marked `Secure` (browser-only sends it
 * over HTTPS). Defaults to `NODE_ENV === "production"` — true for the cloud
 * deployment and the standard self-hosted docker-compose (which sets
 * `NODE_ENV=production`) — but overridable via `COOKIE_SECURE=false` for a
 * self-hosted instance running plain HTTP on a local network, where a
 * `Secure` cookie would never be sent back and would silently break login.
 */
function isSecureCookie(): boolean {
  if (process.env.COOKIE_SECURE === "false") return false;
  if (process.env.COOKIE_SECURE === "true") return true;
  return process.env.NODE_ENV === "production";
}

/**
 * Issues the session JWT as an httpOnly cookie, in addition to the token
 * still being returned in the JSON response body (the CLI and any
 * script/API client read it from there and send it back via `Authorization:
 * Bearer`, since they can't rely on browser cookie handling — see
 * middleware/auth.ts's `extractToken`). `sameSite: "lax"` is enough CSRF
 * protection for a JSON API that isn't submitted via a plain HTML form: it
 * blocks the cookie on cross-site XHR/fetch entirely, only allowing it on
 * top-level navigations, which this API never uses for state changes.
 */
export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: "lax",
    path: "/",
  });
}
