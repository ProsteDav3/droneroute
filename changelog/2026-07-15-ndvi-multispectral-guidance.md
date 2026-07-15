# Multispectral/NDVI guidance for Grid surveys

When the mission's selected camera is a multispectral payload (DJI Mavic
3M), the Grid template's config panel now shows an extra guidance box
under the overlap/GSD calculator:

- A higher recommended overlap (80% front / 75% side, vs. the 75%/65%
  RGB-photogrammetry defaults) — vegetation-index processing needs more
  redundancy between bands and is more sensitive to coverage gaps than a
  plain visual orthomosaic — with a one-click button to apply it.
- A reminder to shoot the calibration reflectance panel before and after
  the flight, needed for radiometric calibration.
- A reminder to fly under stable light (near solar noon, avoiding shifting
  cloud cover), since NDVI values are sensitive to changing illumination
  mid-flight.

## Implementation notes

- Added `isMultispectralPayload()` to `solarCamera.ts`, currently matching
  only the Mavic 3M's payload enum value (68) — its multispectral bands
  share alignment with the RGB module already listed in `WIDE_CAMERA_FOV`,
  so that entry's FOV is reused for framing/GSD purposes.
- The guidance box only appears for a recognized multispectral payload; no
  other camera's UI changes.
