import type { Waypoint, PointOfInterest } from "@droneroute/shared";
import { bearingTo, resolveHeading } from "@/components/map/CameraFrustum";
import { estimateWaypointArrivalTimes, haversine } from "@/lib/flightStats";
import { computeFramingPitch } from "@/lib/templates";
import { distanceToPolygonBoundaryM } from "@/lib/geo";
import type { TemplateGroup } from "@/store/missionStore";

/** Gimbal pitch (DJI convention: 0° = level, -90° = straight down) needed to
 * keep a point at `toHeight` centered in frame from `fromHeight`, at the
 * given great-circle distance — the vertical counterpart to `bearingTo`'s
 * horizontal aim. */
function pitchTo(
  fromLat: number,
  fromLng: number,
  fromHeight: number,
  toLat: number,
  toLng: number,
  toHeight: number,
): number {
  const horizontalDistM = haversine(fromLat, fromLng, toLat, toLng);
  const verticalDeltaM = toHeight - fromHeight;
  return (Math.atan2(verticalDeltaM, horizontalDistM) * 180) / Math.PI;
}

/** Frames generated per waypoint-to-waypoint leg — shared by the panel that
 * builds the frame sequence and the map layer that renders the current
 * frame, so both stay in lockstep off the same simulated flight time. */
export const FRAMES_PER_SEGMENT = 24;

export interface SimulationFrame {
  latitude: number;
  longitude: number;
  height: number;
  headingAngle: number;
  gimbalPitchAngle: number;
  /** Index of the waypoint this frame sits at or just after — drives the
   * "flying leg N of M" progress readout. */
  afterWaypointIndex: number;
  /** Elapsed real flight time at this frame, seconds — the same estimate
   * `estimateWaypointArrivalTimes` produces per waypoint, interpolated
   * within each leg. Frames within a leg are evenly spaced in *distance*,
   * not time, so this is NOT evenly spaced across a frame's index — a
   * consumer that wants "the frame `durationS` seconds into the flight"
   * needs `findFrameBracket`, not a flat index lookup. */
  timeS: number;
}

/** Finds the two frames bracketing a given elapsed real flight time, and the
 * fractional position between them (0 = at `frames[lower]`, 1 = at
 * `frames[upper]`) — the time-based equivalent of indexing into an
 * evenly-spaced array, needed because frames are spaced evenly by distance
 * within a leg, not by time (a slow or long leg still gets the same
 * `FRAMES_PER_SEGMENT` frames as a fast/short one, just covering more real
 * seconds between them). Frames are non-decreasing in `timeS`, so a binary
 * search finds the bracket in O(log n). */
export function findFrameBracket(
  frames: SimulationFrame[],
  timeS: number,
): { lower: number; upper: number; t: number } {
  if (frames.length <= 1) return { lower: 0, upper: 0, t: 0 };
  const clamped = Math.max(0, Math.min(timeS, frames[frames.length - 1].timeS));
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].timeS <= clamped) lo = mid;
    else hi = mid;
  }
  const spanS = frames[hi].timeS - frames[lo].timeS;
  const t = spanS > 0 ? (clamped - frames[lo].timeS) / spanS : 0;
  return { lower: lo, upper: hi, t };
}

/** Shortest-path interpolation between two headings in degrees, correctly
 * wrapping across the 0/360 boundary (e.g. 350° -> 10° goes forward through
 * 360°/0°, a 20° turn, not backward through 180°, a 340° turn). */
export function interpolateHeading(
  fromDeg: number,
  toDeg: number,
  t: number,
): number {
  let delta = ((toDeg - fromDeg + 540) % 360) - 180;
  return (fromDeg + delta * t + 360) % 360;
}

/** Smallest signed difference between two angles in degrees, in [-180, 180]. */
function angleDiffDeg(aDeg: number, bDeg: number): number {
  return ((aDeg - bDeg + 540) % 360) - 180;
}

/** Finds a POI that plausibly explains BOTH endpoints' own heading/pitch —
 * used for legs that don't use `headingMode: "towardPOI"` at all.
 *
 * Templates like Orbit already aim every individual waypoint at their
 * subject correctly: each waypoint's `headingAngle`/`gimbalPitchAngle` is
 * precomputed once, per-waypoint, toward the target (see
 * `generateOrbit`/`computeGimbalPitch` in lib/templates.ts) — but they save
 * that as `headingMode: "fixed"` with the numbers baked in, not as
 * `headingMode: "towardPOI"` with a live `poiId` reference (changing that
 * would change what gets written to the real WPML flight file, a much
 * bigger and riskier change than fixing the *simulation's* playback). That
 * meant this simulation had no way to know two "fixed" waypoints were
 * aiming at the same nearby subject, so it fell back to plain linear
 * interpolation of the two static angles — which, for anything on a curved
 * path around a close target (an orbit), drifts off the subject mid-leg
 * even though both endpoints individually frame it correctly.
 *
 * This recovers that intent without needing template changes: if some real
 * POI in the mission would produce (via `bearingTo`/`pitchTo`) close to the
 * same heading and pitch this waypoint was actually given, at both ends of
 * the leg, it's almost certainly what the waypoints were aimed at. */
function findImpliedPoi(
  from: Waypoint,
  to: Waypoint,
  pois: PointOfInterest[],
): PointOfInterest | undefined {
  const HEADING_TOLERANCE_DEG = 20;
  const PITCH_TOLERANCE_DEG = 15;

  return pois.find((poi) => {
    const fromHeading = bearingTo(
      from.latitude,
      from.longitude,
      poi.latitude,
      poi.longitude,
    );
    const fromPitch = pitchTo(
      from.latitude,
      from.longitude,
      from.height,
      poi.latitude,
      poi.longitude,
      poi.height,
    );
    const toHeading = bearingTo(
      to.latitude,
      to.longitude,
      poi.latitude,
      poi.longitude,
    );
    const toPitch = pitchTo(
      to.latitude,
      to.longitude,
      to.height,
      poi.latitude,
      poi.longitude,
      poi.height,
    );
    return (
      Math.abs(angleDiffDeg(from.headingAngle ?? 0, fromHeading)) <=
        HEADING_TOLERANCE_DEG &&
      Math.abs(from.gimbalPitchAngle - fromPitch) <= PITCH_TOLERANCE_DEG &&
      Math.abs(angleDiffDeg(to.headingAngle ?? 0, toHeading)) <=
        HEADING_TOLERANCE_DEG &&
      Math.abs(to.gimbalPitchAngle - toPitch) <= PITCH_TOLERANCE_DEG
    );
  });
}

/** Building footprint + target height for a leg's whole-object framing, when
 * that leg belongs to an orbit generated around a real building (see
 * `OrbitParams.buildingVertices` in lib/templates.ts). `undefined` for any
 * other leg — a manually-drawn orbit, a non-orbit template, or an orbit
 * that predates that field. `aimLat`/`aimLng` is the orbit's own center (the
 * camera's aim point for this leg) — kept alongside the footprint so heading
 * can be derived from the exact same target as pitch, rather than from
 * `findImpliedPoi`'s separate point-tracking check (see below). */
interface LegBuildingFraming {
  buildingVertices: [number, number][];
  poiHeight: number;
  aimLat: number;
  aimLng: number;
}

/** Looks up whether `from`'s leg belongs to a building-orbit template group
 * with real footprint data attached, via the same `templateGroupId` tag
 * `generateOrbit` stamps on every waypoint it creates. A building's real
 * footprint isn't circular, so `computeGimbalPitch`/`pitchTo`'s single-point
 * model (used by `findImpliedPoi` below) doesn't reproduce what
 * `generateOrbit` actually baked into these waypoints — recomputing pitch
 * per frame the *same* single-point way this leg's own static data was NOT
 * generated with would silently re-introduce the exact per-waypoint framing
 * drift the building-vertices fix in `generateOrbit` exists to remove.
 * `buildSimulationFrames` uses this instead of `findImpliedPoi`'s
 * point-tracking whenever it's available — for BOTH heading and pitch, not
 * just pitch: `findImpliedPoi`'s own tolerance check compares each
 * waypoint's static pitch against what simple point-tracking to "Střed
 * orbitu" would produce, but building-edge-aware pitch routinely differs
 * from that by more than its 15° tolerance, so it was silently failing to
 * recognize these legs at all — falling back to raw heading interpolation
 * between waypoints (the exact "drifts off the subject mid-leg" bug
 * `findImpliedPoi` exists to prevent) even though pitch was already fixed. */
function getLegBuildingFraming(
  from: Waypoint,
  templateGroups: Record<string, TemplateGroup>,
): LegBuildingFraming | undefined {
  const groupId = from.templateGroupId;
  if (!groupId) return undefined;
  const group = templateGroups[groupId];
  if (!group || group.type !== "orbit") return undefined;
  const params = group.params as {
    center?: [number, number];
    buildingVertices?: [number, number][];
    poiHeight?: number;
    altitudeGimbalLinked?: boolean;
    poiCenter?: [number, number];
  };
  if (params.poiCenter) return undefined; // same precedence as generateOrbit
  if (!params.altitudeGimbalLinked) return undefined; // manual pitch, don't override
  if (!params.buildingVertices || params.buildingVertices.length < 2) {
    return undefined;
  }
  if (!params.center) return undefined;
  return {
    buildingVertices: params.buildingVertices,
    poiHeight: params.poiHeight ?? 0,
    aimLat: params.center[0],
    aimLng: params.center[1],
  };
}

/**
 * Builds an animation-ready sequence of camera frames along the mission's
 * flight path, interpolating position, height, gimbal pitch, and heading
 * between each pair of consecutive waypoints — the same "fly a straight 3D
 * line leg to leg" model used elsewhere (see lib/terrain.ts).
 *
 * Heading AND gimbal pitch are both handled specially rather than naively
 * interpolated as raw numbers: when the leg's starting waypoint targets a
 * POI (`headingMode: "towardPOI"`), or — see `findImpliedPoi` — when a
 * `headingMode: "fixed"` leg's own precomputed static angles at both
 * endpoints line up with some real POI (the case for templates like Orbit,
 * which aim every waypoint correctly but bake the result into "fixed"
 * rather than a live POI reference), each interpolated frame recomputes
 * its own bearing *and* tilt to that POI. That keeps the target centered
 * in frame throughout the leg — including keeping a whole building in
 * view during an orbit — instead of drifting off it between waypoints,
 * which linearly interpolating the two static angles would do. Every
 * other leg falls back to shortest-path heading interpolation and linear
 * gimbal-pitch interpolation between the two waypoints' own values.
 *
 * Each frame's `timeS` comes from `estimateWaypointArrivalTimes` — the same
 * real-world-speed estimate the PDF report and flight-stats readout use —
 * interpolated linearly within a leg (each leg is flown at one constant
 * speed), so a `1x` playback of the resulting frames takes exactly as long
 * as the drone would actually take to fly the mission, and a slow/long leg
 * naturally plays back slower than a fast/short one instead of both taking
 * the same wall-clock time regardless of real distance or configured speed.
 *
 * `templateGroups` (optional, keyed the same way `missionStore.templateGroups`
 * is) lets a building-orbit leg use its own real footprint for pitch — see
 * `getLegBuildingFraming` — instead of `findImpliedPoi`'s single-point
 * model, which doesn't match what `generateOrbit` bakes into those
 * waypoints for a non-circular building and would otherwise silently
 * override it back to the old, less accurate framing during playback.
 */
export function buildSimulationFrames(
  waypoints: Waypoint[],
  pois: PointOfInterest[],
  framesPerSegment: number,
  autoFlightSpeedMps: number,
  templateGroups: Record<string, TemplateGroup> = {},
): SimulationFrame[] {
  if (waypoints.length === 0) return [];
  if (waypoints.length === 1) {
    const wp = waypoints[0];
    return [
      {
        latitude: wp.latitude,
        longitude: wp.longitude,
        height: wp.height,
        headingAngle: resolveHeading(wp, pois),
        gimbalPitchAngle: wp.gimbalPitchAngle,
        afterWaypointIndex: 0,
        timeS: 0,
      },
    ];
  }

  const arrivalTimesS = estimateWaypointArrivalTimes(
    waypoints,
    autoFlightSpeedMps,
  );

  const frames: SimulationFrame[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const fromHeading = resolveHeading(from, pois);
    const toHeading = resolveHeading(to, pois);
    const poi =
      from.headingMode === "towardPOI" && from.poiId
        ? pois.find((p) => p.id === from.poiId)
        : findImpliedPoi(from, to, pois);
    const buildingFraming = getLegBuildingFraming(from, templateGroups);
    const legStartS = arrivalTimesS[i];
    const legDurationS = arrivalTimesS[i + 1] - legStartS;

    const count = framesPerSegment;
    // Skip the last frame of every segment except the final one, so the
    // shared waypoint between two consecutive segments isn't duplicated.
    const end = i === waypoints.length - 2 ? count : count - 1;
    for (let j = 0; j < end; j++) {
      const t = j / (count - 1);
      const latitude = from.latitude + (to.latitude - from.latitude) * t;
      const longitude = from.longitude + (to.longitude - from.longitude) * t;
      const height = from.height + (to.height - from.height) * t;
      const heading = buildingFraming
        ? bearingTo(
            latitude,
            longitude,
            buildingFraming.aimLat,
            buildingFraming.aimLng,
          )
        : poi
          ? bearingTo(latitude, longitude, poi.latitude, poi.longitude)
          : interpolateHeading(fromHeading, toHeading, t);
      const gimbalPitchAngle = buildingFraming
        ? computeFramingPitch(
            height,
            buildingFraming.poiHeight,
            distanceToPolygonBoundaryM(
              [latitude, longitude],
              buildingFraming.buildingVertices,
            ),
          )
        : poi
          ? pitchTo(
              latitude,
              longitude,
              height,
              poi.latitude,
              poi.longitude,
              poi.height,
            )
          : from.gimbalPitchAngle +
            (to.gimbalPitchAngle - from.gimbalPitchAngle) * t;

      frames.push({
        latitude,
        longitude,
        height,
        headingAngle: heading,
        gimbalPitchAngle,
        afterWaypointIndex: i,
        timeS: legStartS + t * legDurationS,
      });
    }
  }
  return frames;
}

/** Builds a synthetic `Waypoint`-shaped object for a simulation frame, so
 * it can be rendered through the existing `CameraFrustum` component
 * unchanged — `headingMode: "fixed"` + a pre-resolved `headingAngle` means
 * `CameraFrustum`'s own heading resolution is a no-op for it. Fields
 * `CameraFrustum` doesn't read (name, speed, actions, ...) are filled with
 * inert placeholders. */
export function frameToWaypoint(frame: SimulationFrame): Waypoint {
  return {
    index: -1,
    name: "",
    latitude: frame.latitude,
    longitude: frame.longitude,
    height: frame.height,
    speed: 0,
    useGlobalSpeed: true,
    useGlobalHeight: true,
    useGlobalHeadingParam: true,
    useGlobalTurnParam: true,
    headingMode: "fixed",
    headingAngle: frame.headingAngle,
    gimbalPitchAngle: frame.gimbalPitchAngle,
    actions: [],
  };
}
