## Summary

Building edge-length labels (added while drawing in a previous change) now
also persist after the building is placed, so you can see a building's real
side dimensions any time you look at it on the map, not just while drawing.

## Changes

- `EdgeLengthLabels` (`packages/frontend/src/components/map/EdgeLengthLabels.tsx`)
  gained an optional `offset` prop (pixel offset per label), so a caller can
  nudge labels away from another marker placed at the same edge midpoint.
- `BuildingPolygon.tsx` (the already-committed building renderer, distinct
  from the drawing-in-progress `BuildingDrawHandler.tsx`) now renders
  `EdgeLengthLabels` for every building, always — not gated on selection,
  matching the existing always-visible name/height label. Labels are nudged
  upward (`offset={[0, -14]}`) so they don't sit exactly on top of the
  "click to insert a vertex" handle that appears at the same edge midpoint
  when the building is selected.

## Tests

- `npm run build` (all workspaces) and `npm run test -w packages/frontend`
  (84/84, unaffected — purely presentational, no new logic to unit test
  beyond what `EdgeLengthLabels` already covers).
