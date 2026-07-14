## Summary

Add a draggable handle on the orbit template's center point, so you can
nudge it into place after a location search — instead of only being able to
set it exactly via the address/coordinate field or by re-drawing from
scratch.

## Changes

- `OrbitCenterHandle` (`packages/frontend/src/components/map/TemplateDrawHandler.tsx`):
  a draggable marker at `orbitParams.center`. Dragging it updates the
  center directly; the orbit preview (radius, arc, POI) recomputes live
  from the new center on every frame.
- Rendered after (on top of) the existing rotation handle, so it stays
  grabbable even for small-radius orbits where the two handles sit close
  together.

## Tests

- Reviewed for hooks discipline, stale-preview risk, and handle overlap
  with the existing rotation handle — no correctness issues found; one
  cosmetic overlap edge case at very small radii, mitigated by render order.
