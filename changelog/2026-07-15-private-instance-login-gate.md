## Summary

Turns the app into a private, invite-only tool instead of a publicly
registerable product. Self-hosted deployments used to let anyone create an
account and use the mission planner anonymously; now the entire app requires
signing in, and after the very first (admin) account is created, public
registration closes for good.

## Changes

- The whole app is now gated behind sign-in — a new `LoginGate` full-screen
  component replaces the mission planner, sidebar, and everything else
  whenever there's no auth token. The one exception is a shared mission link
  (`/shared/...`), which stays publicly viewable without an account since
  that's the point of sharing a link.
- Backend: `POST /api/auth/register` (self-hosted email/password mode) now
  only succeeds once — when the `users` table is empty. That first account
  is automatically made an admin. Every registration attempt after that gets
  a 403 ("Registration is closed. Ask the site owner for an account.").
  Google sign-in (cloud mode) is unaffected by this change.
- New `GET /api/auth/status` reports whether registration is still open, so
  the frontend gate knows whether to show a "create the admin account" form
  or a plain sign-in form.
- The admin panel (user management, ban/unban, promote/demote) used to be
  entirely unreachable in self-hosted mode (a blanket 404). It's now
  reachable for whoever is an admin, in both self-hosted and cloud mode.
- New `POST /api/admin/users` lets an admin create additional accounts
  directly (email + password) — the only way to add more users now that
  public registration is closed. Wired into the admin panel as an "Add user"
  button.
- The sign-in modal (`AuthModal`) no longer offers a "sign up" toggle in
  self-hosted mode, since public self-registration no longer exists as a
  normal user-facing action.
- `authStore` gained a `hasRestored` flag so a returning, already-logged-in
  user doesn't see a flash of the login screen while the token is being read
  back from localStorage on page load.

## Security review fixes

Both an independent code review and a security review flagged the same core
gap: with no secret involved, whoever's request reaches a freshly-deployed,
not-yet-bootstrapped instance first becomes the permanent admin — a real risk
for a few minutes between deploying and the owner's first sign-in on a
publicly reachable URL. Fixed with:

- Optional `BOOTSTRAP_TOKEN` env var: when set, the one-time founder
  registration must include a matching token, so only the operator (who set
  the env var) can complete the bootstrap. `GET /auth/status` reports
  `requiresBootstrapToken` so the login screen knows to ask for it. Left
  unset, behavior is unchanged (open bootstrap) — this is an optional
  hardening step, not a breaking requirement.
- The bootstrap check-then-insert is now wrapped in a `db.transaction(...).immediate()`
  call, closing a (currently theoretical, single-machine-deployment) race
  where two backend processes sharing one DB file could both see an empty
  `users` table and both insert a "founder" admin.
- Self-hosted installs that upgrade with existing users but no admin (e.g.
  from before `is_admin` existed) previously had no recovery path — the
  admin panel would be permanently unreachable. `ADMIN_EMAIL` now also
  promotes a matching account to admin on self-hosted password login,
  mirroring the mechanism that already existed for cloud-mode Google
  sign-in.
- `GET /auth/status` no longer sits behind `authLimiter` (which exempts
  successful requests and so never actually limited this always-200 route);
  it's covered by the app-wide `globalLimiter` instead.

## Known limitations

- `GET /auth/status` is still unauthenticated by design (the frontend needs
  it before anyone is logged in), so it reveals whether an instance has been
  claimed yet. Setting `BOOTSTRAP_TOKEN` before first deploy closes the
  practical risk this creates.
- There's no invite-link/email flow yet — the admin sets a temporary
  password directly when creating an account, and the new user changes it
  after their first sign-in.
- If `ADMIN_EMAIL` is set and `NODE_ENV` isn't `production` (self-hosted
  Docker image sets it correctly, but a manual/dev run could omit it), an
  existing dev-only seed in `models/db.ts` creates an account for that email
  with the email itself as the password. This is pre-existing behavior, not
  introduced here, but worth knowing given `ADMIN_EMAIL` now also affects
  self-hosted login.

## Tests

- `packages/backend/src/routes/auth.test.ts` (rewritten): registration
  succeeds once and the first account becomes admin, closes after that,
  `GET /auth/status` reflects open/closed correctly, existing login
  failure-path tests (wrong password, banned account, account-existence
  non-leak) unchanged but now seed fixture users via direct DB insert
  instead of public registration.
- `packages/backend/src/routes/admin.test.ts` (new): admin guard is
  reachable in self-hosted mode (401 unauthenticated, 403 non-admin, 200
  admin), `POST /admin/users` validation (400 missing fields/short password,
  409 duplicate email, 403 non-admin caller) and happy path, plus basic
  coverage of the existing ban/unban/promote/demote actions now that the
  router is reachable.
- `packages/backend/src/routes/templatePresets.test.ts`: updated to create
  its second test user via direct DB insert, since it previously relied on
  unlimited public registration.
- `packages/frontend/src/store/authStore.test.ts` (new): `restore()` sets
  `hasRestored` in both the restored-session and no-session cases;
  `register()` stores the token/admin flag on success and resets
  `isLoading` and rethrows when registration is closed.
- `packages/backend/src/routes/auth.bootstrap.test.ts` (new): `BOOTSTRAP_TOKEN`
  is required and validated when set (`requiresBootstrapToken` reporting,
  rejects missing/wrong token, succeeds with the correct one, stays closed
  afterward regardless of token); `ADMIN_EMAIL` promotes a matching
  self-hosted account to admin on login and leaves a non-matching one alone.
- `npm run build`, `npm run lint`, `npx prettier --check`,
  `npm run test -w packages/backend` (82/82),
  `npm run test -w packages/frontend` (61/61).
