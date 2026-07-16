# Structured logging, admin audit log, and a health endpoint

Backend observability improvements ahead of self-hosted and cloud
deployments getting real uptime monitoring.

## Why

There was no way to see what an admin had done to another account after the
fact, and no cheap endpoint an external uptime monitor could poll to know
the server (and its database) were actually healthy. Server logs were also
unstructured `console.log`/`console.error` calls, which are hard to ship to
a log aggregator or filter by severity.

## What changed

- **Structured logging.** The backend now logs through `pino` (pretty-printed
  in development, plain JSON in production) instead of raw `console.*`
  calls. `pino-http` adds per-request access logging, excluding
  `/api/health` so an uptime monitor polling every 1-5 minutes doesn't spam
  the log.
- **Admin audit log.** Every admin action that changes account state (ban,
  unban, promote, demote, create account) is now recorded in a new
  `audit_log` table with the acting admin, the affected account, and a
  timestamp. A new `GET /api/admin/audit-log` endpoint (admin-only,
  paginated) returns these entries with both emails joined in. The admin
  page has a new "Historie akcí" (action history) tab showing this log.
- **Health endpoint.** `GET /api/health` now returns `{ status, uptimeSeconds,
  dbOk, timestamp }` instead of a bare `{ status: "ok" }`. It runs a cheap
  `SELECT 1` against the database and reports `status: "degraded"` (still
  HTTP 200, so a monitor can tell "reachable but unhealthy" apart from
  "unreachable") if that fails. No authentication required, matching its use
  as an external uptime check.

## Compatibility

Existing callers of `GET /api/health` that only checked `status === "ok"`
keep working — the field is still present, just alongside new ones.
