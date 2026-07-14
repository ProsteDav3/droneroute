## Summary

Fix the Orbit template silently assuming its POI sits at ground level, and
add live-linked altitude/gimbal-pitch fields (with a lock to decouple them)
so setting the real height of what you're looking at automatically suggests
a flight altitude and camera angle instead of requiring manual math.

## Changes

- **Fixed a real bug**: `generateOrbit()` always created its center POI at
  `height: 0` and computed every waypoint's gimbal pitch assuming the
  look-at point was at ground level — even if you later edited the POI's
  real height in the POI list, the already-generated waypoints' gimbal
  angles never updated to match. The Orbit panel now has its own **POI
  height** field that feeds directly into generation.
- Added a **Gimbal pitch** field to the Orbit panel, plus `computeGimbalPitch`
  / `computeAltitudeForPitch` helpers (exported from `lib/templates.ts`).
- **Linked by default**: editing radius, altitude, or POI height recalculates
  gimbal pitch; editing gimbal pitch recalculates altitude. A lock/unlock
  icon toggles this off so the two can be edited independently.
- Added inline tooltips on Radius/Altitude/POI height/Gimbal pitch
  explaining what each one means, including the mission's active height
  reference (relative to start / above ground level / EGM96).
- **Fixed during review**: `computeAltitudeForPitch(-90, ...)` (straight-down
  gimbal) produced an astronomical altitude, since `Math.tan()` doesn't
  throw at the ±90° asymptote — it returns a huge but finite number instead
  of `Infinity`. Now clamps the input away from the asymptote and caps the
  derived altitude at a sane 500 m ceiling. Also fixed a lower-severity issue
  where the altitude floor (1 m minimum) could leave the displayed gimbal
  pitch inconsistent with the stored altitude until an unrelated later edit
  "surfaced" the drift — the pitch field now always re-derives from the
  actual (possibly clamped) altitude immediately, so the pair never goes
  stale.

## Tests

- Verified round-trip stability (altitude → pitch → altitude and back)
  numerically across a range of altitude/POI-height/radius combinations,
  including the ±90° edge case and the poiHeight=0/small-radius floor case.
- `npm run build`, `npm run lint`, `npx prettier --check`,
  `npm run test -w packages/backend` (35/35, frontend-only change).
- Independent code review — one HIGH (unbounded altitude near ±90° pitch)
  and one MEDIUM (floor-clamp drift) finding, both fixed above.
