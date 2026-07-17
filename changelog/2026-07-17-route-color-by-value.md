## Summary

The flight path can now be colored by height or speed instead of a flat color — set "Barvení trasy" in the Visualization tab of the settings dialog. Each segment is colored along a blue (low) → green → yellow → red (high) gradient, normalized against the whole mission's own min/max.

## Changes

- New `lib/colorScale.ts`: `valueToGradientColor`, a fixed 4-stop gradient function (clamps out-of-range values, handles the min-equals-max edge case without dividing by zero).
- `VisualizationPreferences.routeColorMode` (`"flat" | "height" | "speed"`, optional — defaults to `"flat"`, matching every mission's existing behavior).
- `MapView`'s `FlightPath` computes each segment's color from the active mode; obstacle-warning segments still always render red regardless of the color mode, since that's a safety signal, not a style choice.
- New select in the Visualization settings tab.
