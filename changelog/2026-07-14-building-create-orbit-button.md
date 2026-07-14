## Summary

Placing a POI on a building to pre-fill the Orbit panel (added in the
previous PR) turned out to be too indirect a trigger — a user drawing a
building naturally reached for the Orbit tool directly and expected it
to recognize the building, not to first switch to Add POI and click
inside the footprint. Adds a direct "create orbit" action instead.

## Changes

- New orbit icon button next to each building in the sidebar list. Click
  it to open the Orbit template panel pre-filled with a center, radius,
  altitude, and gimbal pitch recommended for that building — the exact
  same computation as the POI-on-building flow, just without needing to
  place a POI first. Both paths remain available.
- Refactor: extracted the shared computation into
  `orbitParamsForBuilding(building)` in `lib/templates.ts` (center/radius
  from `computeOrbitSeedForBuilding`, POI height from the building's real
  height, altitude/gimbal pitch linked via `computeAltitudeForPitch`) so
  the sidebar button and `missionStore`'s `addPoi` POI-on-building
  detection compute the recommendation identically instead of
  duplicating the logic in two places.

## Tests

- `packages/frontend/src/lib/templates.test.ts`: `orbitParamsForBuilding`
  produces a center/radius consistent with `computeOrbitSeedForBuilding`,
  an altitude/gimbal-pitch pair that round-trips through
  `computeGimbalPitch`, and output directly usable by `generateOrbit()`.
- `npm run build`, `npm run lint`, `npx prettier --check`,
  `npm run test -w packages/backend` (38/38),
  `npm run test -w packages/frontend` (30/30).
