import rateLimit from "express-rate-limit";
import { SqliteRateLimitStore } from "./sqliteRateLimitStore.js";

/**
 * Disable rate limiting for automated test runs, where every request
 * originates from the same loopback IP and a full suite legitimately fires
 * more calls than the production per-minute budget allows — otherwise tests
 * spuriously 429.
 *
 * Two ways in: `NODE_ENV=test` (vitest sets it), and an explicit
 * `DISABLE_RATE_LIMIT=1` for the Playwright harness, which runs the real
 * production build and must NOT claim `NODE_ENV=test` — that would also
 * silence the backend logs the CI job relies on when a run fails. Neither
 * is set by any deployment; the flag is opt-in and named for what it does,
 * so it can't be switched on by accident the way a general-purpose env
 * value could.
 */
const skipInTests = () =>
  process.env.NODE_ENV === "test" || process.env.DISABLE_RATE_LIMIT === "1";

/**
 * Each limiter gets its own `SqliteRateLimitStore` instance (own `prefix`,
 * own `windowMs`) backed by the shared `rate_limit_hits` SQLite table — see
 * `sqliteRateLimitStore.ts`. This replaces express-rate-limit's default
 * in-memory `MemoryStore`, which resets on every redeploy and doesn't
 * survive Fly.io's `auto_stop_machines` cold starts. A single `Store`
 * instance must never be shared across multiple limiters (they'd collide on
 * the same IP-derived key), so every limiter below constructs its own.
 */

/** Global rate limiter — 100 requests per minute per IP. */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  store: new SqliteRateLimitStore({ prefix: "global", windowMs: 60 * 1000 }),
  message: { error: "Příliš mnoho požadavků, zkuste to prosím znovu později" },
});

/** Strict rate limiter for expensive endpoints — 10 requests per minute per IP. */
export const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  store: new SqliteRateLimitStore({ prefix: "strict", windowMs: 60 * 1000 }),
  message: { error: "Příliš mnoho požadavků, zkuste to prosím znovu později" },
});

/**
 * Airspace rate limiter — 30 requests per minute per IP. Tighter than the
 * global limit because these requests proxy external (rate-limited) airspace
 * providers, but generous enough for normal map panning (the frontend pads and
 * caches bounds, so legitimate roaming stays well under this).
 */
export const airspaceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: new SqliteRateLimitStore({ prefix: "airspace", windowMs: 60 * 1000 }),
  message: { error: "Příliš mnoho požadavků, zkuste to prosím znovu později" },
});

/**
 * Weather rate limiter — 30 requests per minute per IP. Proxies MET Norway's
 * public API (rate-limited and cache-sensitive upstream), but the backend
 * already caches per-location responses server-side and the frontend caches
 * client-side too, so normal use stays well under this.
 */
export const weatherLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: new SqliteRateLimitStore({ prefix: "weather", windowMs: 60 * 1000 }),
  message: { error: "Příliš mnoho požadavků, zkuste to prosím znovu později" },
});

/**
 * Auth rate limiter — guards credential endpoints against brute force.
 * 10 failed attempts per 15 minutes per IP. Successful requests are not
 * counted, so legitimate users who sign in correctly are never throttled.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: skipInTests,
  store: new SqliteRateLimitStore({
    prefix: "auth",
    windowMs: 15 * 60 * 1000,
  }),
  message: { error: "Příliš mnoho pokusů, zkuste to prosím znovu později" },
});

/**
 * Comment rate limiter — posting a comment on a publicly shared mission
 * requires no account, so this is the main abuse control (alongside the
 * name/length validation in missionValidation.ts). 5 posts per minute per
 * IP is generous for a real visitor leaving feedback but blunt for a spam
 * script.
 */
export const commentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  message: { error: "Příliš mnoho komentářů, zkuste to prosím znovu později" },
});
