## Summary

The map now shows real-time flight progress against the currently open mission, not just a moving telemetry dot.

## Changes

- New "Průběh mise" badge over the map: percent complete and ETA to the last waypoint, computed by projecting the aircraft's live position onto the mission's flight path.
- Waypoints the aircraft has already flown past get a green checkmark badge and are dimmed in the waypoint list.
- New `lib/missionProgress.ts` — a nearest-point-on-segment projection over the flight path, unit-tested.
- Documented in `specs/map-and-visualization.md`.

Assumes a single aircraft flying the currently open mission at a time — not a multi-mission dispatch tracker.
