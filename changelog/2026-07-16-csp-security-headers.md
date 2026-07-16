# Content Security Policy and hardened response headers

Enabled a real Content Security Policy instead of running with it disabled.
Previously CSP was switched off entirely because Mapbox GL's web workers
and, in cloud mode, Google Sign-In hadn't been reconciled with a strict
policy — this replaces that with an allowlist for the hosts the app
actually talks to, tightened wherever the directive allows it.

## What changed

- `script-src`, `connect-src`, `font-src`, and `worker-src` are scoped
  tightly: same-origin, Mapbox's tile/style/geocoding/telemetry hosts,
  blob: workers (Mapbox GL's rendering workers), Google's Identity
  Services script/iframe (cloud-mode Google sign-in), and Google Fonts.
- `style-src` still needs `'unsafe-inline'` (Tailwind and several UI
  libraries set inline `style` attributes at runtime) alongside Google
  Fonts' stylesheet host — not fully locked down, but scoped beyond the
  previous "disabled entirely."
- `img-src` allows `https:` broadly rather than an exact host list, since
  Mapbox raster/vector tiles and marker/attribution imagery are served
  from multiple Mapbox-operated subdomains that aren't practical to
  enumerate exhaustively; `data:`/`blob:` are also allowed for
  client-generated map imagery.
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
