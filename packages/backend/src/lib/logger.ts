import pino from "pino";

/**
 * Structured application logger. Pretty-printed (colorized, human-readable)
 * in development; plain single-line JSON in production so log output can be
 * shipped to a log aggregator. Silenced under `vitest` (NODE_ENV=test) to
 * keep test output clean — matches the existing `skipInTests` convention in
 * middleware/rateLimit.ts.
 */
const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

export const logger = pino({
  level: isTest ? "silent" : process.env.LOG_LEVEL || "info",
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
});

/**
 * Paths to strip from every logged request before it's written out. Every
 * authenticated route requires `Authorization: Bearer <JWT>`, and pino-http's
 * default request serializer otherwise writes that header (i.e. the caller's
 * live token) verbatim into each log line — which in production ships
 * straight to a log aggregator. `cookie` is redacted defensively even though
 * this API doesn't currently rely on cookie-based auth.
 */
export const httpLogRedactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
];

/**
 * Routes that should never hit the per-request access log at all — as
 * opposed to `httpLogRedactPaths`, which only strips specific header values.
 *
 * - `/api/health` is polled by an uptime monitor every 1-5 minutes
 *   indefinitely; logging every hit would just be noise.
 * - `/api/shared/*` (share-link view + clone) embeds the share token in the
 *   URL path itself. That token is a bearer capability (anyone holding it
 *   can view the mission), so logging `req.url` for these routes would leak
 *   it the same way an unredacted Authorization header would.
 */
export function shouldSkipHttpLog(url: string | undefined): boolean {
  if (!url) return false;
  return url === "/api/health" || url.startsWith("/api/shared/");
}
