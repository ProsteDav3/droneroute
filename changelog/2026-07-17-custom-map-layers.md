## Summary

New "Vlastní vrstvy (WMS/XYZ)" setting lets you add any raster tile layer by URL template — a national cadastre, zoning plan, or other region-specific data the app doesn't ship built in.

## Changes

- `packages/shared/src/types.ts` — new `CustomMapLayer` type and `VisualizationPreferences.customLayers` (optional, unset/empty means none, matching every mission's existing behavior).
- New `CustomLayersOverlay` map component — renders each visible layer as a Mapbox raster source/layer, in add order.
- New "Vlastní vrstvy (WMS/XYZ)" section in the Visualization settings tab: add a layer by name + URL template, toggle visibility, or remove it individually.
