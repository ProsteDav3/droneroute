# WPML 1.0.6 native-format KMZ export

Upgraded the KMZ generator from WPML 1.0.2 (files at the zip root) to
WPML 1.0.6 in the exact structure DJI Pilot 2 itself generates natively
(files nested under `wpmz/`, no `res/` directory).

## Why

DJI Pilot 2's **cloud-download path** (routes distributed through a
third-party cloud platform via DJI Cloud API) strictly validates wayline
files against the native format and rejected our exports with "Original
route file error. Make sure route file is not modified by third-party
tool." — while manual import tolerated them. The format was
reverse-engineered against a real mission exported from an M4T-era
Pilot 2 RC, and a converted SkyRoute mission was verified end-to-end on
real hardware (uploaded to a Cloud API workspace, opened on the RC with
all waypoints intact) before this implementation.

## What changed

- Both files now declare `xmlns:wpml="http://www.dji.com/wpmz/1.0.6"`
  and live under `wpmz/` inside the KMZ.
- `missionConfig` gains `waylineAvoidLimitAreaMode`.
- `template.kml` gains `positioningType`, `globalHeight`,
  `caliFlightEnable`, a fully-populated `globalWaypointHeadingParam`,
  `globalUseStraightLine`, per-waypoint `useStraightLine`/`isRisky`, and
  a `payloadParam` block (`imageFormat` is `visable,ir` for thermal
  payloads, `visable` otherwise — matching native output).
- `waylines.wpml` gains folder-level `executeHeightMode`, `waylineId`,
  `distance`, `duration`, `realTimeFollowSurfaceByFov`, and per-waypoint
  `waypointHeadingAngleEnable`, `waypointHeadingPoiIndex`,
  `useStraightLine`, `waypointGimbalHeadingParam`, `isRisky`, and
  `waypointWorkType`.
- `executeHeightMode` maps conservatively from the mission's height
  reference: EGM96 → WGS84, relative-to-start and AGL →
  relativeToStartPoint (never realTimeFollowSurface, which would
  silently enable terrain following).
- A waypoint whose `towardPOI` target can't be resolved now falls back
  to the global heading mode instead of emitting a zeroed POI target the
  aircraft would try to aim at.

## Compatibility

- Manual KMZ import into Pilot 2 keeps working (the native format is by
  definition what Pilot 2 accepts).
- SkyRoute's own KMZ import already handled the `wpmz/` layout, so
  files exported by this version re-import cleanly (covered by a new
  generate→parse round-trip test).
- Previously exported 1.0.2 files remain importable into SkyRoute.
