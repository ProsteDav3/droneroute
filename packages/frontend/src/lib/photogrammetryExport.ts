import type { Waypoint } from "@droneroute/shared";

export interface PhotogrammetryExportRow {
  name: string;
  latitude: number;
  longitude: number;
  /**
   * Altitude in meters, always metric regardless of the app's display unit
   * preference (Pix4D/Metashape both expect SI units). NOT necessarily a
   * true/absolute (geodetic) altitude — it is `wp.height` exactly as
   * configured on the mission, which in practice is almost always relative
   * (above ground level or above the start point), since the UI only
   * exposes those two relative modes. Callers must warn the user which
   * height reference this reflects before it's used for georeferencing.
   */
  altitude: number;
}

/**
 * One row per `takePhoto` action, in flight order — matches how many
 * photos the drone will actually capture and in what sequence, which is
 * what a photogrammetry tool's image-position import needs to line up
 * against the real captured files (matched by capture order, since this
 * planning app has no way to know the drone's actual output filenames
 * ahead of the flight).
 */
export function buildPhotogrammetryExportRows(
  waypoints: Waypoint[],
): PhotogrammetryExportRow[] {
  const rows: PhotogrammetryExportRow[] = [];
  let photoIndex = 0;
  for (const wp of waypoints) {
    const photoCount = wp.actions.filter(
      (a) => a.actionType === "takePhoto",
    ).length;
    for (let i = 0; i < photoCount; i++) {
      photoIndex++;
      rows.push({
        name: `photo_${String(photoIndex).padStart(4, "0")}`,
        latitude: wp.latitude,
        longitude: wp.longitude,
        altitude: wp.height,
      });
    }
  }
  return rows;
}

/**
 * CSV compatible with Pix4D's image geolocation file import and Agisoft
 * Metashape's Reference-pane CSV import — both accept a simple
 * name/lat/lon/alt table and let the user remap columns and match rows to
 * actual image files during their own import wizard, so exact column
 * naming isn't critical as long as the data is unambiguous.
 *
 * Row names are sequential placeholders (`photo_0001`, ...), not real DJI
 * filenames — this app only plans the flight, it never sees the photos the
 * drone actually captures, so rows must be matched to real files by
 * capture order after the flight, not by name.
 */
export function generatePhotogrammetryCsv(waypoints: Waypoint[]): string {
  const rows = buildPhotogrammetryExportRows(waypoints);
  const header = "Name,Latitude,Longitude,Altitude(m)";
  const lines = rows.map(
    (r) =>
      `${r.name},${r.latitude.toFixed(8)},${r.longitude.toFixed(8)},${r.altitude.toFixed(2)}`,
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}
