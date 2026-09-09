import type { Waypoint } from "@droneroute/shared";
import { haversineDistance } from "@/lib/geo";
import {
  bearing,
  computeOrbitSeedForBuilding,
  destinationPoint,
} from "@/lib/templates";

/**
 * Reflowing waypoints after a building edit.
 *
 * A timelapse contract runs for months and the building it watches keeps
 * changing shape — a wing gets poured, the footprint grows past the fence.
 * The mission has to grow with it, but the waypoints whose footage is
 * already in the cut must not move a centimetre, or the next visit's frame
 * won't line up with the ones already shot. So the operator locks the
 * waypoints already filmed (`Waypoint.locked`), redraws the footprint, and
 * only the rest follow.
 *
 * The rule for "follow" is deliberately the conservative one: each unlocked
 * waypoint keeps its own bearing from the footprint's centroid and its own
 * standoff *relative to the recommended orbit radius* — it is re-hung from
 * the new centroid at the new radius plus whatever margin it already had.
 * Full regeneration from the orbit template would be tidier geometrically
 * but renumbers and respaces the arc, which breaks continuity with the
 * locked half of the very same flight; a pure centroid translation, at the
 * other extreme, would keep the drone at its old distance from a building
 * that just got wider, and crop it out of frame.
 *
 * Height, speed and gimbal pitch are left alone on purpose: the unlocked
 * waypoints have to keep matching the locked ones' look, and a shifted
 * radius of a few metres does not justify silently re-aiming a shot the
 * operator framed by hand.
 */

/** One waypoint's new horizontal position. Nothing else about it changes. */
export interface WaypointReflowMove {
  index: number;
  latitude: number;
  longitude: number;
}

export interface BuildingReflowResult {
  moves: WaypointReflowMove[];
  /** Recommended orbit radius for the footprint as it was, in meters. */
  oldRadiusM: number;
  /** Recommended orbit radius for the edited footprint, in meters. */
  newRadiusM: number;
  /** Waypoints held in place by their lock. */
  lockedCount: number;
  /** Waypoints that would move — always `moves.length`. */
  movedCount: number;
}

export interface BuildingReflowParams {
  oldVertices: [number, number][];
  newVertices: [number, number][];
  oldHeight: number;
  newHeight: number;
  waypoints: Waypoint[];
  /** Camera vertical FOV, forwarded to the orbit seed's framing math. */
  vfovDeg?: number;
  /**
   * Over how many waypoints the move ramps up to its full size as the route
   * leaves a locked stretch. `0` (the default) gives every unlocked waypoint
   * the full move, which puts a visible step in the flight path right where
   * the locked half ends. See `blendFactor`.
   */
  blendPoints?: number;
}

/**
 * Closest a reflowed waypoint may end up to the new centroid. Only ever
 * reached by shrinking a building so hard that a waypoint's old margin goes
 * negative; without the floor the point would be dragged through the
 * centroid and come out on the opposite side of the building, 180° from
 * where the operator put it.
 */
const MIN_STANDOFF_M = 1;

/** A polygon needs three corners before it has a centroid worth trusting. */
function isUsableFootprint(vertices: [number, number][]): boolean {
  return vertices.length >= 3;
}

/**
 * How much of the full move a waypoint gets, given how many waypoints along
 * the route it sits from the nearest locked one.
 *
 * A locked waypoint stays put and its neighbour, one frame later in the same
 * shot, would otherwise jump the whole new standoff — a visible kink in the
 * flight path, and a jump in the footage exactly where the old and new visits
 * are cut together. Ramping the move in over a handful of waypoints spreads
 * that difference across a stretch of the arc instead of putting it all in
 * one leg.
 *
 * Smoothstep rather than a straight line so the ramp also *starts* and *ends*
 * gently: a linear ramp removes the step in position but leaves a corner in
 * the path at both ends of the blend, which is the same artefact one scale
 * smaller.
 */
function blendFactor(distanceFromLocked: number, blendPoints: number): number {
  if (blendPoints <= 0) return 1;
  const t = Math.min(1, distanceFromLocked / (blendPoints + 1));
  return t * t * (3 - 2 * t);
}

/**
 * Distance, in waypoints along the route, from each waypoint to the nearest
 * locked one. `Infinity` everywhere when nothing is locked.
 *
 * Measured along the list, not through space: the point of the ramp is to
 * spread the change over consecutive frames of the shot, and consecutive
 * frames are what the list order describes. Deliberately does not wrap from
 * the last waypoint back to the first — a route is flown start to finish, and
 * even on an orbit that closes visually the aircraft does not fly that gap.
 */
function distancesFromLocked(waypoints: Waypoint[]): number[] {
  const distances = waypoints.map(() => Infinity);

  let seen = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    seen = waypoints[i].locked ? 0 : seen + 1;
    distances[i] = seen;
  }

  seen = Infinity;
  for (let i = waypoints.length - 1; i >= 0; i--) {
    seen = waypoints[i].locked ? 0 : seen + 1;
    distances[i] = Math.min(distances[i], seen);
  }

  return distances;
}

/**
 * New positions for the unlocked waypoints after a building's footprint or
 * height changed. `null` when there is nothing to propose — no unlocked
 * waypoints, an unusable footprint, or an edit that moved neither the
 * centroid nor the recommended radius.
 */
export function computeBuildingReflow({
  oldVertices,
  newVertices,
  oldHeight,
  newHeight,
  waypoints,
  vfovDeg,
  blendPoints = 0,
}: BuildingReflowParams): BuildingReflowResult | null {
  if (!isUsableFootprint(oldVertices) || !isUsableFootprint(newVertices)) {
    return null;
  }

  const unlocked = waypoints.filter((wp) => !wp.locked);
  if (unlocked.length === 0) return null;

  const oldSeed = computeOrbitSeedForBuilding(oldVertices, oldHeight, vfovDeg);
  const newSeed = computeOrbitSeedForBuilding(newVertices, newHeight, vfovDeg);

  const centroidShiftM = haversineDistance(
    oldSeed.center[0],
    oldSeed.center[1],
    newSeed.center[0],
    newSeed.center[1],
  );
  const deltaRadiusM = newSeed.radiusM - oldSeed.radiusM;
  // Sub-decimeter edits are noise from redrawing a vertex by hand, not an
  // intent to move the flight — proposing them would train the operator to
  // dismiss the confirmation bar without reading it.
  if (centroidShiftM < 0.1 && Math.abs(deltaRadiusM) < 0.1) return null;

  const lockedDistances = distancesFromLocked(waypoints);
  const positionInList = new Map(waypoints.map((wp, i) => [wp.index, i]));

  const moves = unlocked.map((wp) => {
    const bearingDeg = bearing(
      oldSeed.center[0],
      oldSeed.center[1],
      wp.latitude,
      wp.longitude,
    );
    const oldStandoffM = haversineDistance(
      oldSeed.center[0],
      oldSeed.center[1],
      wp.latitude,
      wp.longitude,
    );

    // A partial move is the same move, taken part of the way: the centre it
    // is measured from and the standoff it is given both slide from old to
    // new together, so the waypoint stays on a real orbit the whole way
    // through the ramp rather than drifting off one.
    const share = blendFactor(
      lockedDistances[positionInList.get(wp.index)!],
      blendPoints,
    );
    const centerLat =
      oldSeed.center[0] + (newSeed.center[0] - oldSeed.center[0]) * share;
    const centerLng =
      oldSeed.center[1] + (newSeed.center[1] - oldSeed.center[1]) * share;
    const newStandoffM = Math.max(
      MIN_STANDOFF_M,
      oldStandoffM + deltaRadiusM * share,
    );

    const [latitude, longitude] = destinationPoint(
      centerLat,
      centerLng,
      newStandoffM,
      bearingDeg,
    );
    return { index: wp.index, latitude, longitude };
  });

  return {
    moves,
    oldRadiusM: oldSeed.radiusM,
    newRadiusM: newSeed.radiusM,
    lockedCount: waypoints.length - unlocked.length,
    movedCount: moves.length,
  };
}
