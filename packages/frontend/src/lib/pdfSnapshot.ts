import type { jsPDF } from "jspdf";
import type mapboxgl from "mapbox-gl";

/**
 * A captured map frame plus its pixel dimensions, so it can be embedded into
 * a PDF at the right aspect ratio without an async image load.
 */
export interface MapSnapshot {
  /** PNG data URL of the map canvas at capture time. */
  dataUrl: string;
  width: number;
  height: number;
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
): number {
  const aspectRatio = snapshot.height / snapshot.width;
  let width = maxWidth;
  let height = width * aspectRatio;

  if (maxHeight !== undefined && height > maxHeight) {
    height = maxHeight;
    width = height / aspectRatio;
  }

  doc.addImage(snapshot.dataUrl, "PNG", x, y, width, height);
  return y + height;
}
