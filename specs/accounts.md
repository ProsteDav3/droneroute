# Accounts

Sign in to use the app and save your missions across devices. Self-hosted
installations are private by default: the app is not usable without an
account.

## What you can do

- **Log in** with your email and password, or with Google (in cloud mode).
- **Change your password** from the account settings.
- **Reset a forgotten password** from the sign-in screen — see "Forgotten password" below.
- **Turn on two-factor authentication** for extra protection on top of your password — see "Two-factor authentication" below.
- **Admins can create accounts for other people** — see "Registration" below.

## How it works

1. Open the app. If you're not signed in, you'll see a sign-in screen instead
   of the mission planner.
2. Log in with your email and password (or Google, in cloud mode).
3. Once logged in, your missions are saved to your account and accessible
   from any device.

A shared mission link (`/shared/...`) is the one exception — anyone with the
link can view it without signing in, since that's the whole point of sharing.

Your session is kept in a secure cookie the browser manages on its own —
there's nothing for you to configure, and it means logging in on one tab
keeps you logged in everywhere in that browser. Signing out clears it
immediately.

## Registration

Self-hosted installations are **not publicly registerable**. The very first
account ever created (via the sign-in screen, when no account exists yet)
automatically becomes the admin. After that, registration closes: new
accounts can only be created by an admin, from the admin panel's "Add user"
button. This keeps a self-hosted deployment private to the people the admin
chooses to invite, instead of open to anyone who finds the URL.

Cloud-mode (Google sign-in) deployments are unaffected by this — anyone can
still sign in with Google there.

### Bootstrap token (operator setup)

Because the founder account is normally just "whoever registers first,"
setting the `BOOTSTRAP_TOKEN` environment variable before the first deploy
adds a required secret to that one-time registration, so a stranger who
finds a freshly-deployed instance before you've signed in can't claim the
admin account for themselves. If you don't set it, bootstrap the admin
account yourself as soon as possible after deploying.

If a self-hosted install ever ends up with users but no admin at all (e.g.
upgrading from a version before admin accounts existed), set `ADMIN_EMAIL`
to your account's email and log in — that promotes it to admin, the same
mechanism already used to auto-promote the configured admin on first Google
sign-in in cloud mode.

## Forgotten password

Available for self-hosted email/password accounts (not cloud-mode Google
sign-in, which has no local password). Click "Zapomenuté heslo?" on the
sign-in screen, enter your email, and you'll get the same generic
confirmation message whether or not that email has an account — this
prevents someone from using the form to check which emails are registered.

If the account exists, a reset link is emailed to it (valid for 1 hour,
usable once). If the deployment hasn't configured an email server yet, the
operator gets the link logged on the server instead, to relay to you
manually — the request still succeeds either way, you may just need to ask
the operator for the link.

Following the link takes you to a page where you set a new password. Once
reset, every device that was signed in with the old password is signed out
immediately (see "Signing out other devices" below) — sign in again
everywhere with the new password.

## Two-factor authentication

Optional, for self-hosted email/password accounts. Turn it on from account
settings → Account tab: scan the shown key with any TOTP authenticator app
(Google Authenticator, Authy, etc.) — or enter it manually — then confirm
with the 6-digit code the app generates. It only takes effect once
confirmed, so a setup you never finish can't lock you out later.

Once enabled, signing in asks for your password as normal, then a second
step for the current code from your authenticator app. Turning it back off
requires re-entering your current password.

## Signing out other devices

Changing your password — whether from account settings or via a forgotten-
password reset — immediately signs out every device and browser tab that
was already signed in with the old password, not just the one making the
change. This is automatic; there's no separate "sign out everywhere"
button, because a password change already implies you want old sessions
gone.

## Settings dialog

Click the settings icon (gear) next to your avatar to open the settings dialog. It has three tabs:

- **Account** — view your email, change your password, and turn two-factor authentication on or off (self-hosted only).
- **Visualization** — choose your default view mode (2D or 3D), map style (satellite or street), and unit system (metric or imperial). These defaults are applied when the app loads.
- **Mission defaults** — set default values for new missions: drone model, payload, flight speed, takeoff height, max battery, height reference, heading mode, fly-to mode, finish action, RC lost action, and transit speed. When you create a new mission, these defaults are used instead of the hardcoded factory defaults.

Settings are saved to your account and sync across devices.

## Good to know

- Google sign-in is only available in cloud mode. Self-hosted installations use email and password only.
- If you register with the same email used for Google sign-in, the accounts are linked automatically.
- Your profile picture comes from Gravatar based on your email address.
- The unit system setting affects all distances, speeds, and heights throughout the app. Metric uses m, m/s, and km. Imperial uses ft, mph, and mi. Internal storage is always metric — the conversion happens at the display layer only.
- Administrators can create new accounts, manage users, ban accounts, and promote other users to admin — in both self-hosted and cloud mode.
- Every admin action that changes an account (create, ban, unban, promote, demote) is recorded in an audit log, viewable from the "Historie akcí" (action history) tab of the admin panel — who did what, to which account, and when.
- Sign-in, registration, password changes, password reset requests, and
  two-factor codes are all rate limited to protect against brute-force
  attempts. After too many failed attempts you'll be asked to wait a few
  minutes before trying again.
