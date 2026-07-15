# Export for Pix4D/Metashape

Added a "Export pro Pix4D/Metashape (.csv)" button next to the other
export options, downloading a CSV listing the planned GPS position of
every photo the mission will capture, in flight order.

## What it does

- One row per `takePhoto` action, in the order the drone will actually
  fly them: a sequential placeholder name (`photo_0001`, `photo_0002`,
  ...), latitude, longitude, and altitude in meters.
- Importable into Pix4D as an image geolocation file, or into Agisoft
  Metashape via the Reference pane's CSV import — both tools' import
  wizards let you remap columns and match rows to your actual captured
  photos, so the exact row-name format isn't critical.
- Warns instead of downloading an empty file when the mission has no
  `takePhoto` actions at all (e.g. it's set to video capture mode).

## Implementation notes

- Entirely client-side (`lib/photogrammetryExport.ts`) — no backend
  involvement, same as the PDF report, since the CSV only reflects data
  already in the editor.
- Row names are deliberately sequential placeholders, not real DJI
  filenames: this app only plans the flight, it never sees the photos the
  drone actually captures, so rows are meant to be matched to the real
  files by capture order after the flight — documented in `specs/import-export.md`
  so this limitation is clear up front rather than discovered by trial and error.
- The altitude column reflects the mission's configured height mode
  (AGL or above the start point, in practice), not necessarily true
  altitude — a toast notice names the active height mode at export time,
  and the backend now rejects waypoint/POI heights outside a sane
  -500..9000 m range as an extra data-quality guard.
