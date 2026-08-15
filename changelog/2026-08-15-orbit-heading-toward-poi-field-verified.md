## Summary

Make orbits (and facade / turbine) both turn toward their target and tilt the gimbal correctly on a Matrice 4T — settled by flying five variants of one orbit rather than by reading the spec.

## Changes

- The WPML writer now emits `waypointHeadingAngle` **0** beside `towardPOI` in `template.kml`, instead of the computed bearing. Five variants of the same orbit were flown back to back on an M4T: `towardPOI` with the real bearing written there — exactly what the originally reported flight carried — never turned toward the POI; the identical file with that angle forced to 0 tracked the POI and honoured per-waypoint gimbal pitch as well. Pilot 2 regenerates `waylines.wpml` from `template.kml` on download from the cloud, and a non-zero angle beside `towardPOI` is enough to derail it. The angle is meaningless in that mode anyway (the spec reads it only for `smoothTransition`).
- On apply, a template that created a POI hands its waypoints to that POI as `towardPOI` again. The previous release had stopped doing this on the theory that `towardPOI` was unsupported on the M4T; the field test showed it is the only mode where the gimbal follows too — `smoothTransition` turned the nose but left the gimbal at its takeoff angle. Generators still emit `smoothTransition` bearings, so a template with no POI at least turns the nose.
- Removed the now-unused bearing helper from the WPML writer.

Field results, for the record — same geometry, only the heading encoding differed: `smoothTransition` → nose ✓ gimbal ✗; `towardPOI` + real angle in template → nose ✗ gimbal ✓; `fixed` → nose ✗ gimbal ✗; per-waypoint `rotateYaw`/`gimbalRotate` actions → jerky, gimbal eventually stuck; `towardPOI` + zero angle in template → nose ✓ gimbal ✓.
