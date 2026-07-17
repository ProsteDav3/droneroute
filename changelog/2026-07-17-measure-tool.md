## Summary

New standalone ruler/area tool — measure distances and enclosed areas directly on the map, independent of the loaded mission's own waypoints.

## Changes

- New `store/measureStore.ts` holding the tool's own state (active/inactive, clicked points) — kept separate from `missionStore` since it never touches mission content.
- New `computeMeasureStats` in `lib/geo.ts`, reusing the existing `haversineDistance`/`polygonArea` helpers: running total distance for any number of points, plus enclosed area once there are 3+.
- New `MeasureToolHandler` map component: click to add points, live distance/area readout, undo-last-point (Escape) and clear controls.
- New toolbar button + **M** keyboard shortcut. Activating the measure tool exits any other active map tool (waypoint/POI placement, obstacle/building drawing, templates) and vice versa, so only one tool ever owns map clicks at a time.
