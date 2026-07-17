## Summary

Two new pre-flight safety warnings: flying above the EU Open category's 120 m AGL limit, and flying farther from the launch point than expected.

## Changes

- New `findMaxAltitudeViolations` in `lib/terrain.ts`: flags any waypoint above 120 m real ground clearance, using the same terrain-elevation infrastructure as the terrain collision check. Skipped for above-ground-level height mode, consistent with the other terrain checks.
- New `getHomeDistanceWarning` in `lib/geo.ts`: flags the farthest waypoint from the first waypoint (launch point) when it exceeds a 2 km default threshold — documented clearly as a general heads-up, not a certified per-aircraft C2/transmission-range spec (real range varies hugely by drone model and region).
- Both surface through the existing warning-banner UI.
