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

/** Seconds of `hover` action time configured at a single waypoint (0 if none). */
export function hoverTimeS(wp: FlightStatsWaypoint): number {
  let total = 0;
  for (const action of wp.actions ?? []) {
    if (action.actionType === "hover") {
      const params = action.params as Record<string, unknown>;
      const raw = params.hoverTime ?? params["wpml:hoverTime"];
      const value = typeof raw === "string" ? parseFloat(raw) : raw;
      total += typeof value === "number" && !isNaN(value) ? value : 0;
    }
  }
  return total;
}

/**
 * Cumulative estimated flight time (seconds from launch) at which the
 * aircraft reaches each waypoint — same index order as the input array,
 * `arrivalTimes[0]` is always 0 (already there at launch).
 *
 * Reuses the same physical assumptions as `estimateFlightStats` (segment
 * cruise time, hover actions, accel/decel ramps, stop-and-turn overhead),
 * but attributes each time cost to *when along the path* it's actually
 * incurred rather than summing everything into one total:
 * - A segment's travel time lands on the waypoint at its far end.
 * - Hover time and turn overhead "at" a waypoint delay everything *after*
 *   it, not the arrival at that waypoint itself.
 * - The start-of-flight accel ramp delays reaching waypoint 1 onward; the
 *   end-of-flight decel ramp only affects reaching the final waypoint.
 *
 * `arrivalTimes[last]` is "time to physically reach the final waypoint" —
 * it deliberately excludes hovering *at* that final waypoint (nothing
 * comes after it to be delayed by that hover), unlike every other
 * waypoint's hover, which delays reaching the *next* one. So
 * `arrivalTimes[last] + hoverTimeS(waypoints[last])` equals
 * `estimateFlightStats(waypoints, globalSpeedMps).timeS` exactly —
 * verified by a cross-check test rather than sharing implementation,
 * since the two were written independently and agreement between them is
 * itself useful evidence neither has a stray double-count or omission.
 */
export function estimateWaypointArrivalTimes(
  waypoints: FlightStatsWaypoint[],
  globalSpeedMps: number,
): number[] {
  if (waypoints.length === 0) return [];
  const arrivalTimes = [0];

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
    let delta = segDist / speed;

    delta += hoverTimeS(prev);

    // Turn overhead incurred while passing through `prev` — only defined
    // for an interior waypoint (has both an incoming and outgoing leg).
    if (i - 1 >= 1 && i - 1 <= waypoints.length - 2) {
      const beforePrev = waypoints[i - 2];
      const incomingBearing = bearing(
        beforePrev.latitude,
        beforePrev.longitude,
        prev.latitude,
        prev.longitude,
      );
      const outgoingBearing = bearing(
        prev.latitude,
        prev.longitude,
        curr.latitude,
        curr.longitude,
      );
      const turnAngle = angleBetweenBearings(incomingBearing, outgoingBearing);
      const prevSpeed = effectiveSpeed(prev, globalSpeedMps);

      if (prev.turnMode && STOP_TURN_MODES.includes(prev.turnMode)) {
        delta += (2 * prevSpeed) / ASSUMED_ACCEL_MPS2 + STOP_TURN_STABILIZE_S;
      } else if (
        turnAngle > SHARP_TURN_ANGLE_DEG &&
        (prev.turnDampingDist ?? 0) < SHARP_TURN_DAMPING_THRESHOLD_M
      ) {
        delta += (turnAngle / 180) * (prevSpeed / ASSUMED_ACCEL_MPS2);
      }
    }

    if (i === 1) {
      delta += effectiveSpeed(curr, globalSpeedMps) / ASSUMED_ACCEL_MPS2;
    }
    if (i === waypoints.length - 1) {
      delta += effectiveSpeed(curr, globalSpeedMps) / ASSUMED_ACCEL_MPS2;
    }

    arrivalTimes.push(arrivalTimes[i - 1] + delta);
  }

  // The final waypoint's own hover time is deliberately excluded — see
  // the doc comment above on how this relates to `estimateFlightStats`.
  return arrivalTimes;
}

export interface CaptureActionCounts {
  photoCount: number;
  videoCount: number;
}

/** Count `takePhoto` and `startRecord` actions across all waypoints. */
export function countCaptureActions(
  waypoints: { actions: { actionType: string }[] }[],
): CaptureActionCounts {
  let photoCount = 0;
  let videoCount = 0;
  for (const wp of waypoints) {
    for (const action of wp.actions) {
      if (action.actionType === "takePhoto") photoCount++;
      else if (action.actionType === "startRecord") videoCount++;
    }
  }
  return { photoCount, videoCount };
}

const DURATION_SOLVE_MIN_SPEED_MPS = 1;
const DURATION_SOLVE_MAX_SPEED_MPS = 15;
const DURATION_SOLVE_ITERATIONS = 40;

/**
 * Speed (m/s) needed for `waypoints` to have an estimated total flight
 * time as close as possible to `targetTimeS`, found via binary search
 * against `estimateFlightStats`. Under a single candidate speed applied
 * uniformly, `estimateFlightStats`'s total time reduces to `A/v + D*v + K`
 * (A = cruise distance, D ≥ 0 from the accel/turn-overhead terms, which
 * scale with speed themselves, K = constant hover time) — convex in `v`,
 * not simply decreasing, but checking the search bounds' time against
 * `targetTimeS` before searching (below) is enough to guarantee the
 * binary search still converges to the correct root whenever it doesn't
 * return `null`: the gate only admits targets that are ≤ the time at the
 * slowest speed and ≥ the time at the fastest, which for a convex curve
 * of this shape means the target lies on the strictly-decreasing branch
 * between them.
 *
 * `forceUniformSpeed` (default `true`) controls whether every waypoint is
 * overridden to the candidate speed while searching:
 * - `true` — models applying the solved speed directly to every one of
 *   `waypoints`' own `speed` fields (e.g. a bulk edit of a selection),
 *   so the search must vary each waypoint's effective speed in lockstep.
 * - `false` — models applying the solved speed only as the mission's
 *   *global* `autoFlightSpeed` default, leaving each waypoint's existing
 *   `useGlobalSpeed`/`speed` untouched — waypoints already overridden to
 *   their own fixed speed keep contributing their own (speed-independent)
 *   time, and only the global-speed segments respond to the candidate.
 *   Needed because applying only `autoFlightSpeed` (not per-waypoint
 *   overrides) is what `setConfig({ autoFlightSpeed })` actually changes;
 *   solving as if every waypoint adopted the candidate would silently
 *   promise a duration the mission won't actually have once waypoints
 *   with their own speed override are involved.
 *
 * Returns `null` when there's no path to solve for, or when the target
 * isn't reachable within `DURATION_SOLVE_MIN_SPEED_MPS`..`_MAX_SPEED_MPS`
 * (path too long to finish that fast even at max speed, too short to
 * take that long even at min speed, or — when `forceUniformSpeed` is
 * `false` — every waypoint already has its own fixed speed override, so
 * the global speed has no effect on the total at all).
 */
export function computeSpeedForDuration(
  waypoints: FlightStatsWaypoint[],
  targetTimeS: number,
  options: { forceUniformSpeed?: boolean } = {},
): number | null {
  const { forceUniformSpeed = true } = options;
  if (waypoints.length < 2 || !(targetTimeS > 0)) return null;

  const timeAtSpeed = (speed: number): number =>
    estimateFlightStats(
      forceUniformSpeed
        ? waypoints.map((wp) => ({ ...wp, useGlobalSpeed: false, speed }))
        : waypoints,
      speed,
    ).timeS;

  const timeAtMin = timeAtSpeed(DURATION_SOLVE_MIN_SPEED_MPS);
  const timeAtMax = timeAtSpeed(DURATION_SOLVE_MAX_SPEED_MPS);
  if (targetTimeS > timeAtMin || targetTimeS < timeAtMax) return null;

  let lo = DURATION_SOLVE_MIN_SPEED_MPS;
  let hi = DURATION_SOLVE_MAX_SPEED_MPS;
  for (let i = 0; i < DURATION_SOLVE_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (timeAtSpeed(mid) > targetTimeS) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return Math.round(((lo + hi) / 2) * 10) / 10;
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
