import type { jsPDF } from "jspdf";
import type mapboxgl from "mapbox-gl";
import type { UnitSystem } from "@droneroute/shared";
import { haversine } from "@/lib/flightStats";
import { formatDistance } from "@/lib/units";

/** A waypoint's projected position within the captured canvas's own pixel
 * space (not the PDF's mm coordinate space — the caller scales that
 * separately once the image's placed size in the PDF is known). */
export interface SnapshotMarker {
  x: number;
  y: number;
  index: number;
  /** Great-circle distance (m) from the previous waypoint — undefined for
   * the first waypoint, which has no incoming segment. */
  segmentDistanceM?: number;
}

/**
 * A captured map frame plus its pixel dimensions, so it can be embedded into
 * a PDF at the right aspect ratio without an async image load.
 */
export interface MapSnapshot {
  /** PNG data URL of the map canvas at capture time. */
  dataUrl: string;
  width: number;
  height: number;
  /** Waypoint positions projected at the same moment as the capture, so
   * numbered markers can be drawn on top of the embedded image afterward —
   * `canvas.toDataURL()` only rasterizes the WebGL canvas itself, never the
   * DOM-based `<Marker>` overlays the live map uses for waypoint numbers,
   * so without this the map image in a report shows terrain but no route. */
  waypointPixels?: SnapshotMarker[];
}

/**
 * Capture the current frame of a live Mapbox GL map as a PNG data URL.
 *
 * Requires the map to have been constructed with `preserveDrawingBuffer:
 * true` — without it, `canvas.toDataURL()` returns a blank/transparent
 * image because the WebGL buffer is cleared right after each paint. This
 * project's `MapView.tsx` does not currently set that option; see the
 * integration notes in this module's test file / the feature's PR
 * description for the one-line change needed before wiring this up.
 */
export function captureMapSnapshot(map: mapboxgl.Map): MapSnapshot {
  const canvas = map.getCanvas();
  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
  };
}

/**
 * Temporarily fits the live map to `boundsPoints`, waits for the new
 * viewport to finish loading, captures a snapshot plus each waypoint's
 * projected pixel position, then restores the map's original view —
 * generating a report should never leave a pilot's live map panned/zoomed
 * somewhere else. Falls back to capturing whatever the map currently shows
 * (no view change) when there's nothing to fit to.
 */
export async function captureMissionMapSnapshot(
  map: mapboxgl.Map,
  boundsPoints: [number, number][], // [lng, lat][]
  waypoints: { latitude: number; longitude: number }[],
): Promise<MapSnapshot> {
  if (boundsPoints.length === 0) {
    return captureMapSnapshot(map);
  }

  const originalCenter = map.getCenter();
  const originalZoom = map.getZoom();
  const originalBearing = map.getBearing();
  const originalPitch = map.getPitch();

  let minLng = Infinity,
    maxLng = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity;
  for (const [lng, lat] of boundsPoints) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  try {
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 60, maxZoom: 18, animate: false },
    );
    await new Promise<void>((resolve) => {
      map.once("idle", () => resolve());
    });

    const snapshot = captureMapSnapshot(map);
    const waypointPixels = waypoints.map((wp, index) => {
      const point = map.project([wp.longitude, wp.latitude]);
      const prev = waypoints[index - 1];
      const segmentDistanceM = prev
        ? haversine(prev.latitude, prev.longitude, wp.latitude, wp.longitude)
        : undefined;
      return { x: point.x, y: point.y, index, segmentDistanceM };
    });
    return { ...snapshot, waypointPixels };
  } finally {
    map.jumpTo({
      center: originalCenter,
      zoom: originalZoom,
      bearing: originalBearing,
      pitch: originalPitch,
    });
  }
}

/**
 * Embed a captured map snapshot into a jsPDF document at `(x, y)`, scaled to
 * fit within `maxWidth` (and `maxHeight`, if given) while preserving aspect
 * ratio. Returns the y-coordinate immediately below the placed image, so
 * callers can continue laying out content beneath it.
 */
export function addMapSnapshotToPdf(
  doc: jsPDF,
  snapshot: MapSnapshot,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight?: number,
  unitSystem: UnitSystem = "metric",
): number {
  const aspectRatio = snapshot.height / snapshot.width;
  let width = maxWidth;
  let height = width * aspectRatio;

  if (maxHeight !== undefined && height > maxHeight) {
    height = maxHeight;
    width = height / aspectRatio;
  }

  doc.addImage(snapshot.dataUrl, "PNG", x, y, width, height);

  const markers = snapshot.waypointPixels;
  if (markers && markers.length > 0) {
    const scaleX = width / snapshot.width;
    const scaleY = height / snapshot.height;
    const savedFontSize = doc.getFontSize();
    const savedTextColor = doc.getTextColor();
    const inFrame = (px: number, py: number) =>
      px >= x && px <= x + width && py >= y && py <= y + height;

    // Segment distance labels first, so the numbered markers drawn after
    // them sit on top rather than under a label's background pill.
    doc.setFontSize(4.5);
    for (let i = 1; i < markers.length; i++) {
      const a = markers[i - 1];
      const b = markers[i];
      if (b.segmentDistanceM === undefined) continue;
      const midX = x + ((a.x + b.x) / 2) * scaleX;
      const midY = y + ((a.y + b.y) / 2) * scaleY;
      if (!inFrame(midX, midY)) continue;

      const label = formatDistance(b.segmentDistanceM, unitSystem);
      const textWidth = doc.getTextWidth(label);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(
        midX - textWidth / 2 - 0.8,
        midY - 1.9,
        textWidth + 1.6,
        3,
        0.5,
        0.5,
        "F",
      );
      doc.setTextColor(30, 30, 30);
      doc.text(label, midX, midY + 0.9, { align: "center" });
    }

    doc.setFillColor(0, 148, 196);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(5);
    for (const marker of markers) {
      const px = x + marker.x * scaleX;
      const py = y + marker.y * scaleY;
      // A marker can fall outside the captured frame if fitBounds' padding
      // rounded differently than expected at the aspect ratio jsPDF ended
      // up placing the image at — skip rather than draw off the image.
      if (!inFrame(px, py)) continue;
      doc.circle(px, py, 1.6, "F");
      doc.text(String(marker.index + 1), px, py + 0.6, { align: "center" });
    }
    doc.setFontSize(savedFontSize);
    doc.setTextColor(savedTextColor);
  }

  return y + height;
}
