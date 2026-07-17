## Summary

The browser session now lives in a secure, httpOnly cookie instead of `localStorage` — the session token is no longer readable from JavaScript at all, closing off a class of session-theft risk if the app were ever compromised by XSS.

## Changes

- `packages/backend/src/lib/authCookie.ts` — new `setAuthCookie`/`clearAuthCookie` helpers (`httpOnly`, `sameSite: "lax"`, `secure` by default in production, overridable via `COOKIE_SECURE`).
- Every route that issues a session JWT (`/auth/login`, `/auth/register`, `/auth/google`, `/auth/2fa/login`) now also sets the cookie, in addition to still returning the token in the JSON body (unchanged, for the CLI and any script/API client).
- New `POST /api/auth/logout` clears the cookie server-side — the frontend's JS can't clear an httpOnly cookie itself.
- `authMiddleware`/`optionalAuth` now accept the session either via the cookie (browser) or `Authorization: Bearer` (CLI/API clients) — nothing changes for the CLI.
- Frontend: `authStore.ts` no longer stores the raw token in `localStorage` or in JS-readable state at all; `restore()` is now async and confirms the session via `GET /api/auth/me` (which now also returns `userId`) instead of reading `localStorage` synchronously. `logout()` now calls the new logout endpoint.
- `api.ts`'s `fetch` calls use `credentials: "include"` so the cookie is sent even in the split-deployment (`CORS_ORIGIN`) case.
- One-time transition note: existing signed-in users won't have a cookie yet after this deploys, so they'll need to log in again once — nothing is lost, and the CLI/any already-issued token keeps working unchanged via the header path in the meantime.
