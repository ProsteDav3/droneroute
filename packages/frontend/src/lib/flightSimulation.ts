import type { Waypoint, PointOfInterest } from "@droneroute/shared";
import { bearingTo, resolveHeading } from "@/components/map/CameraFrustum";

/** Frames generated per waypoint-to-waypoint leg — shared by the panel that
 * builds the frame sequence and the map layer that renders the current
 * frame, so both stay in lockstep off the same `frameIndex`. */
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

/**
 * Builds an animation-ready sequence of camera frames along the mission's
 * flight path, interpolating position, height, gimbal pitch, and heading
 * between each pair of consecutive waypoints — the same "fly a straight 3D
 * line leg to leg" model used elsewhere (see lib/terrain.ts).
 *
 * Heading is handled specially rather than naively interpolated as a raw
 * number: when the leg's starting waypoint targets a POI
 * (`headingMode: "towardPOI"`), each interpolated frame recomputes its own
 * bearing to that POI (so the simulated camera keeps tracking the target
 * throughout the leg, not just snapping to face it at each waypoint).
 * Every other heading mode falls back to shortest-path interpolation
 * between the two waypoints' resolved headings.
 */
export function buildSimulationFrames(
  waypoints: Waypoint[],
  pois: PointOfInterest[],
  framesPerSegment: number,
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
      },
    ];
  }

  const frames: SimulationFrame[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const fromHeading = resolveHeading(from, pois);
    const toHeading = resolveHeading(to, pois);
    const poi =
      from.headingMode === "towardPOI" && from.poiId
        ? pois.find((p) => p.id === from.poiId)
        : undefined;

    const count = framesPerSegment;
    // Skip the last frame of every segment except the final one, so the
    // shared waypoint between two consecutive segments isn't duplicated.
    const end = i === waypoints.length - 2 ? count : count - 1;
    for (let j = 0; j < end; j++) {
      const t = j / (count - 1);
      const latitude = from.latitude + (to.latitude - from.latitude) * t;
      const longitude = from.longitude + (to.longitude - from.longitude) * t;
      const heading = poi
        ? bearingTo(latitude, longitude, poi.latitude, poi.longitude)
        : interpolateHeading(fromHeading, toHeading, t);

      frames.push({
        latitude,
        longitude,
        height: from.height + (to.height - from.height) * t,
        headingAngle: heading,
        gimbalPitchAngle:
          from.gimbalPitchAngle +
          (to.gimbalPitchAngle - from.gimbalPitchAngle) * t,
        afterWaypointIndex: i,
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
