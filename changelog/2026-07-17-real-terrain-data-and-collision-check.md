## Summary

The elevation graph and flight-safety warnings now use real ground elevation instead of just the altitudes you configured — previously the graph could show a smooth climb over what's actually a hill the drone would fly straight into.

## Changes

- Map terrain (Mapbox DEM) now stays active in 2D mode too (rendered flat via exaggeration 0), so real elevation data is queryable regardless of the 2D/3D toggle.
- New `lib/terrain.ts`: queries ground elevation along the flight path (with retry for terrain tiles still loading), interpolates flight height between waypoints, and checks planned altitude against real terrain.
- Elevation graph now overlays a shaded terrain profile beneath the configured-height line.
- New warning banner (same severity styling as prohibited-airspace) when the flight path comes within 15 m of real ground anywhere along a leg — shown for the two height modes where it's a genuine risk (relative-to-launch, EGM96); intentionally skipped for above-ground-level mode, where the aircraft already follows terrain live via its own sensors.
- Documented in `specs/map-and-visualization.md` and `specs/mission-planning.md`.
