## Summary

Rebrands the deployed app from "DroneRoute" to "SkyRoute — Plánovač misí
firmy SkyData", replacing the logo and recoloring the UI to match
SkyData's own brand (navy background, cyan accent, Inter typeface) — the
same tokens used on skydata.cz. Also fixes the weather forecast's
day/date labels to always render in Czech, and makes the DJI Matrice 4T
the default drone with real DJI-published specs.

## Changes

- New logo: SkyData's drone-icon mark (`skyroute-icon.svg`, transparent
  background for inline use in the sidebar/dialogs/login screen;
  `skyroute-favicon.svg` for the browser tab, matching the icon SkyData
  already uses on their own site). The old `droneroute.png` mascot is
  removed.
- Every visible "DroneRoute" label renamed to "SkyRoute": sidebar header,
  About dialog, Welcome dialog, login/bootstrap gate (which also gained a
  "Plánovač misí firmy SkyData" tagline under the wordmark), the
  email-verification gate, and `index.html`'s title/meta/Open
  Graph/Twitter tags.
- Color theme (`index.css`) replaced with SkyData's own tokens: navy
  background/surface (`#0A1628` / `#0F2847`), cyan primary accent
  (`#00C2FF`), matching border/muted-text opacities — instead of the
  generic zinc/blue shadcn dark theme this started from. Applied to the
  base theme variables, every modal's glow shadow, the Mapbox
  popups/geocoder search box, and the primary toolbar (mission name field,
  Save/Export/Import buttons).
- Font switched from Switzer to Inter, matching skydata.cz.
- The About dialog was trimmed to fit a private company tool instead of a
  public open-source project: dropped the "star on GitHub", "vote on
  feature requests", and "buy me a coffee" donation links (not meaningful
  for an internal SkyData tool), kept the user guide and privacy-policy
  references — repointed from the upstream `fcsonline/droneroute` repo to
  this fork's own `ProsteDav3/droneroute` copies of `GUIDE.md`/`PRIVACY.md`,
  since this fork's privacy behavior (self-hosted, no data sent to the
  upstream project) differs from upstream's — and added a link to
  skydata.cz.
- Map-canvas colors (waypoint markers, flight-path lines, elevation-graph
  node states) switched from the old brand blue to the new cyan, so the
  most visible surface of the app matches the rebrand. Building footprints
  keep their existing blue — a separate content-type color, not the old
  brand color, so this actually improves differentiation between the two
  (previously identical) categories.
- Weather forecast day/date labels (`WeatherForecast.tsx`) are now always
  formatted in Czech regardless of the browser's locale, instead of
  falling back to English weekday/month abbreviations. Date labels on the
  routes list, shared-mission page, and admin page are likewise forced to
  `cs-CZ` instead of relying on the browser's ambient locale.
- DJI Matrice 4T is now the default drone for new missions (dropped the
  "(experimental)" label) and is the `DEFAULT_MISSION_CONFIG` default,
  with `maxBatteryMinutes` set to 35 — a safety margin below its
  DJI-published 46–49 min max flight time rather than the theoretical
  limit. Other specs (thermal camera FOV, etc.) were already correct,
  confirmed against DJI's official Matrice 4 series spec sheet.

## Known limitations

- Internal identifiers (localStorage keys like `droneroute_token`, CSS
  class names, the npm package/repo name) intentionally keep the
  `droneroute` name — renaming those would be a much larger, purely-cosmetic
  change with no user-facing benefit and a real risk of orphaning existing
  sessions/data.
- The sidebar's per-section accent colors are mostly unchanged (amber for
  POIs, red for obstacles, blue for buildings, indigo for presets, etc.) —
  they're a functional categorization scheme, not the primary brand color.
  Only "Waypoints" (the dominant map/flight-path content) moved to the new
  cyan, since it was flagged as unswept brand color and previously shared
  an identical blue with "Buildings"; recoloring the rest would remove
  useful visual differentiation rather than improve brand consistency.
- The Matrice 4T's `droneEnumValue`/`payloadEnumValue` (103) are still not
  part of any DJI-published WPML spec — this is a separate, unresolved
  risk from the physical specs (battery, speed, camera FOV), which are now
  confirmed. Treat generated KMZ files for this drone as untested until
  verified on real hardware. The frontend still surfaces this caveat in
  the solar-spacing recommendation panel (`THERMAL_CAMERA_FOV[103].experimental`).

## Tests

- `npm run build`, `npm run lint`, `npx prettier --check`,
  `npm run test -w packages/frontend` (61/61) and
  `npm run test -w packages/backend` (82/82), all passing.
