## Summary

Fix a production incident where the auth-hardening release logged out every existing user — all authenticated requests (mission saves, DJI Cloud panels, preferences, etc.) started failing with "Neplatný nebo vypršený token" for anyone whose browser held a session token from before that deploy.

## Root cause

The 2FA-bypass fix added an `audience` claim to session JWTs, and `jwt.verify(token, JWT_SECRET, { audience: SESSION_TOKEN_AUDIENCE })` rejects any token that doesn't carry a matching `aud` claim — including tokens with _no_ `aud` claim at all, i.e. every token issued by the previous server version. The `tokenVersion ?? 0` fallback that was supposed to make this upgrade non-disruptive never got a chance to run, because `jwt.verify` itself threw first.

## Fix

`verifyToken` no longer passes `audience` to `jwt.verify` — it decodes the token first, then explicitly rejects only tokens carrying the 2FA-challenge audience (the actual security property that mattered), and falls through to the existing `tokenVersion ?? 0` legacy handling for everything else. Same protection against the 2FA bypass, none of the collateral damage to legitimate pre-upgrade sessions.

Existing sessions self-heal automatically once this deploys — no action needed from users, though anyone still seeing the error can log out and back in for an immediate fix.
