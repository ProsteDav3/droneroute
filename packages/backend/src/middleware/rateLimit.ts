import rateLimit from "express-rate-limit";

/** Global rate limiter — 100 requests per minute per IP. */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Příliš mnoho požadavků, zkuste to prosím znovu později" },
});

/** Strict rate limiter for expensive endpoints — 10 requests per minute per IP. */
export const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
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
  message: { error: "Příliš mnoho pokusů, zkuste to prosím znovu později" },
});
