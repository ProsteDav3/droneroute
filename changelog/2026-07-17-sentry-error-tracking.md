## Summary

Optional error tracking via Sentry, on both frontend and backend — previously, a production error meant nobody knew until a user reported it.

## Changes

- New `SENTRY_DSN` (backend) and `VITE_SENTRY_DSN` (frontend) environment variables, documented in `.env.example`. Same optional-feature pattern as SMTP/DJI Cloud/Mapbox: unset means fully disabled, zero cost.
- Backend: `Sentry.init()` runs first thing in `index.ts`; `Sentry.setupExpressErrorHandler` reports unhandled route errors before the app's own error-formatting middleware runs.
- Frontend: `Sentry.init()` runs before the app mounts; the whole component tree is wrapped in a `Sentry.ErrorBoundary`, which also gives the app its first real top-level error fallback UI (previously a render error meant a blank white screen) — reports to Sentry when configured, shows a "reload the page" screen either way.
