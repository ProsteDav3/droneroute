## Summary

New "Transformace mise" controls in mission settings shift or rotate the whole mission — every waypoint, POI, obstacle, and building together — instead of redrawing anything when the real-world object it was planned around has moved.

## Changes

- New `offsetLatLng`/`rotateLatLng` in `lib/geo.ts` — local equirectangular offset/rotation helpers, same approximation `generateGrid`'s own rotation math and `polygonArea` already use.
- New `offsetMission`/`rotateMission` mission-store actions (single undo-history entry each). `rotateMission` pivots around the mission's own waypoint centroid. Both leave heights untouched.
- New "Posunout"/"Otočit" controls in `MissionConfig`.
