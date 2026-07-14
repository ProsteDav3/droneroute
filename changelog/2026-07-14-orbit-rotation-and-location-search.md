## Summary

Add a drag-to-rotate handle for the Orbit template's arc, and a reusable
"address or coordinates" search field wired into the Orbit panel, waypoint
editor, and POI editor — so any of those can be placed exactly without
hunting for the spot on the map by hand.

## Changes

- **Orbit rotation handle**: a draggable marker sits on the orbit's current
  start bearing. Dragging it rotates the whole arc (preserving its angular
  width) around the center, computed fresh from the cursor's absolute
  bearing on every drag event — no drift across repeated drags, and it
  composes correctly with the existing partial-arc math regardless of how
  far past 360° the stored angles have wrapped.
- **`LocationSearch`** (new `packages/frontend/src/components/ui/location-search.tsx`):
  a small input + button. A typed `lat, lng` pair resolves immediately;
  anything else is geocoded via the Mapbox Geocoding API (reusing the same
  `MAPBOX_TOKEN` already used for the map itself). Wired into:
  - the Orbit template panel (sets the orbit's center),
  - the waypoint editor (moves the selected waypoint),
  - the POI editor (moves the selected POI).
    Each of these also pans/zooms the map to the new location via a new
    `flyToTarget` field on the mission store, watched by a `FlyToTargetHandler`
    in `MapView`.
- `destinationPoint` and `bearing` (previously private helpers in
  `packages/frontend/src/lib/templates.ts`) are now exported for reuse by the
  rotation handle.

## Notes

- No backend changes; this is frontend-only.
- Reviewed for rotation-math drift, geocoding error handling, event-capture
  conflicts with the existing drag-to-set-radius interaction, and hooks
  discipline — no issues found.
