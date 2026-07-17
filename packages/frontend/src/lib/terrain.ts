import type mapboxgl from "mapbox-gl";
import type { HeightMode } from "@droneroute/shared";

/**
 * Queries the map's currently-set terrain (see MapView.tsx — terrain is
 * always active, just rendered flat via exaggeration 0 outside 3D mode) for
 * the real, unexaggerated ground elevation at each point, in meters above
 * sea level. A `null` entry means the DEM tile covering that point hasn't
 * finished loading yet — see `queryElevationProfileWithRetry` for handling
 * that instead of treating it as "no terrain data exists there".
 */
export function queryElevationProfile(
  map: mapboxgl.Map,
  points: { lat: number; lng: number }[],
): (number | null)[] {
  return points.map((p) => {
    const elevation = map.queryTerrainElevation(
      { lng: p.lng, lat: p.lat },
      { exaggerated: false },
    );
    return elevation ?? null;
  });
}

/**
 * Same as `queryElevationProfile`, but retries a few times a short delay
 * apart for any point that came back `null` — DEM tiles for an area the
 * user hasn't panned/zoomed into yet load asynchronously, so an immediate
 * query can legitimately miss data that's available a moment later.
 * Resolves once every point has a value or the retry budget is spent
 * (remaining nulls just mean genuinely unavailable terrain data, e.g. an
 * area outside Mapbox's DEM coverage).
 */
export async function queryElevationProfileWithRetry(
  map: mapboxgl.Map,
  points: { lat: number; lng: number }[],
  maxRetries = 5,
  retryDelayMs = 300,
): Promise<(number | null)[]> {
  let result = queryElevationProfile(map, points);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (!result.some((e) => e === null)) return result;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    const retried = queryElevationProfile(map, points);
    result = result.map((e, i) => e ?? retried[i]);
  }

  return result;
}

/**
 * Interpolates N evenly-spaced points (inclusive of both ends) along a
 * great-circle-approximated straight line between two waypoints — used to
 * sample terrain between waypoints, not just at them, since ground
 * elevation can rise well above the flight path mid-segment even when both
 * endpoints look clear.
 */
export function interpolatePoints(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  count: number,
): { lat: number; lng: number }[] {
  if (count < 2) return [from];
  const points: { lat: number; lng: number }[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    points.push({
      lat: from.lat + (to.lat - from.lat) * t,
      lng: from.lng + (to.lng - from.lng) * t,
    });
  }
  return points;
}

export interface FlightPathSample {
  lat: number;
  lng: number;
  /** Configured flight height at this point, in the mission's own
   * height-mode units (meters) — linearly interpolated between the two
   * bounding waypoints' heights, matching how the aircraft actually flies a
   * straight 3D line leg-to-leg. */
  height: number;
  /** Index of the waypoint this sample sits at or just after (0 for the
   * very first waypoint itself). */
  afterWaypointIndex: number;
}

/**
 * Samples the flight path at every waypoint plus `samplesPerSegment - 2`
 * evenly-spaced interior points per leg, interpolating both position and
 * configured height — used so a terrain check (or the elevation graph's
 * ground line) isn't blind to a hill rising mid-segment between two
 * waypoints that each individually look clear.
 */
export function buildFlightPathSamples(
  waypoints: { latitude: number; longitude: number; height: number }[],
  samplesPerSegment: number,
): FlightPathSample[] {
  if (waypoints.length === 0) return [];
  if (waypoints.length === 1) {
    return [
      {
        lat: waypoints[0].latitude,
        lng: waypoints[0].longitude,
        height: waypoints[0].height,
        afterWaypointIndex: 0,
      },
    ];
  }

  const samples: FlightPathSample[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const positions = interpolatePoints(
      { lat: from.latitude, lng: from.longitude },
      { lat: to.latitude, lng: to.longitude },
      samplesPerSegment,
    );
    // Skip the last point of every segment except the final one, so the
    // shared waypoint between two consecutive segments isn't duplicated.
    const end =
      i === waypoints.length - 2 ? positions.length : positions.length - 1;
    for (let j = 0; j < end; j++) {
      const t = j / (positions.length - 1);
      samples.push({
        ...positions[j],
        height: from.height + (to.height - from.height) * t,
        afterWaypointIndex: i,
      });
    }
  }
  return samples;
}

export interface TerrainCollisionWarning {
  afterWaypointIndex: number;
  /** How far below the minimum safe clearance the aircraft would be at this
   * sample, in meters (always > 0 — this only exists for actual problems). */
  shortfallM: number;
}

/** Minimum ground clearance treated as "safe" — the same order of magnitude
 * as GPS/DEM vertical accuracy, so this flags genuine risk rather than
 * noise from measurement error. */
export const MIN_TERRAIN_CLEARANCE_M = 15;

/**
 * Checks planned flight altitude against real ground elevation along the
 * path, returning every sample where clearance drops below
 * `MIN_TERRAIN_CLEARANCE_M`.
 *
 * Deliberately a no-op for `aboveGroundLevel` mode: that height mode means
 * the aircraft maintains height above whatever terrain is beneath it via
 * its own downward sensors in real time, so a static pre-flight terrain
 * profile isn't the relevant risk model there (sensor reliability is, which
 * this can't evaluate). For `relativeToStartPoint`, the first sample's
 * ground elevation stands in for the launch point's true elevation, so
 * segments are converted to absolute altitude via `launchGroundElevation +
 * sample.height`. For `EGM96` (already sea-level-referenced, like the DEM
 * data itself), `sample.height` is used directly.
 */
export function findTerrainCollisions(
  samples: FlightPathSample[],
  groundElevations: (number | null)[],
  heightMode: HeightMode,
): TerrainCollisionWarning[] {
  if (heightMode === "aboveGroundLevel") return [];
  if (samples.length === 0) return [];

  const launchGroundElevation = groundElevations[0];
  if (heightMode === "relativeToStartPoint" && launchGroundElevation === null) {
    return [];
  }

  const warnings: TerrainCollisionWarning[] = [];
  for (let i = 0; i < samples.length; i++) {
    const ground = groundElevations[i];
    if (ground === null) continue;

    const absoluteAltitude =
      heightMode === "EGM96"
        ? samples[i].height
        : (launchGroundElevation as number) + samples[i].height;

    const clearance = absoluteAltitude - ground;
    if (clearance < MIN_TERRAIN_CLEARANCE_M) {
      warnings.push({
        afterWaypointIndex: samples[i].afterWaypointIndex,
        shortfallM: MIN_TERRAIN_CLEARANCE_M - clearance,
      });
    }
  }
  return warnings;
}

/**
 * Computes a new height for each waypoint that would give it a constant
 * `targetAglM` clearance above the real ground beneath it — "terrain
 * following" for the two height modes where the aircraft doesn't already
 * do this live via its own sensors (see `findTerrainCollisions`'s doc
 * comment for why `aboveGroundLevel` is excluded here too: the mode itself
 * already means this).
 *
 * A waypoint whose ground elevation is unknown (still-loading DEM tile, or
 * `relativeToStartPoint` mode when the launch point's own elevation is
 * unknown) is simply omitted from the returned map rather than guessed —
 * callers should leave that waypoint's existing height untouched.
 */
export function computeTerrainFollowingHeights(
  waypointIndices: number[],
  groundElevations: (number | null)[],
  targetAglM: number,
  heightMode: HeightMode,
): Record<number, number> {
  if (heightMode === "aboveGroundLevel") return {};

  const launchGroundElevation = groundElevations[0];
  if (heightMode === "relativeToStartPoint" && launchGroundElevation === null) {
    return {};
  }

  const heights: Record<number, number> = {};
  for (let i = 0; i < waypointIndices.length; i++) {
    const ground = groundElevations[i];
    if (ground === null) continue;

    heights[waypointIndices[i]] =
      heightMode === "EGM96"
        ? ground + targetAglM
        : ground - (launchGroundElevation as number) + targetAglM;
  }
  return heights;
}
