## Summary

SkyRoute is now an installable PWA, and its interface loads even without a network connection.

## Changes

- `vite-plugin-pwa` (generateSW strategy, `autoUpdate` registration) precaches the built app shell (JS/CSS/HTML/icons) — the editor's UI now loads offline or on a flaky connection.
- Deliberately does **not** cache any `/api/*` response — this is a flight-planning tool, and silently serving stale mission, weather, or airspace data while "offline" would be actively misleading. Every API call still goes live-or-fails exactly as before; only the static shell is precached.
- New web app manifest (`manifest.webmanifest`) — SkyRoute can be installed to the home screen / as a desktop app, using the existing SkyRoute icon and navy theme color.
- New `OfflineBanner` — shown whenever the browser reports no network connection, so the save/load/weather/airspace limitations while offline are visible instead of silently-failing requests.
- Raised workbox's precache size limit (default 2MB) to fit the app's current ~2.5MB main JS chunk — the existing bundle-size warning about splitting that chunk further is tracked separately (see task #8, splitting oversized files).
