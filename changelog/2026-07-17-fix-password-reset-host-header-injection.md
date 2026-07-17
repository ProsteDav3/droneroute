## Summary

Fix a Host Header Injection vulnerability in the password-reset flow: the reset link's base URL was derived from the incoming request's `Host` header, which is attacker-controlled and could be used to poison a reset email with a link to a phishing host.

## Changes

- `resolveAppUrl` no longer falls back to `req.protocol`/`req.get("host")` — it now only uses the `APP_URL` environment variable
- If `APP_URL` isn't configured, `/forgot-password` still responds with the same generic success message (no account-enumeration signal), but logs a server-side error instead of building/sending a link with an untrusted host
- `APP_URL` is now a required setting for self-hosted deployments that want working password reset (documented in `.env.example`); the production Fly deployment already has it set
- Swept the remaining `console.error` calls in the password-reset code path to the structured `pino` logger, matching the rest of the backend
