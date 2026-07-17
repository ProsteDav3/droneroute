/** A simple lat/lng bounding box, matching the shape the backend airspace/NOTAM endpoints expect. */
export interface LatLngBBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Compute the bounding box of a set of points (e.g. mission waypoints).
 * Returns `null` for an empty input — callers should treat that as "no
 * mission area to query yet" rather than defaulting to some arbitrary box.
 */
export function computeBoundingBox(
  points: { latitude: number; longitude: number }[],
): LatLngBBox | null {
  if (points.length === 0) return null;

  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;

  for (const p of points) {
    if (p.latitude < south) south = p.latitude;
    if (p.latitude > north) north = p.latitude;
    if (p.longitude < west) west = p.longitude;
    if (p.longitude > east) east = p.longitude;
  }

  return { south, west, north, east };
}
