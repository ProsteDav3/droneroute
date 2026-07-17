## Summary

New "terrain following" action in the elevation graph: recomputes every waypoint's height so the flight maintains a constant clearance above the real ground the whole way, instead of a fixed altitude that ignores terrain rising or falling underneath.

## Changes

- New `computeTerrainFollowingHeights` in `lib/terrain.ts`, building on the real-terrain-data work — given a target above-ground clearance, works out the per-waypoint height needed under the mission's own height reference (relative-to-launch or EGM96).
- New `setWaypointHeights` mission-store action: sets many waypoints' heights from an index map in a single update (one undo-history entry), rather than one `updateWaypoint` call per waypoint.
- New control under the elevation graph: enter a target height, click "Použít". Hidden for above-ground-level height mode, where the aircraft already follows terrain live via its own sensors.
