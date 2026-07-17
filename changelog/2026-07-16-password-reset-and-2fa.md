# Password reset, two-factor authentication, and session invalidation

Added three related account-security features to self-hosted email/password
accounts: a self-service password reset flow, optional TOTP-based
two-factor authentication, and immediate session invalidation whenever a
password changes.

## Password reset

- "Zapomenuté heslo?" on the sign-in screen (both the sign-in gate and the
  in-app sign-in modal) opens a small form: enter your email, get a generic
  "if that email exists, a reset link was sent" response either way — the
  endpoint never reveals whether an account exists.
- The emailed (or manually relayed, see "Notes" below) link points at
  `/reset-password?token=...`, a new standalone page where you set a new
  password. The link expires after 1 hour and can only be used once.
- `POST /api/auth/forgot-password` and `POST /api/auth/reset-password` are
  both rate-limited like the existing login/register endpoints.

## Two-factor authentication (TOTP)

- New "Dvoufázové ověření" section in account settings → Account tab
  (self-hosted only, same as change-password). Turning it on shows a
  manual-entry key for any TOTP authenticator app (Google Authenticator,
  Authy, etc.) and requires confirming one generated code before it takes
  effect — so a mistyped/never-completed setup can't lock you out.
- Once enabled, signing in with the correct email+password now returns a
  short-lived challenge instead of a session token; a second step (entering
  the current code from your authenticator app) completes sign-in. Both the
  sign-in gate and the sign-in modal support this second step.
- Turning it back off requires your current password.

## Session invalidation

- Both changing your password from account settings and completing a
  password reset now immediately invalidate every session token issued
  before that point — including the one used to make the request itself.
  A device that was already signed in with the old password gets logged
  out immediately rather than staying valid until its token naturally
  expires (previously up to 7 days later).

## Notes

- No email service is configured out of the box. If `SMTP_HOST`/`SMTP_PORT`/
  `SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` aren't set, forgot-password still
  succeeds from the requester's perspective — the reset link is logged
  server-side (prefixed `[password-reset]`) for an operator to manually
  relay, the same honest-degradation pattern already used by the DJI Cloud
  bridge when its own env vars are unset.
- Both features are self-hosted-only, matching change-password: cloud-mode
  (Google sign-in) accounts have no local password to reset or confirm a
  2FA change with.
