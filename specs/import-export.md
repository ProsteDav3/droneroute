# Import and export

Bring in existing missions or export your planned flight as a file ready for DJI drones.

## What you can do

- **Export** a mission as a KMZ file compatible with DJI drones (WPML format).
- **Export segments**: split a multi-waypoint route into consecutive one-leg
  missions (waypoint 1→2, 2→3, ... N-1→N) and download every leg as its own
  KMZ file, bundled together in a single zip. Useful for routes flown one leg
  per visit over a long recurring schedule (e.g. a construction time-lapse
  orbit revisited every few days), where each visit only needs to fly the next
  leg but every leg should keep the same POI heading target and mission
  settings as the original route.
- **Save segments as missions**: instead of (or in addition to) downloading
  the zip, save every leg as its own named mission in your account, right
  alongside the original full-route mission — requires being signed in.
- **Whole-project flight summary**: next to the segment export/save buttons, see
  how many separate flights the whole revisit schedule needs (one per segment,
  since each leg is its own standalone flight with its own take-off and
  landing) and the combined flight time across all of them — a warning
  appears if any single segment alone would already exceed your configured
  battery limit.
- **Import** an existing KMZ file to load its waypoints, actions, POIs, and settings into the editor.
- **PDF report**: download a client-facing summary of the planned mission — drone/camera used, waypoint count, flight distance and estimated duration, altitude range, photo/video action counts, and a table of every waypoint's coordinates, altitude, and actions.
- **Export for Pix4D/Metashape**: download a CSV listing the planned GPS position of every photo the mission will capture, in flight order — usable as an external image-geolocation import in Pix4D or Agisoft Metashape. The altitude column reflects whatever height reference the mission is configured with (above ground level or above the start point — the app doesn't expose a true absolute/geodetic height mode in practice), not necessarily true altitude, so double-check this matches what your photogrammetry workflow expects before relying on it for georeferencing.

## How it works

### Exporting

1. Plan your mission in the editor.
2. Click the export/download button.
3. A KMZ file is generated and downloaded to your computer.
4. Load the KMZ onto your drone's controller (manually or using the upload tool).

### Exporting segments

1. Plan a route with 2 or more waypoints (for example, a partial orbit — see [Templates](templates.md)).
2. Click "Export segments (.zip)".
3. A zip file downloads containing one .kmz per consecutive waypoint pair, each named with its position in the sequence (e.g. `mission-seg-01-of-42.kmz`).
4. Import each .kmz into the drone controller individually, one per scheduled visit.

### Saving segments as missions

1. Plan a route with 2 or more waypoints, same as for exporting segments.
2. Click "Uložit segmenty jako mise" (sign in first if you haven't already).
3. Each consecutive-pair leg is saved as its own mission (e.g.
   `mission-seg-1-of-41`) in **Moje trasy**, alongside the original full route
   — open, edit, or export any of them individually from there like any other
   saved mission.

### Importing

1. Click the import button.
2. Select a KMZ file from your computer.
3. The app reads the file and loads all waypoints, actions, and settings into the editor.

### PDF report

1. Plan a route with 2 or more waypoints.
2. Click "Stáhnout PDF report".
3. A PDF downloads with the mission name, drone/camera, waypoint count,
   distance, estimated flight time, altitude range, photo/video action
   counts, and a table listing every waypoint (very dense missions show the
   first 200 rows with a note about how many more exist, to keep the report
   a manageable length).

### Export for Pix4D/Metashape

1. Plan a mission with photo capture (not video) actions.
2. Click "Export pro Pix4D/Metashape (.csv)".
3. A CSV downloads with one row per planned photo, in flight order: a
   sequential placeholder name (`photo_0001`, `photo_0002`, ...), latitude,
   longitude, and altitude in meters. A notice explains which height
   reference the altitude column reflects (see "Good to know" below).
4. Import it into Pix4D as an image geolocation file, or into Metashape via
   the Reference pane's CSV import — both tools let you remap columns and
   match rows to your actual captured photos during their own import
   wizard. Verify the column mapping and coordinate/height interpretation
   against your project's actual settings before trusting the result for
   georeferencing — this export hasn't been validated against every
   Pix4D/Metashape project configuration.

## Good to know

- The exported KMZ follows DJI's WPML 1.0.6 standard in the exact structure DJI Pilot 2 itself generates (files nested under `wpmz/`), so it works with DJI's own flight apps too — including the strict validation DJI Pilot 2 applies to routes downloaded from a cloud platform, which rejects older/looser WPML files that manual import would still accept.
- If the original mission used video capture mode (see [Templates](templates.md)),
  every exported/saved segment starts recording at its own first waypoint and
  stops at its own second waypoint — not just the first and last segment of
  the whole route.
- Imported missions may not look exactly the same if the original file used features not supported by SkyRoute.
- The maximum import file size is 50 MB.
- Imported and saved missions are validated: files with malformed contents or
  out-of-range coordinates are rejected with an error rather than being loaded.
- The Pix4D/Metashape CSV's row names are sequential placeholders, not real
  camera filenames — this app only plans the flight, it has no way to know
  what the drone will actually name its photos, so rows must be matched to
  the real captured files by capture order after the flight, not by name.
- The Pix4D/Metashape CSV's altitude column is the mission's configured
  height reference (above ground level or above the start point, in
  practice — the app's UI doesn't expose a true absolute/geodetic height
  mode), not necessarily true altitude. A notice shown at export time names
  the active height mode — check it matches what your photogrammetry
  project expects before using the export for georeferencing.
