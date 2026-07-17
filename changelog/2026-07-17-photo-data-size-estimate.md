## Summary

The footer's photo-count badge now also shows an estimated total data size (e.g. "24 (~180 MB)") — useful for planning storage and transfer for large photogrammetry missions, especially batches of many missions.

## Changes

- New `estimatePhotoFileSizeMB`/`estimateMissionPhotoData` in `lib/solarCamera.ts`: estimates per-photo and total JPEG size from the selected camera's known resolution (`WIDE_CAMERA_FOV`), using a documented ballpark bytes-per-megapixel constant. Returns `null` when the resolution isn't known, matching this file's existing "never guess" convention for unknown payloads.
- New `formatDataSize` in `lib/units.ts` (MB/GB, unit-system independent).
- Footer photo badge in `App.tsx` shows the estimate when available.
