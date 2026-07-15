# Volumetric survey coverage check

Added a "Výpočet objemu (hromady, skládky)" checkbox to the Grid survey
template's config panel, for stockpile/quarry/landfill volume-calculation
jobs.

## What it does

- When checked, compares the current front/side overlap against the
  higher threshold volumetric photogrammetry needs (80% front / 70% side,
  vs. the 70-80%/60-70% baseline for ordinary orthomosaic mapping) —
  reconstruction gaps/noise on steep pile slopes translate directly into
  volume-calculation error, not just a cosmetic gap in an orthomosaic.
- Shows a warning and a one-click "Použít doporučený překryv" button when
  the current overlap falls short of the recommended thresholds, or a
  confirmation when it's already sufficient.
- Includes a tip to consider a second crosshatch pass (a grid flown at
  90° to the first) for the best accuracy.

## Implementation notes

- `VOLUMETRIC_RECOMMENDED_FRONT_OVERLAP_PCT` / `_SIDE_OVERLAP_PCT` added
  to `lib/solarCamera.ts`, mirroring the existing NDVI recommendation
  constants.
- Purely a client-side, ephemeral planning aid (same pattern as the
  Grid overlap-%/GSD calculator and the NDVI recommendation box) — this
  app never computes volume itself, that's done by dedicated
  photogrammetry software (Pix4D, Metashape, etc.) downstream. The
  checkbox state isn't persisted with the template/mission, since it only
  gates which recommendation is shown, not the generated flight path.
