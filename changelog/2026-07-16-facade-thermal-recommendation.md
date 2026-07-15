# Thermal row/column recommendation for Facade

Added a horizontal/vertical overlap % calculator to the Facade template's
config panel — the same kind of "Doporučeno pro {camera} ... [Use]" box
Solar and Grid already have, adapted for Facade's row/column grid instead
of a spacing-in-meters value.

## What it does

- Set a desired horizontal (along-wall) and vertical (row-to-row) overlap
  percentage (20%/20% default, matching the existing Solar thermal
  recommendation's baseline — full coverage without gaps, not
  photogrammetric reconstruction).
- When the mission's selected camera is a supported DJI thermal payload
  (H20T, M30T, M3T, M3TD, or Matrice 4T), the panel recommends the number
  of rows and columns needed to hit that overlap at the current standoff
  distance, given the wall's actual traced length and height range, with
  a one-click "Use" button to apply them.
- For any other camera, the panel explains the thermal FOV isn't known
  and rows/columns are set manually, same as before this change.

## Implementation notes

- Added `recommendFacadeGrid()` to `solarCamera.ts`, mirroring
  `recommendGridSpacing()`'s shape but returning horizontal/vertical
  spacing directly from `THERMAL_CAMERA_FOV` (which already stores both
  horizontal and vertical FOV, unlike the wide/RGB camera table Grid
  uses — no aspect-ratio derivation needed here).
- The panel converts that spacing into row/column counts using the wall's
  actual traced length (`haversineDistance` between the two wall
  endpoints) and altitude range (`maxAltitude - minAltitude`).
