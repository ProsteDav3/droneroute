## Summary

New "Crosshatch" option for Grid surveys — flies a second pass rotated 90° from the first, recommended for 3D reconstruction where a single-direction grid alone leaves vertical surfaces (walls, roof edges) poorly reconstructed.

## Changes

- `GridParams.crosshatch` (optional, defaults to off — unset behaves exactly like every grid generated before this field existed).
- `generateGrid`'s single-pass line-generation logic factored out into `generateGridPass`, called twice (0° and rotation+90°) when crosshatch is enabled, and concatenated before the existing reverse/video-capture postprocessing.
- New checkbox in the Grid template panel.
