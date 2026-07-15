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
- **Import** an existing KMZ file to load its waypoints, actions, POIs, and settings into the editor.

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

### Importing

1. Click the import button.
2. Select a KMZ file from your computer.
3. The app reads the file and loads all waypoints, actions, and settings into the editor.

## Good to know

- The exported KMZ follows DJI's WPML standard, so it works with DJI's own flight apps too.
- Imported missions may not look exactly the same if the original file used features not supported by SkyRoute.
- The maximum import file size is 50 MB.
- Imported and saved missions are validated: files with malformed contents or
  out-of-range coordinates are rejected with an error rather than being loaded.
