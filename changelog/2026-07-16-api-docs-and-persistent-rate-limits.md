# API docs and a persistent rate-limit store

Added interactive API documentation and swapped the rate limiter's storage
from in-memory to SQLite-backed.

## Why

The in-memory rate-limit store reset every time the server redeployed or a
Fly.io machine cold-started after `auto_stop_machines` idled it out — so a
client that had already used up part of its quota effectively got a fresh
one on the next deploy. Separately, the API had no documentation beyond
reading route source directly.

## What changed

- **OpenAPI/Swagger docs** — `swagger-jsdoc` + `swagger-ui-express`,
  documented via `@openapi` JSDoc blocks co-located with each route handler
  (auth, missions, kmz, dji-cloud, weather, airspace, template-presets,
  admin). Served at `/api/docs` (UI) and `/api/docs.json` (raw spec), gated
  behind `NODE_ENV !== "production"` since the spec exposes the full
  internal API shape.
- **SQLite-backed rate-limit store** — a new `SqliteRateLimitStore` class
  implementing `express-rate-limit`'s `Store` interface, backed by a new
  `rate_limit_hits` table. Hit counts now survive redeploys and cold
  starts. Each limiter (global, strict, airspace, weather, auth) gets its
  own store instance with a distinct key prefix; existing `windowMs`/`max`
  values and the test-environment `skip` bypass are unchanged. A
  background sweep clears expired rows every 5 minutes so the table
  doesn't grow unbounded.

## Not covered yet

A few narrower endpoints are left undocumented for a follow-up:
`auth/change-password`, `missions/segments`, `template-presets/:id`
(PUT/DELETE), and `admin/users/:id/{ban,unban,promote,demote}`.
