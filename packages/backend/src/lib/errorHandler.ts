import { randomUUID } from "crypto";
import type { ErrorRequestHandler, Request, RequestHandler } from "express";

/**
 * pino-http's own default `genReqId` does *not* honor an inbound
 * `X-Request-Id` header — it just increments a counter per request, which
 * only exists to guarantee non-empty ids and provides no correlation to
 * whatever request id an upstream proxy/load balancer (e.g. Fly.io's edge)
 * may have already assigned. Reusing an inbound id when present lets a
 * single request be traced through every hop, not just from this service
 * inward; a fresh UUID is generated only when no such header was sent.
 */
export function genReqId(req: Request): string {
  const existing = req.headers["x-request-id"];
  if (typeof existing === "string" && existing.length > 0) return existing;
  return randomUUID();
}

/**
 * Echoes pino-http's per-request `req.id` back to the client as a response
 * header — visible in the browser's network tab even on a successful
 * response, not just in an error body. Requires `pinoHttp()` to be mounted
 * earlier in the middleware chain (it assigns `req.id`, reusing an inbound
 * `X-Request-Id` header if the caller/proxy already set one).
 */
export const requestIdHeaderMiddleware: RequestHandler = (req, res, next) => {
  res.setHeader("X-Request-Id", String(req.id));
  next();
};

/**
 * Global error handler — logs the full error server-side via the
 * request-scoped logger (`req.log`, bound to this request's `req.id` by
 * pino-http) and never leaks details (stack traces, SQL, internal paths) to
 * the client. The response carries `requestId` (matching the
 * `X-Request-Id` header set by `requestIdHeaderMiddleware`) so a user
 * reporting an opaque "Internal server error" can hand it to support, who
 * can then grep server logs for that exact id instead of guessing which
 * request among many matches the report.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  req.log.error({ err }, "Unhandled error");
  if (res.headersSent) {
    next(err);
    return;
  }
  // Preserve client-error status codes (e.g. malformed JSON, payload too large)
  // but never echo the underlying message, stack trace or internal details.
  const status =
    (err as { status?: number; statusCode?: number })?.status ??
    (err as { statusCode?: number })?.statusCode ??
    500;
  const isClientError = status >= 400 && status < 500;
  res.status(isClientError ? status : 500).json({
    error: isClientError ? "Bad request" : "Internal server error",
    requestId: String(req.id),
  });
};
