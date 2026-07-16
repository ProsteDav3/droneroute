# Content Security Policy and hardened response headers

Enabled a real Content Security Policy instead of running with it disabled.
Previously CSP was switched off entirely because Mapbox GL's web workers
and, in cloud mode, Google Sign-In hadn't been reconciled with a strict
policy — this replaces that with an allowlist scoped to exactly what the
app needs.

## What changed

- `script-src`, `connect-src`, `img-src`, `style-src`, `font-src`, and
  `worker-src` now allowlist only: same-origin, Mapbox's tile/style/
  geocoding/telemetry hosts, blob: workers (Mapbox GL's rendering workers),
  Google's Identity Services script/iframe (cloud-mode Google sign-in), and
  Google Fonts.
- `object-src 'none'` and `base-uri 'self'` added as standard hardening.
- Added `Permissions-Policy: camera=(), microphone=(), geolocation=()` —
  the app has no legitimate use for any of the three.
- Set `Referrer-Policy: strict-origin-when-cross-origin` explicitly.
- `X-Content-Type-Options: nosniff` was already on by default via helmet;
  unchanged.

## Compatibility

- COEP (`crossOriginEmbedderPolicy`) stays disabled — unrelated to CSP, and
  enabling it previously conflicted with the Mapbox GL / Google OAuth
  combination in this app.
- The map, geocoding search, and Google sign-in were checked against the
  new allowlist by tracing every external host they actually call (grepped
  for `mapbox.com`/`fetch`/`XMLHttpRequest` across the frontend and Mapbox
  GL/`@mapbox/mapbox-gl-geocoder`/`@react-oauth/google`'s own network
  calls) rather than guessed.
