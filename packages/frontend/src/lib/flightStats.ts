import type { TurnMode } from "@droneroute/shared";

/** A minimal waypoint shape — callers can pass full `Waypoint` objects, template previews, or anything with these fields. */
export interface FlightStatsWaypoint {
  latitude: number;
  longitude: number;
  speed: number;
  useGlobalSpeed: boolean;
  turnMode?: TurnMode;
  turnDampingDist?: number;
  actions?: { actionType: string; params: unknown }[];
}

export interface FlightStats {
  distanceM: number;
  timeS: number;
}

const EARTH_RADIUS_M = 6371000;

export function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Bearing (degrees, 0=N, CW) from point A to point B. */
function bearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return ((toDeg(Math.atan2(y, x)) % 360) + 360) % 360;
}

/** Smallest angle (0-180°) between two bearings. */
function angleBetweenBearings(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

const STOP_TURN_MODES: TurnMode[] = [
  "toPointAndStopWithDiscontinuityCurvature",
  "toPointAndStopWithContinuityCurvature",
];

// DJI doesn't publish the exact flight-dynamics model DJI Pilot/Fly use to
// compute their own on-screen duration estimate, so these are reasonable,
// documented assumptions rather than a spec-matched simulation — the goal
// is to get materially closer than a flat distance/speed estimate (which
// implicitly assumes instant acceleration and zero turn cost), not to
// exactly reproduce DJI's own number.
const ASSUMED_ACCEL_MPS2 = 2; // conservative ascent/cruise accel for M300/M350/M4-class aircraft
const STOP_TURN_STABILIZE_S = 1; // brief pause to settle + rotate at a full-stop waypoint
const SHARP_TURN_ANGLE_DEG = 60; // turns sharper than this get a slowdown even without an explicit stop
const SHARP_TURN_DAMPING_THRESHOLD_M = 5; // below this damping distance, a sharp turn can't be taken at full cruise speed
const FALLBACK_SPEED_MPS = 7; // used when a speed is missing/invalid, so covering real distance is never silently counted as taking zero time

function effectiveSpeed(
  wp: FlightStatsWaypoint,
  globalSpeedMps: number,
): number {
  const speed = wp.useGlobalSpeed ? globalSpeedMps : wp.speed;
  return speed > 0 ? speed : FALLBACK_SPEED_MPS;
}

/**
 * Estimate total distance (m) and flight time (s) for a waypoint path.
 * Time = per-segment cruise time (distance / speed) plus:
 * - explicit hover-action time
 * - full accel/decel ramp at the very start and end of the path
 * - full stop-and-turn overhead at waypoints whose turn mode stops the aircraft
 * - a partial slowdown for sharp, undamped turns that don't otherwise stop
 */
export function estimateFlightStats(
  waypoints: FlightStatsWaypoint[],
  globalSpeedMps: number,
): FlightStats {
  let distanceM = 0;
  let timeS = 0;

  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const segDist = haversine(
      prev.latitude,
      prev.longitude,
      curr.latitude,
      curr.longitude,
    );
    const speed = effectiveSpeed(curr, globalSpeedMps);
    distanceM += segDist;
    timeS += segDist / speed;
  }

  for (const wp of waypoints) {
    for (const action of wp.actions ?? []) {
      if (action.actionType === "hover") {
        // Actions authored fresh in the app's own ActionEditor store
        // `hoverTime` as a plain number, but a mission imported from KMZ
        // carries the raw parsed-XML shape instead ("wpml:hoverTime", as a
        // string) — check both so imported hover actions aren't silently
        // counted as 0s.
        const params = action.params as Record<string, unknown>;
        const raw = params.hoverTime ?? params["wpml:hoverTime"];
        const hoverTime = typeof raw === "string" ? parseFloat(raw) : raw;
        timeS +=
          typeof hoverTime === "number" && !isNaN(hoverTime) ? hoverTime : 0;
      }
    }
  }

  // Ramp-up from a standstill at the very start, and ramp-down to a
  // standstill at the very end — the per-segment loop above implicitly
  // assumes the aircraft is already at cruise speed for every segment.
  if (waypoints.length >= 2) {
    const last = waypoints[waypoints.length - 1];
    timeS += effectiveSpeed(waypoints[1], globalSpeedMps) / ASSUMED_ACCEL_MPS2;
    timeS += effectiveSpeed(last, globalSpeedMps) / ASSUMED_ACCEL_MPS2;
  }

  for (let i = 1; i < waypoints.length - 1; i++) {
    const prevWp = waypoints[i - 1];
    const wp = waypoints[i];
    const nextWp = waypoints[i + 1];
    const speed = effectiveSpeed(wp, globalSpeedMps);

    const incomingBearing = bearing(
      prevWp.latitude,
      prevWp.longitude,
      wp.latitude,
      wp.longitude,
    );
    const outgoingBearing = bearing(
      wp.latitude,
      wp.longitude,
      nextWp.latitude,
      nextWp.longitude,
    );
    const turnAngle = angleBetweenBearings(incomingBearing, outgoingBearing);

    if (wp.turnMode && STOP_TURN_MODES.includes(wp.turnMode)) {
      timeS += (2 * speed) / ASSUMED_ACCEL_MPS2 + STOP_TURN_STABILIZE_S;
    } else if (
      turnAngle > SHARP_TURN_ANGLE_DEG &&
      (wp.turnDampingDist ?? 0) < SHARP_TURN_DAMPING_THRESHOLD_M
    ) {
      timeS += (turnAngle / 180) * (speed / ASSUMED_ACCEL_MPS2);
    }
  }

  return { distanceM, timeS };
}

/** Format seconds into a human-readable duration, e.g. "1m 5s", "2h 3m". */
export function formatFlightDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m${secs > 0 ? ` ${secs}s` : ""}`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h${remainMins > 0 ? ` ${remainMins}m` : ""}`;
}
