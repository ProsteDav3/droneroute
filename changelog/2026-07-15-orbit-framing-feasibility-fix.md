## Summary

Fixes a bug where editing Radius or Výška letu on an orbit often silently
stopped recalculating the other value, falling back to gimbal-only linking
without any visible indication — reported as "changing radius sometimes
doesn't change altitude, and vice versa." Also fixes a layout bug where the
orbit panel's checkbox row wrapped mid-word.

## Root cause

`computeFramedForRadius`/`computeFramedForAltitude` targeted a **fixed**
fraction of the camera's vertical FOV (50%) and returned `null` — silently
falling back to the old gimbal-only recompute — whenever that exact target
wasn't geometrically achievable. For a realistic building height (e.g.
40m), the achievable span shrinks fast as radius or altitude grows past
roughly the building's own height, so any reasonably safe orbit distance
(radius beyond ~80m, or altitude much more than ~2-3x the building height)
made the fixed 50% target unreachable — turning the "always" framing
behavior into "framing, but only until you fly far enough away that it
quietly stops," exactly matching the reported symptom.

## Fix

`computeFramedForRadius`/`computeFramedForAltitude` now cap their target
span at whichever is smaller: the aspirational 50% of FOV, or the actual
maximum span achievable for the given fixed radius/altitude
(`2*atan(poiHeight/(2*radiusM))`, respectively
`atan(poiHeight/(2*sqrt(altitude*(altitude-poiHeight))))`). A real solution
now always exists for any positive `radiusM`/`poiHeight`
(`computeFramedForRadius`) or `altitude > poiHeight`
(`computeFramedForAltitude`) — the framing gracefully degrades to "as
tightly framed as this distance allows" instead of failing outright. The
only remaining `null` cases are genuinely degenerate: `poiHeight <= 0`, or
(for altitude) the camera at or below the object's own top.

Also fixed the orbit panel's checkbox row ("Po směru hodin" / "Středový
POI" / "Uzamknout POI") wrapping mid-word — it was squeezed into half the
panel's width by the surrounding 2-column grid layout. Now spans the full
width and wraps by whole checkbox instead of by word, with the Foto/Video
toggle moved to its own full-width row below it.

## Tests

- `npm run build` and `npm run test -w packages/frontend` (87/87, 5 new)
  passing.
- New tests directly reproduce the reported values (radius grown to 105m /
  altitude raised to 150m for a 40m building) and assert a non-null result;
  updated the old "returns null for an oversized radius" test to assert the
  new graceful-degradation behavior instead; added a test for the one
  remaining legitimate `null` case (altitude at or below poiHeight).
