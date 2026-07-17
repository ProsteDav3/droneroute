## Summary

Split the admin panel, routes list, shared/embed mission views, and the password-reset page out of the main JS bundle so a visitor who only ever opens the mission editor never downloads their code.

## Changes

- `AdminPage`, `RoutesPage`, `SharedMissionPage`, and `EmbedMissionPage` are now `React.lazy()`-loaded in `App.tsx`, each wrapped in its own `Suspense` boundary with a small centered spinner fallback
- `ResetPasswordPage` is lazy-loaded the same way in `AppWrapper.tsx`
- No behavior change — same routing logic, just deferred code loading
