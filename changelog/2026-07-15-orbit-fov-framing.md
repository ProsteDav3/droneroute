## Summary

Fixes the orbit template so editing Radius, Výška letu (altitude), or Výška
POI recalculates the _other_ values as needed to keep the whole target object
framed inside the selected camera's real field of view, instead of only
recomputing gimbal pitch. Also adds an optional "Uzamknout POI" (lock POI)
toggle so the flight circle can be moved or resized independently of a fixed
camera aim point.

## Changes

- New `WIDE_CAMERA_FOV` table (`packages/frontend/src/lib/solarCamera.ts`)
  giving the vertical field of view of every drone/payload's primary wide/RGB
  camera in `DRONE_MODELS`, sourced from DJI's published spec sheets — a
  separate table from `THERMAL_CAMERA_FOV` (thermal-only, used for solar
  spacing), since this is a different lens/sensor.
- New `computeFramedForRadius`/`computeFramedForAltitude` geometry functions
  (`packages/frontend/src/lib/templates.ts`): given a fixed radius or
  altitude, POI height, and the selected camera's vertical FOV, solve for the
  other value (and the gimbal pitch that centers the shot) so the object
  spans a comfortable, achievable fraction of the frame. Returns `null` (and
  the panel falls back to the previous gimbal-only recompute) when the
  camera's FOV is unknown or the requested framing isn't geometrically
  possible at that distance.
- `orbitParamsForBuilding` now uses this same FOV-aware framing when the
  mission's selected camera has known FOV data, instead of the previous
  fixed -45°/derived-altitude heuristic — so the initial auto-placement and
  later manual edits use the same underlying math.
- New optional `OrbitParams.poiCenter` decouples the camera's aim point from
  the flight circle's center. When set (via the new "Uzamknout POI"
  checkbox), a second draggable marker lets you move the aim point
  independently; the flight circle's center handle and Radius field then
  resize/reposition the orbit without moving what the camera looks at, with
  gimbal pitch recomputed per waypoint to match the now-varying distance to
  the fixed target.

## Known limitations

- Several payloads' wide-camera FOV values (M3M/M3D/M3TD/M30T/H20N/H20T/H30T)
  reuse their non-thermal sibling's spec-sheet number rather than being
  independently fetched, since DJI documents them as sharing the same wide
  sensor module — flagged in code comments.
- PSDK (a generic third-party payload mount) has no fixed camera and is
  intentionally excluded from `WIDE_CAMERA_FOV` — orbits on that payload keep
  the previous gimbal-only linking behavior.
- The FOV-aware framing targets 50% of the camera's vertical FOV (a
  deliberately moderate default, not edge-to-edge) — for very large radii
  relative to the object's height, no altitude can reach even that target, so
  the panel gracefully falls back rather than erroring.

## Tests

- `npm run build` (all workspaces) and `npm run test -w packages/frontend`
  (71/71) and `npm run test -w packages/backend` (82/82), all passing.
- New tests cover: `computeFramedForRadius`/`computeFramedForAltitude` hitting
  the target span, centering gimbal pitch, `null` on an unframeable object or
  zero POI height, and root selection near a previous value;
  `orbitParamsForBuilding` with/without a known camera FOV; `generateOrbit`
  with `poiCenter` unset (byte-identical regression guard) and set (varying
  per-waypoint pitch, heading pointed at the aim point).
