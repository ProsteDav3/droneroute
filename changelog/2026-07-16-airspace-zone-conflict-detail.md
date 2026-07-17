# Detailed airspace zone-conflict warnings

The mission editor already flagged waypoints/route segments crossing
airspace zones, aggregated into a single "N restricted zones" count. Added
a more specific per-zone warning naming which zone the route conflicts with
and its altitude limit, e.g. "Trasa letu protíná zónu Řízený vzdušný
prostor (limit 120 m AGL)" — shown alongside the existing aggregate
warnings, not replacing them.

## Implementation notes

- `getAirspaceWarnings` (in `lib/geo.ts`) now carries the zone's
  `altitudeUpper` through into each `AirspaceWarning`, and a new
  `formatAirspaceWarningMessage` helper renders the pilot-facing sentence.
- The detailed warnings are computed inside `WarningsPanel` itself (reading
  `missionStore`/`airspaceStore` directly) rather than threaded down as
  props from `App.tsx`.
