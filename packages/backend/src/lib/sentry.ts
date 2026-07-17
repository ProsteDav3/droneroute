import * as Sentry from "@sentry/node";

/**
 * Server-side error tracking — same optional-feature-via-env-var pattern as
 * the SMTP/DJI Cloud bridges (see services/emailService.ts,
 * services/djiCloud.ts): unset `SENTRY_DSN` and this is a complete no-op,
 * so a self-hosted install with no Sentry account configured pays no cost.
 *
 * Must run before any other module is imported that Sentry needs to
 * instrument, so `initSentry()` is called as the very first line of
 * index.ts — see that file for why a separate `--import` preload isn't
 * used here (this app's single-process, non-serverless deployment doesn't
 * need the extra instrumentation Sentry's preload hook buys you).
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.1,
  });
}

export const isSentryEnabled = (): boolean => Boolean(process.env.SENTRY_DSN);

export { Sentry };
