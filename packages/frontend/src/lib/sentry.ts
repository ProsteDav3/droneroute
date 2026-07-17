import * as Sentry from "@sentry/react";

/**
 * Client-side error tracking. Optional-feature-via-env-var, same pattern as
 * the backend (see backend/src/lib/sentry.ts): unset `VITE_SENTRY_DSN` and
 * this is a no-op, so a self-hosted install with no Sentry account
 * configured pays no cost — no extra network requests, no bundle behavior
 * change beyond the (already code-split, see App.tsx) SDK weight.
 *
 * `VITE_SENTRY_DSN` rather than `SENTRY_DSN`: Vite only exposes `VITE_`-
 * prefixed variables to client code (see react/security.md — anything else
 * would be a silent no-op, not a security leak, since a DSN is meant to be
 * public, but the prefix is still required for Vite to bundle it in).
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
  });
}

export const isSentryEnabled = (): boolean =>
  Boolean(import.meta.env.VITE_SENTRY_DSN);

export { Sentry };
