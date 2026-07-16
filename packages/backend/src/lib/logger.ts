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
