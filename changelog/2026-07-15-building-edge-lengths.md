## Summary

Shows each edge's real length on the map while drawing a building footprint,
matching the existing behavior when tracing a solar-panel survey boundary.

## Changes

- Extracted the per-edge distance-label component used by the solar-panel
  survey boundary tracer (`SolarDrawHandler.tsx`) into a shared
  `EdgeLengthLabels` component (`packages/frontend/src/components/map/EdgeLengthLabels.tsx`),
  parameterized by label color so each drawing tool can match its own guide
  color.
- Wired it into `BuildingDrawHandler.tsx` for all three states: the live
  2-corner rectangle drag, the in-progress polygon vertex chain, and the
  finalized-but-not-yet-applied shape shown while entering the building's
  height.

## Tests

- `npm run build` (all workspaces) and `npm run test -w packages/frontend`
  (71/71, unaffected — purely presentational, no new logic to unit test).
