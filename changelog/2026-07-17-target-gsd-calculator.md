## Summary

Grid survey's GSD calculator now works in both directions — previously it only showed the GSD a chosen altitude produces; now you can also enter a target GSD and get the altitude needed to hit it.

## Changes

- New "Cílové GSD (cm/px)" field in the Grid template panel with a "Použít výšku" button, using the already-present (but previously unwired) `computeAltitudeForGsd` in `lib/solarCamera.ts` — the inverse of the existing `computeGsdCm`.
- Setting the altitude this way automatically feeds into the existing row/photo spacing recommendation, so both the flight altitude and the grid spacing end up matching the requested ground resolution.
- Only shown for cameras with a known photo resolution, matching the existing GSD readout's own availability check.
