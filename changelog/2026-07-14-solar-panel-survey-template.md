## Summary

Add a new "Solar panel survey" template for photovoltaic (FVE) thermography
flights: trace the exact outline of a panel array (any shape, not just a
rectangle) and get a lawn-mower flight path clipped precisely to it, with
lines auto-aligned to the array's rows and a thermal (IR) photo action at
every waypoint.

## Changes

- **New template type `solar`** with its own toolbar button, dropdown entry,
  and `S` keyboard shortcut.
- **`SolarDrawHandler`**: click-to-place-vertex polygon drawing (click near
  the first vertex, or double-click, to close the shape) — the same
  interaction as obstacle drawing, applied to a new template instead.
- **`generateSolarSurvey()`** (`lib/templates.ts`): a polygon-clipped
  lawn-mower generator.
  - Converts the traced polygon to a local tangent-plane (flat-earth) meter
    frame, same assumption already used elsewhere in this file at this
    scale.
  - Auto-detects flight-line orientation from the polygon's longest edge, so
    lines run parallel to panel rows without the user setting a rotation
    angle.
  - Clips flight lines to the polygon using a standard scanline-fill
    (even-odd rule) algorithm — correct for concave/multi-segment shapes
    (e.g. an L-shaped field), not just convex ones. Verified numerically
    against an axis-aligned rectangle, a rotated rectangle (confirms
    orientation detection), and an L-shape (confirms no waypoints land
    outside the traced boundary).
  - Every waypoint: nadir gimbal (-90°), `followWayline` heading, and (when
    enabled) a `takePhoto` action targeting the thermal lens.
- **Thermal lens support (new capability)**: `TakePhotoParams` gained an
  optional `payloadLensIndex` field, and the backend WPML writer now emits
  `wpml:payloadLensIndex` / `wpml:useGlobalPayloadLensIndex` when a lens is
  specified. Omitting it produces byte-identical XML to before — fully
  backward compatible with every existing `takePhoto` action.
- Config panel: Altitude, Line spacing, and a "Thermal (IR) photo at each
  waypoint" toggle. No manual rotation field — orientation is automatic.

## Fixed during review

- **HIGH**: `scanlineIntersectionsX`'s half-open `[y1, y2)` interval
  convention (needed to avoid double-counting a vertex a scanline passes
  through) is asymmetric at the polygon's own extremes: sampling a scanline
  at exactly `minY` always finds a match, but sampling at exactly `maxY`
  never can (no edge endpoint is above the polygon's own maximum) — so the
  topmost flight line silently produced zero waypoints on every single
  generation, for every shape, with no error. For a narrow array (shorter
  than the line spacing) this meant only one edge ever got surveyed. Fixed
  by sampling all lines a hair inside the true extent instead of exactly on
  it. Caught by code review, not by my own manual spot-check — see Tests.

## Tests

- **New: `packages/frontend/vitest.config.ts` + `packages/frontend/src/lib/templates.test.ts`**
  — this repo previously had no frontend test runner, so this hand-rolled
  geometry code (`generateOrbit`, `computeGimbalPitch`/`computeAltitudeForPitch`,
  `generateSolarSurvey`) had no automated coverage; two real bugs in it this
  session (the CCW arc backtrack, and the topmost-line drop above) were both
  found only by manual/review re-derivation, not by my own quick spot-checks
  — which turned out to give a _coincidentally_ correct-looking total even
  with the topmost-line bug present. 11 new tests cover: orbit CW/CCW arc
  endpoints, gimbal-pitch/altitude round-tripping and the ±90° asymptote fix,
  and solar-survey line coverage (including this exact regression), rotation
  invariance, and concave-polygon clipping.
- CI (`.github/workflows/ci.yml`): added a "Test frontend" step alongside the
  existing backend test step, so this suite actually runs on every PR.
- `packages/backend/src/routes/kmz.test.ts`: two new cases confirming
  `payloadLensIndex` is omitted by default (existing behavior unchanged) and
  correctly emitted as `ir` when specified.
- `npm run build`, `npm run lint`, `npx prettier --check`,
  `npm run test -w packages/backend` (37/37),
  `npm run test -w packages/frontend` (11/11, new).
