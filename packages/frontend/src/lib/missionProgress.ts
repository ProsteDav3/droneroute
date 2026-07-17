import type { Waypoint } from "@droneroute/shared";

export interface MissionProgress {
  /** Index of the last waypoint the aircraft has passed, or -1 if it hasn't
   * reached the first one yet. Every waypoint at or before this index counts
   * as "flown" for UI highlighting. */
  flownWaypointIndex: number;
  /** 0-100, clamped. */
  percentComplete: number;
  distanceRemainingM: number;
  /** Seconds, or null when speed is too low (near-stationary/landed) to
   * produce a meaningful estimate rather than a wildly inflated one. */
  etaSeconds: number | null;
}

const MIN_SPEED_FOR_ETA_MS = 0.5;

/**
 * Projects the aircraft's current position onto the mission's flight path
 * (the straight-line segments between consecutive waypoints) to estimate
 * how far along the route it is. Uses a local equirectangular approximation
 * (flat-plane projection scaled by cos(latitude)) rather than true geodesics
 * — accurate enough at the scale of a single mission's waypoint spacing,
 * much cheaper than exact great-circle segment projection.
 *
 * This is a "nearest point on path" heuristic, not a firm guarantee the
 * aircraft is actually flying THIS mission — it assumes whichever telemetry
 * position is passed in corresponds to this mission's own flight, which
 * holds for the common single-aircraft, one-mission-at-a-time case this
 * feature targets.
 */
export function computeMissionProgress(
  waypoints: Waypoint[],
  currentPosition: { lat: number; lng: number },
  currentSpeedMs: number | undefined,
): MissionProgress | null {
  if (waypoints.length < 2) return null;

  // Local flat-plane projection, meters, centered near the route so the
  // cos(latitude) longitude scaling stays accurate across the whole path.
  const originLat = waypoints[0].latitude;
  const cosLat = Math.cos((originLat * Math.PI) / 180);
  const toXY = (lat: number, lng: number): [number, number] => [
    (lng - waypoints[0].longitude) * 111320 * cosLat,
    (lat - originLat) * 110540,
  ];

  const points = waypoints.map((wp) => toXY(wp.latitude, wp.longitude));
  const current = toXY(currentPosition.lat, currentPosition.lng);

  const segmentLengths: number[] = [];
  const cumulativeDistances: number[] = [0];
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    segmentLengths.push(len);
    cumulativeDistances.push(cumulativeDistances[i] + len);
  }
  const totalDistance = cumulativeDistances[cumulativeDistances.length - 1];
  if (totalDistance === 0) return null;

  let bestSegmentIndex = 0;
  let bestDistanceAlongPath = 0;
  let bestPerpendicularDist = Infinity;

  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const segLen = segmentLengths[i];
    if (segLen === 0) continue;

    // Project `current` onto the segment, clamped to [0, 1] so the closest
    // point stays on the segment rather than its infinite extension.
    const t = Math.max(
      0,
      Math.min(
        1,
        ((current[0] - x1) * (x2 - x1) + (current[1] - y1) * (y2 - y1)) /
          (segLen * segLen),
      ),
    );
    const closestX = x1 + t * (x2 - x1);
    const closestY = y1 + t * (y2 - y1);
    const perpDist = Math.hypot(current[0] - closestX, current[1] - closestY);

    if (perpDist < bestPerpendicularDist) {
      bestPerpendicularDist = perpDist;
      bestSegmentIndex = i;
      bestDistanceAlongPath = cumulativeDistances[i] + t * segLen;
    }
  }

  const percentComplete = Math.max(
    0,
    Math.min(100, (bestDistanceAlongPath / totalDistance) * 100),
  );
  const distanceRemainingM = Math.max(0, totalDistance - bestDistanceAlongPath);
  const etaSeconds =
    currentSpeedMs && currentSpeedMs >= MIN_SPEED_FOR_ETA_MS
      ? distanceRemainingM / currentSpeedMs
      : null;

  return {
    flownWaypointIndex: bestSegmentIndex,
    percentComplete,
    distanceRemainingM,
    etaSeconds,
  };
}
