## Summary

Every API response now carries an `X-Request-Id` header, and error responses include the same id in the JSON body — a user reporting an opaque "Internal server error" can hand that id to support, who can then grep server logs for the exact request instead of guessing which one among many matches the report.

## Changes

- New `lib/errorHandler.ts`: `genReqId` (reuses an inbound `X-Request-Id` header from a proxy/load balancer when present, otherwise generates a fresh UUID — pino-http's own default `genReqId` doesn't honor an inbound header, it just increments a counter), `requestIdHeaderMiddleware`, and `errorHandler` (now logs via the request-scoped `req.log`, bound to that request's id, instead of the bare module-level logger).
- `index.ts` wires `genReqId` into the existing `pinoHttp()` setup and mounts the two new middlewares — the error-handling behavior itself (masked messages, preserved client-error status codes) is unchanged.
