# Fix: Orbit/Turbine/Facade-thermal waypoints not tracking their target

Fixed a bug where missions using Orbit, Turbine blade inspection, or the
Facade template's thermal recommendation would take off, briefly set a
heading, and then hold that same heading for the entire flight instead of
continuously reorienting to keep facing their target (the orbit center,
the turbine hub, etc.).

## Root cause

These templates give each waypoint its own precomputed heading angle
(`headingMode: "fixed"`, `useGlobalHeadingParam: false`) so the nose
tracks the target as the aircraft moves around it. `waylines.wpml` (the
file used by `buildWaylinesWpml`) already emitted this correctly for
every waypoint.

`template.kml` (`buildTemplateKml`), however, only ever emitted a
per-waypoint heading override for `towardPOI` mode — every other
non-global mode (in particular the "fixed" mode these three templates
rely on) got no override at all, despite `useGlobalHeadingParam` being
set to `0` for that waypoint. With no override present, the aircraft had
no per-waypoint heading data to use and fell back to whatever heading it
already had — in practice, the heading from takeoff, held for the rest
of the mission.

## Fix

`buildTemplateKml` now emits a per-waypoint `waypointHeadingParam`
(mode + angle, or mode + POI point for `towardPOI`) whenever a waypoint
opts out of the global heading config, matching what `buildWaylinesWpml`
already did. Added `packages/backend/src/lib/wpml.test.ts` covering both
files' heading-override behavior as a regression guard.
