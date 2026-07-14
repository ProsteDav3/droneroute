## Summary

Add support for open (non-360°) orbit arcs, remove the artificial 72-waypoint
cap on the Orbit template, add a one-click way to split a route into
consecutive single-leg missions, and add Matrice 4T / confirm Mini 4 Pro as
selectable drone models.

## Changes

- **Orbit template**: add `startAngleDeg` / `endAngleDeg` fields. When the
  requested sweep is 360° or more the template still generates a closed loop
  (unchanged behavior); otherwise it generates an open arc where the first and
  last waypoints land exactly on the requested start/end bearings. Useful for
  routes that intentionally exclude a segment (e.g. an obstacle or an
  unphotogenic side of a building).
- Remove the hardcoded 72-point cap on the Orbit template's "Points" field —
  the only remaining limit is the backend's existing 5000-waypoint mission
  ceiling.
- **New: "Export segments (.zip)"** — splits the current route into
  consecutive one-leg missions (WP1→WP2, WP2→WP3, ...) and downloads every
  leg as its own `.kmz`, bundled in a single zip. Every leg keeps the parent
  mission's config and POIs, so a shared `towardPOI` heading target stays
  identical across every leg regardless of which slice of the route it
  covers. Backend: `POST /api/kmz/generate-segments`.
- Add **DJI Matrice 4T** to the supported drone list. DJI has not published an
  official WPML `droneEnumValue` for the Matrice 4 Enterprise Series as of
  this writing, so the entry uses a placeholder value and is labeled
  "experimental" — verify on a non-critical test flight before relying on it.
- Confirmed DJI Mini 4 Pro was already supported; no code change needed there.

## Tests

- `packages/backend/src/routes/kmz.test.ts` — covers the new
  `/api/kmz/generate-segments` endpoint (rejects <2 waypoints; splits N
  waypoints into N-1 leg `.kmz` files; each leg preserves the shared POI
  heading target).
