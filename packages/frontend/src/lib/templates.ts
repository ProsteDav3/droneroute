import type {
  Waypoint,
  PointOfInterest,
  WaypointAction,
} from "@droneroute/shared";
import { DEFAULT_WAYPOINT } from "@droneroute/shared";
import { distanceToPolygonBoundaryM, polygonCentroid } from "@/lib/geo";

// ── Helpers ──────────────────────────────────────────────

/** Move a lat/lng point by a distance (meters) and bearing (degrees, 0=N) */
export function destinationPoint(
  lat: number,
  lng: number,
  distanceM: number,
  bearingDeg: number,
): [number, number] {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat1 = toRad(lat);
  const lng1 = toRad(lng);
  const brng = toRad(bearingDeg);
  const d = distanceM / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );

  return [toDeg(lat2), toDeg(lng2)];
}

/** Bearing from point A to point B in degrees (0=N, 90=E) */
export function bearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Haversine distance in meters */
function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Template Types ───────────────────────────────────────

export type TemplateType =
  | "orbit"
  | "grid"
  | "facade"
  | "pencil"
  | "solar"
  | "corridor"
  | "turbine";

/**
 * "photo" takes a photo at every waypoint (the original behavior). "video"
 * starts recording at the first waypoint and stops at the last, so the
 * drone flies the whole path with the camera rolling instead of stopping
 * for a shot at each point.
 */
export type CaptureMode = "photo" | "video";

export interface OrbitParams {
  center: [number, number]; // [lat, lng]
  radiusM: number;
  altitude: number;
  numPoints: number;
  clockwise: boolean;
  createPoi: boolean;
  /** Start bearing in degrees, 0=North. Ignored for a full 360° circle. */
  startAngleDeg: number;
  /**
   * End bearing in degrees. When `endAngleDeg - startAngleDeg >= 360` the
   * result is a closed loop (original full-circle behavior). Otherwise the
   * generator places `numPoints` waypoints from startAngleDeg to endAngleDeg
   * inclusive (the first/last waypoint always lands exactly on the two
   * bearings the caller asked for, regardless of `clockwise`). `clockwise`
   * then only picks *which* of the two arcs between those bearings to fly:
   * the direct increasing-angle sweep, or the complementary arc the other
   * way around the circle.
   */
  endAngleDeg: number;
  /** Real height of the point the camera should look at (e.g. a rooftop). */
  poiHeight: number;
  /** Current gimbal pitch (degrees, negative = looking down) applied to every waypoint. */
  gimbalPitchDeg: number;
  /**
   * When true (default), editing altitude/gimbal pitch/radius/POI height
   * keeps the other of {altitude, gimbalPitchDeg} in sync via the
   * radius/height-difference geometry. Set to false to "lock" the current
   * pair and edit either one independently without the other jumping.
   */
  altitudeGimbalLinked: boolean;
  /**
   * Independent camera aim point, decoupled from `center`. When undefined
   * (default), the camera aims at `center` itself — the flight circle and
   * the POI are the same point, exactly as before this field existed. When
   * set, the flight circle can be moved/resized independently while the
   * camera keeps aiming at this fixed point (distance-to-target then varies
   * per waypoint, so gimbal pitch is recomputed per waypoint instead of
   * flat).
   */
  poiCenter?: [number, number];
  /** Unset means no capture actions at all — matches every orbit generated before this field existed. `DEFAULT_ORBIT_PARAMS` sets "photo" for newly created orbits. */
  captureMode?: CaptureMode;
  /**
   * The building footprint this orbit was recommended for, if any (set by
   * `orbitParamsForBuilding`). A real building's footprint isn't circular,
   * so its actual distance from the flight circle varies by waypoint — much
   * closer on the side facing a long edge than on the side facing a corner
   * — even though every waypoint sits at the same `radiusM` from `center`.
   * When present and `altitudeGimbalLinked` is true, `generateOrbit` uses
   * each waypoint's own real distance to the building's nearest edge for
   * its gimbal pitch instead of the single flat `gimbalPitchDeg`, so the
   * whole building stays framed consistently around the entire orbit
   * instead of only at the one bearing `radiusM` was actually sized for.
   * Ignored when `poiCenter` is set — that path already recomputes pitch
   * per waypoint from a real target position, which building-edge
   * proximity would only fight with.
   */
  buildingVertices?: [number, number][];
}

export interface GridParams {
  corner1: [number, number]; // [lat, lng]
  corner2: [number, number]; // [lat, lng]
  altitude: number;
  spacingM: number; // distance between flight lines (cross-track)
  /**
   * Distance between photos along each flight line (along-track). Missing
   * on data saved before this field existed — `generateGrid` falls back to
   * `spacingM` in that case, which still places interior photos (a strict
   * improvement over the old endpoints-only behavior) without requiring a
   * migration.
   */
  photoSpacingM?: number;
  /** @deprecated superseded by captureMode, kept for old saved data — true means "photo" when captureMode is unset. */
  addPhotos: boolean;
  rotationDeg: number; // rotation of the grid in degrees (0-360)
  reverse: boolean; // fly the grid in reverse order
  captureMode?: CaptureMode;
  /** Flies a second pass rotated 90° from the first ("crosshatch" or
   * "double grid") — recommended for 3D reconstruction (photogrammetry
   * meshes), where a single-direction grid alone tends to leave vertical
   * surfaces (walls, roof edges) poorly reconstructed. Unset/false means
   * the original single-pass behavior. */
  crosshatch?: boolean;
}

export interface FacadeParams {
  point1: [number, number]; // [lat, lng] — one end of wall
  point2: [number, number]; // [lat, lng] — other end of wall
  distanceM: number; // distance from wall
  minAltitude: number;
  maxAltitude: number;
  numRows: number;
  numColumns: number;
  /** @deprecated superseded by captureMode, kept for old saved data — true means "photo" when captureMode is unset. */
  addPhotos: boolean;
  captureMode?: CaptureMode;
}

export interface PencilParams {
  path: [number, number][]; // raw drawn points [lat, lng]
  numPoints: number; // target waypoint count
  altitude: number;
  speed: number;
  gimbalPitchAngle: number;
  reverse: boolean;
  poiId?: string; // optional POI to face during flight
  /** Unset means no capture actions at all — matches every pencil path generated before this field existed. `DEFAULT_PENCIL_PARAMS` sets "photo" for newly created paths. */
  captureMode?: CaptureMode;
}

export interface CorridorParams {
  /** Drawn centerline of the structure — a bridge span, pipeline, power line row, road, or railway — [lat, lng][]. */
  path: [number, number][];
  numPoints: number; // target waypoint count per pass
  altitude: number;
  /** Lateral spacing (m) between adjacent parallel passes offset from the centerline. */
  offsetM: number;
  /** How many parallel passes to fly. 1 = centerline only; odd counts include an exact centerline pass, even counts straddle it symmetrically. */
  numPasses: number;
  speed: number;
  gimbalPitchAngle: number;
  reverse: boolean;
  captureMode?: CaptureMode;
}

export interface TurbineParams {
  /** Rotor hub position, [lat, lng]. */
  hubCenter: [number, number];
  /** Height (AGL) of the rotor hub. */
  hubHeight: number;
  bladeLengthM: number;
  numBlades: number;
  /** Compass bearing the rotor's sweep-plane faces (0 = north) — perpendicular to the disc the blades sweep through. Must be set to match the actual turbine's orientation; there's no sensible default. */
  rotorYawDeg: number;
  /** Angle of blade 1 within the sweep-plane's own local frame, 0 = straight up, increasing clockwise (as seen facing the rotor). The other blades are evenly spaced from it by 360/numBlades. */
  blade1AngleDeg: number;
  /** Standoff distance (m) from the sweep-plane the drone hovers at. */
  standoffM: number;
  /** Extra chordwise offset (m) between passes, for covering the leading vs. trailing edge of the blade. */
  edgeSpacingM: number;
  /** How many passes to fly per blade. 1 = along the blade's own centerline only; 2+ spread symmetrically across the chord for edge coverage. */
  numPasses: number;
  numPointsPerBlade: number;
  speed: number;
  gimbalPitchAngle: number;
  /** Creates a POI at the hub, purely as a visual reference — heading is baked into each waypoint directly (like Orbit), not derived from this POI. */
  createPoi: boolean;
  captureMode?: CaptureMode;
}

export interface SolarParams {
  /** Polygon boundary traced around the panel array, [lat, lng][], 3+ points. */
  vertices: [number, number][];
  altitude: number;
  spacingM: number; // distance between flight lines (cross-track)
  /** Distance between photos along each flight line (along-track). */
  photoSpacingM: number;
  /** Flight-line direction, bearing in degrees (0 = north) — set by the user's drawn reference line so lines run parallel to the actual panel rows instead of a guessed edge. */
  rowAngleDeg: number;
  /** @deprecated superseded by captureMode, kept for old saved data — true means "photo" when captureMode is unset. */
  addPhotos: boolean;
  captureMode?: CaptureMode;
}

export type TemplateParams =
  | OrbitParams
  | GridParams
  | FacadeParams
  | PencilParams
  | SolarParams
  | CorridorParams
  | TurbineParams;

export interface TemplateResult {
  waypoints: Omit<Waypoint, "index" | "name">[];
  pois: Omit<PointOfInterest, "id">[];
}

// ── Default Params ───────────────────────────────────────

export const DEFAULT_ORBIT_PARAMS: Omit<OrbitParams, "center" | "radiusM"> = {
  altitude: 30,
  numPoints: 12,
  clockwise: true,
  createPoi: true,
  startAngleDeg: 0,
  endAngleDeg: 360,
  poiHeight: 0,
  gimbalPitchDeg: -45,
  altitudeGimbalLinked: true,
  captureMode: "photo",
};

export const DEFAULT_GRID_PARAMS: Omit<GridParams, "corner1" | "corner2"> = {
  altitude: 80,
  spacingM: 30,
  photoSpacingM: 20,
  addPhotos: true,
  rotationDeg: 0,
  reverse: false,
  captureMode: "photo",
  crosshatch: false,
};

export const DEFAULT_FACADE_PARAMS: Omit<FacadeParams, "point1" | "point2"> = {
  distanceM: 20,
  minAltitude: 10,
  maxAltitude: 30,
  numRows: 4,
  numColumns: 8,
  addPhotos: true,
  captureMode: "photo",
};

export const DEFAULT_PENCIL_PARAMS: Omit<PencilParams, "path"> = {
  numPoints: 10,
  altitude: 30,
  speed: 7,
  gimbalPitchAngle: -45,
  reverse: false,
  captureMode: "photo",
};

export const DEFAULT_CORRIDOR_PARAMS: Omit<CorridorParams, "path"> = {
  numPoints: 20,
  altitude: 40,
  offsetM: 10,
  numPasses: 2,
  speed: 5,
  gimbalPitchAngle: -30,
  reverse: false,
  captureMode: "photo",
};

export const DEFAULT_TURBINE_PARAMS: Omit<TurbineParams, "hubCenter"> = {
  hubHeight: 90,
  bladeLengthM: 55,
  numBlades: 3,
  rotorYawDeg: 0,
  blade1AngleDeg: 0,
  standoffM: 10,
  edgeSpacingM: 3,
  numPasses: 2,
  numPointsPerBlade: 15,
  speed: 3,
  gimbalPitchAngle: 0,
  createPoi: true,
  captureMode: "photo",
};

export const DEFAULT_SOLAR_PARAMS: Omit<
  SolarParams,
  "vertices" | "rowAngleDeg"
> = {
  altitude: 30,
  spacingM: 10,
  photoSpacingM: 8,
  addPhotos: true,
  captureMode: "photo",
};

// ── Altitude / gimbal pitch geometry ─────────────────────

/**
 * Gimbal pitch (degrees, -90 = straight down, 0 = horizon) needed to keep a
 * point `poiHeight` meters up centered in frame from `radiusM` meters away
 * horizontally, while flying at `altitude`.
 */
export function computeGimbalPitch(
  altitude: number,
  poiHeight: number,
  radiusM: number,
): number {
  const heightDiff = altitude - poiHeight;
  const pitchRad = Math.atan2(heightDiff, radiusM);
  return Math.round(-pitchRad * (180 / Math.PI));
}

/** Sane flight-ceiling cap for altitudes derived from a gimbal pitch. */
const MAX_DERIVED_ALTITUDE_M = 500;

/**
 * Inverse of computeGimbalPitch: altitude needed to hit a target pitch.
 *
 * At exactly ±90° (straight down/up) there is no finite altitude that
 * keeps a point `radiusM` away horizontally centered in frame — the
 * required altitude grows without bound as pitch approaches that limit.
 * `Math.tan()` doesn't throw there (π/2 isn't exactly representable in
 * float64, so it returns an enormous but finite number instead of Infinity),
 * so without a guard this silently produces astronomical altitudes. Clamp
 * the input away from the asymptote and cap the output so this always
 * returns something you could actually fly.
 */
export function computeAltitudeForPitch(
  gimbalPitchDeg: number,
  poiHeight: number,
  radiusM: number,
): number {
  const clampedPitch = Math.max(-89, Math.min(89, gimbalPitchDeg));
  const pitchRad = (-clampedPitch * Math.PI) / 180;
  const altitude = poiHeight + radiusM * Math.tan(pitchRad);
  return Math.max(1, Math.min(MAX_DERIVED_ALTITUDE_M, Math.round(altitude)));
}

// ── FOV-aware object framing ──────────────────────────────

/**
 * Aspirational fraction of the camera's true vertical FOV the framed object
 * should occupy, used whenever it's actually achievable. The achievable
 * span for a fixed radius is capped at 2*atan(poiHeight/(2*radiusM))
 * (maximized at altitude=poiHeight/2), which shrinks fast as radius grows —
 * radius/altitude combinations well beyond a building's own height (the
 * overwhelmingly common case: flying 75-150m over a 30-40m building) make
 * even a modest fixed fraction unreachable. `computeFramedForRadius`/
 * `computeFramedForAltitude` cap their actual target at whatever's
 * achievable for the given fixed dimension (see `maxSpanForRadius`/
 * `maxSpanForAltitude`) instead of failing outright, so this constant only
 * matters for close-range shots where hitting it is actually possible.
 */
const FOV_SAFETY_MARGIN = 0.5;
/** Stay a hair under the true maximum so the solve keeps two distinct (if close) roots instead of sitting exactly on a repeated-root boundary. */
const MAX_SPAN_SAFETY_FACTOR = 0.98;

/** Vertical FOV (degrees) of a typical DJI wide-angle payload — used as the
 * whole-object-framing target when the mission's own drone/camera model
 * isn't known (no `payloadEnumValue` set, or one without FOV data in
 * `WIDE_CAMERA_FOV`). Without this fallback, `OrbitFields` silently
 * degraded to aiming at a single point instead of framing the whole target
 * whenever no specific camera was picked — which read as "the gimbal isn't
 * framing the whole building" even though the "keep it framed" toggle was
 * on the whole time; this makes that framing the default regardless of
 * whether a specific model was ever selected. Matches `CameraFrustum`'s own
 * default FOV assumption for the same generic-camera case. */
export const DEFAULT_WIDE_VFOV_DEG = 63;

/** Maximum vertical span (radians) any altitude can achieve for a fixed radiusM — occurs at altitude = poiHeight/2. */
function maxSpanForRadius(poiHeight: number, radiusM: number): number {
  return 2 * Math.atan(poiHeight / (2 * radiusM));
}

/**
 * Maximum vertical span (radians) any radius can achieve for a fixed
 * altitude, valid only for altitude > poiHeight (camera above the object's
 * top) — occurs at radiusM = sqrt(altitude*(altitude-poiHeight)).
 */
function maxSpanForAltitude(altitude: number, poiHeight: number): number {
  return Math.atan(
    poiHeight / (2 * Math.sqrt(altitude * (altitude - poiHeight))),
  );
}

/** Sane radius bounds for values derived from a framing solve. */
const MIN_RADIUS_M = 5;
const MAX_RADIUS_M = 2000;

/** Real roots of ax^2+bx+c=0, ascending, or null if none (negative discriminant). */
function solveQuadratic(
  a: number,
  b: number,
  c: number,
): [number, number] | null {
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const sqrtD = Math.sqrt(discriminant);
  const r1 = (-b - sqrtD) / (2 * a);
  const r2 = (-b + sqrtD) / (2 * a);
  return r1 <= r2 ? [r1, r2] : [r2, r1];
}

/** Picks whichever positive root is closest to `prev`, or (absent a previous value) the smaller/larger one per `preferLarger`. Null when neither root is positive. */
function pickPositiveRoot(
  roots: [number, number],
  prev: number | undefined,
  preferLarger: boolean,
): number | null {
  const positive = roots.filter((r) => r > 0);
  if (positive.length === 0) return null;
  if (positive.length === 1) return positive[0];
  if (prev !== undefined) {
    return Math.abs(positive[0] - prev) <= Math.abs(positive[1] - prev)
      ? positive[0]
      : positive[1];
  }
  return preferLarger ? positive[1] : positive[0];
}

/** Gimbal pitch (degrees) that vertically centers the view between ground level and poiHeight, from radiusM away, flying at altitude — unlike computeGimbalPitch, this aims at the object's midpoint, not its top. Exported for lib/flightSimulation.ts, which needs the identical formula to keep the 3D flythrough's continuous per-frame pitch consistent with what generateOrbit bakes into the real per-waypoint data. */
export function computeFramingPitch(
  altitude: number,
  poiHeight: number,
  radiusM: number,
): number {
  const angleBottom = Math.atan2(altitude, radiusM);
  const angleTop = Math.atan2(altitude - poiHeight, radiusM);
  const midAngle = (angleBottom + angleTop) / 2;
  return Math.round(-midAngle * (180 / Math.PI));
}

/**
 * Altitude (and centering gimbal pitch) needed so an object spanning ground
 * level (0m) to `poiHeight` fits inside `vfovDeg`, viewed from `radiusM`
 * away horizontally. Targets `FOV_SAFETY_MARGIN` of the camera's FOV when
 * that's achievable at this radius; otherwise targets the maximum span this
 * radius can ever achieve (see `maxSpanForRadius`) instead of failing — a
 * real solution always exists here for any `radiusM`/`poiHeight` > 0. Two
 * altitudes can produce the same angular span (a steep-close vs. a flat-far
 * viewing geometry) — `prevAltitude`, when given, picks whichever is closer
 * to avoid a visual jump on edit; otherwise the higher (looking-down)
 * altitude is preferred, matching this app's usual -45°-ish orbit
 * convention. Returns `null` only when `poiHeight`/`radiusM` aren't
 * positive — callers must fall back to `computeGimbalPitch`-based linking
 * in that case.
 */
export function computeFramedForRadius(
  radiusM: number,
  poiHeight: number,
  vfovDeg: number,
  prevAltitude?: number,
): { altitude: number; gimbalPitchDeg: number } | null {
  if (poiHeight <= 0 || radiusM <= 0) return null;
  const desiredSpanRad = (vfovDeg * FOV_SAFETY_MARGIN * Math.PI) / 180;
  const maxSpanRad =
    maxSpanForRadius(poiHeight, radiusM) * MAX_SPAN_SAFETY_FACTOR;
  const targetSpanRad = Math.min(desiredSpanRad, maxSpanRad);
  const T = Math.tan(targetSpanRad);
  if (!(T > 0)) return null;
  // T*a^2 - T*poiHeight*a + (T*radiusM^2 - poiHeight*radiusM) = 0
  const roots = solveQuadratic(
    T,
    -T * poiHeight,
    T * radiusM * radiusM - poiHeight * radiusM,
  );
  if (!roots) return null;
  const altitude = pickPositiveRoot(roots, prevAltitude, true);
  if (altitude === null) return null;
  const clampedAltitude = Math.max(
    1,
    Math.min(MAX_DERIVED_ALTITUDE_M, Math.round(altitude)),
  );
  return {
    altitude: clampedAltitude,
    gimbalPitchDeg: computeFramingPitch(clampedAltitude, poiHeight, radiusM),
  };
}

/**
 * Inverse of `computeFramedForRadius`: radius (and centering gimbal pitch)
 * needed so the same ground-to-poiHeight object fits inside `vfovDeg` while
 * flying at a fixed `altitude`. Targets `FOV_SAFETY_MARGIN` of the camera's
 * FOV when achievable at this altitude; when `altitude > poiHeight` (camera
 * above the object's top) and that target isn't reachable, targets the
 * maximum span this altitude can ever achieve instead (see
 * `maxSpanForAltitude`) rather than failing. When `0 < altitude <=
 * poiHeight` (camera at or below the object's own top), the desired span is
 * always achievable for *some* radius — as radius shrinks toward 0 the span
 * approaches a full 180° — so no capping is needed there either; a real
 * solution always exists for any `altitude > 0` and `poiHeight > 0`.
 * Returns `null` only when `poiHeight`/`altitude` aren't positive. See
 * `computeFramedForRadius` for the root-selection rules; `prevRadius`
 * absent defaults to the smaller (closer) radius root, since callers
 * editing altitude virtually always already have a current radius to pass
 * as `prevRadius` instead.
 */
export function computeFramedForAltitude(
  altitude: number,
  poiHeight: number,
  vfovDeg: number,
  prevRadius?: number,
): { radiusM: number; gimbalPitchDeg: number } | null {
  if (poiHeight <= 0 || altitude <= 0) return null;
  const desiredSpanRad = (vfovDeg * FOV_SAFETY_MARGIN * Math.PI) / 180;
  // maxSpanForAltitude's derivation assumes altitude > poiHeight (it takes
  // sqrt(altitude*(altitude-poiHeight))) — below/at that line, the desired
  // span is unconditionally achievable (see doc comment), so skip the cap.
  const targetSpanRad =
    altitude > poiHeight
      ? Math.min(
          desiredSpanRad,
          maxSpanForAltitude(altitude, poiHeight) * MAX_SPAN_SAFETY_FACTOR,
        )
      : desiredSpanRad;
  const T = Math.tan(targetSpanRad);
  if (!(T > 0)) return null;
  // T*r^2 - poiHeight*r + T*altitude*(altitude-poiHeight) = 0
  const roots = solveQuadratic(
    T,
    -poiHeight,
    T * altitude * (altitude - poiHeight),
  );
  if (!roots) return null;
  const radiusM = pickPositiveRoot(roots, prevRadius, false);
  if (radiusM === null) return null;
  const clampedRadius = Math.max(
    MIN_RADIUS_M,
    Math.min(MAX_RADIUS_M, Math.round(radiusM)),
  );
  return {
    radiusM: clampedRadius,
    gimbalPitchDeg: computeFramingPitch(altitude, poiHeight, clampedRadius),
  };
}

// ── Building-derived orbit seed ──────────────────────────

/** Extra clearance (meters) beyond a building's footprint so an orbit around it clears every corner. */
const BUILDING_ORBIT_CLEARANCE_M = 15;

/**
 * Minimum orbit radius, as a multiple of the building's height, applied on
 * top of the footprint-based radius. A footprint-only radius works for
 * short/wide buildings, but for a tall building with a small footprint
 * (radius << height), `computeFramedForRadius`'s two altitude roots both
 * collapse toward poiHeight itself as radius shrinks — so no matter how
 * precisely gimbal pitch is then computed, the camera never gets to fly
 * meaningfully above the roofline, which reads as "too low/close, gimbal
 * looking up at the sky instead of down at the building" regardless of the
 * per-waypoint pitch math. Flying at least as far away as the building is
 * tall (ratio 1) keeps altitude comfortably above poiHeight (worked out by
 * hand: ~1.6x poiHeight at a 63° default wide FOV) instead of pinned near it.
 */
const MIN_RADIUS_TO_HEIGHT_RATIO = 1;

/**
 * Minimum altitude, as a multiple of the building's own height, for a
 * first-time orbit recommendation — a natural "look down from above the
 * roofline" shot. Used both to floor the recommended altitude (see
 * `ensureAltitudeAboveBuilding`) and, at that same altitude, as the target
 * viewpoint `computeOrbitSeedForBuilding` grows the radius to comfortably
 * frame from — see its own doc comment for why growing the radius still
 * needs a fixed altitude to grow *toward*, not just "farther is better".
 */
const MIN_ALTITUDE_ABOVE_BUILDING_FACTOR = 1.3;

/** Fraction of the camera's real vertical FOV the whole building (ground to
 * `poiHeight`) may occupy at minimum, when growing a building orbit's
 * radius — see `minStandoffForFovM`. Deliberately NOT the same target as
 * `FOV_SAFETY_MARGIN` (0.5, an aesthetic "how much of frame should the
 * subject nicely fill" choice used elsewhere): growing the radius toward
 * that tighter, aesthetic target would let the solver satisfy it by tilting
 * ever more steeply downward from close range instead of actually standing
 * farther back — mathematically valid (the ground-to-roof span still fits)
 * but visually the opposite of what "the building isn't visible" is asking
 * for, since a very steep pitch from up close reads as looming/cropped, not
 * as a nicely composed elevation view. This factor instead answers a purely
 * physical question — is the building simply too close to fit inside the
 * camera's FOV at all, at any pitch — independent of how nicely composed
 * the shot ends up; a small margin below 1 keeps the building off the very
 * edge of frame. */
const MIN_FOV_FIT_FACTOR = 0.9;

/** Minimum horizontal distance for an object spanning ground level to
 * `poiHeight` to fit inside `vfovDeg` at all, at any camera pitch — the
 * inverse of `maxSpanForRadius`'s own "max achievable span at a given
 * radius" (occurs at altitude = poiHeight/2, where a close-up object
 * subtends the widest angle any altitude choice can ever achieve from that
 * distance): closer than this, no altitude/pitch combination keeps the
 * whole object in frame. Exported for `TemplateDrawHandler`, which uses the
 * same physical minimum to keep a manually-dragged orbit center (with an
 * independently locked POI — see `OrbitParams.poiCenter`) from being placed
 * so close to the POI that no point on the resulting flight circle could
 * ever frame it. */
export function minStandoffForFovM(poiHeight: number, vfovDeg: number): number {
  const targetSpanRad = (vfovDeg * MIN_FOV_FIT_FACTOR * Math.PI) / 180;
  return poiHeight / (2 * Math.tan(targetSpanRad / 2));
}

/**
 * When an orbit's POI is locked (`OrbitParams.poiCenter`) separately from
 * its flight circle — e.g. flying an arc offset to one side of a subject
 * because an obstacle blocks the far side — dragging the circle's own
 * center too close to that fixed POI can put every point on the resulting
 * circle too close for the whole subject to ever fit in the camera's FOV,
 * regardless of gimbal pitch (the same physical limit `minStandoffForFovM`
 * itself guards elsewhere). Clamps a dragged candidate center to the
 * nearest point that keeps the circle's closest approach to the POI at or
 * above that minimum, preserving the bearing the user is actually dragging
 * along so the clamp feels like hitting a wall, not a jump to an unrelated
 * spot. Used by `TemplateDrawHandler`'s orbit center drag handle.
 */
export function clampOrbitCenterForPoiClearance(
  candidateCenter: [number, number],
  poiCenter: [number, number],
  radiusM: number,
  minStandoffM: number,
): [number, number] {
  const [poiLat, poiLng] = poiCenter;
  const [cLat, cLng] = candidateCenter;
  const dist = haversine(poiLat, poiLng, cLat, cLng);
  const closestApproach = Math.abs(dist - radiusM);
  if (closestApproach >= minStandoffM) return candidateCenter;

  const bearingDeg = dist > 0 ? bearing(poiLat, poiLng, cLat, cLng) : 0;

  // Two distances from the POI satisfy the constraint: POI outside the
  // circle (dist = radiusM + minStandoffM) or POI inside it (dist = radiusM
  // - minStandoffM, only possible when the radius itself exceeds the
  // minimum standoff). Pick whichever needs the smaller change from the
  // candidate's own distance, so the clamp reads as "stopped at the nearest
  // boundary" instead of snapping to the far side.
  const outsideDist = radiusM + minStandoffM;
  const insideDist = radiusM - minStandoffM;
  const targetDist =
    insideDist > 0 && Math.abs(insideDist - dist) < Math.abs(outsideDist - dist)
      ? insideDist
      : outsideDist;

  return destinationPoint(poiLat, poiLng, targetDist, bearingDeg);
}

/** How many bearings to sample around a candidate circle when checking how
 * close it gets to a building's real (possibly irregular/concave) edge —
 * fine enough to catch a narrow wing or sharp corner that vertex-only math
 * would miss, coarse enough to stay cheap for an interactive recommendation. */
const CIRCLE_CLEARANCE_SAMPLE_COUNT = 72;

/** The closest a circle (`center`, `radiusM`) ever gets to `vertices`' real
 * boundary, checked by sampling points around the circle rather than just
 * the polygon's own vertices — a building's real footprint isn't circular,
 * so the true minimum can fall on an edge midpoint or a concave notch that a
 * vertex-only check would miss entirely. */
function minCircleToBuildingDistanceM(
  center: [number, number],
  radiusM: number,
  vertices: [number, number][],
): number {
  let min = Infinity;
  for (let i = 0; i < CIRCLE_CLEARANCE_SAMPLE_COUNT; i++) {
    const bearingDeg = (360 * i) / CIRCLE_CLEARANCE_SAMPLE_COUNT;
    const point = destinationPoint(center[0], center[1], radiusM, bearingDeg);
    const d = distanceToPolygonBoundaryM(point, vertices);
    if (d < min) min = d;
  }
  return min;
}

/** How many times to grow the radius and re-check clearance — increasing
 * radius by exactly the shortfall at the worst bearing converges in one or
 * two steps for most footprints; a few extra iterations absorb the curvature
 * effects of an irregular/concave shape without looping indefinitely. */
const MAX_RADIUS_GROWTH_ITERATIONS = 6;

export interface BuildingOrbitSeed {
  center: [number, number];
  radiusM: number;
}

/**
 * Recommended orbit center + radius for flying around a building footprint:
 * center is the footprint's real area centroid (`polygonCentroid` — NOT a
 * plain average of the vertices, which skews toward whichever side of the
 * shape happens to have more vertices packed onto it, e.g. a jagged wing
 * versus one simple straight wall — badly enough for a real, irregular
 * building outline that the orbit's own center can end up visibly off to
 * one side of the building instead of over it), radius starts as the larger
 * of (a) the farthest vertex from that centroid plus a safety clearance, so
 * the orbit clears every corner (including non-rectangular or rotated
 * footprints), and (b) a height-based floor (see `MIN_RADIUS_TO_HEIGHT_RATIO`)
 * so a tall, narrow building still gets a comfortable standoff distance —
 * then grows further if needed so *every* bearing around the circle, not
 * just the one facing the farthest vertex, has enough real clearance from
 * the building's edge to frame it comfortably.
 *
 * A non-circular (and especially concave or multi-wing) footprint can sit
 * much closer to the flight circle at some bearings than at others even
 * though every waypoint shares the same radius from the center — the
 * farthest-vertex radius alone only guarantees clearance at the one bearing
 * it was sized for. `generateOrbit` already adapts each waypoint's gimbal
 * pitch to its own real edge distance (so the whole building stays inside
 * the angular span at every bearing), but pitch alone can't fix a bearing
 * where that real distance is simply too short for the whole building to
 * fit within the camera's actual field of view at all — that needs more
 * standoff distance, not a different angle. This grows the radius (sampling
 * the candidate circle at many bearings via `minCircleToBuildingDistanceM`,
 * since the true closest point can fall on an edge or concave notch a
 * vertex-only check would miss) until even the closest bearing clears the
 * purely physical minimum distance for the whole building to fit inside the
 * camera's FOV at any pitch (`minStandoffForFovM`) — not the tighter,
 * aesthetic default-framing target used elsewhere, which a close-range,
 * steeply-tilted-down shot can satisfy on paper without actually looking
 * like a comfortable elevation view.
 */
export function computeOrbitSeedForBuilding(
  vertices: [number, number][],
  buildingHeight: number,
  vfovDeg: number = DEFAULT_WIDE_VFOV_DEG,
): BuildingOrbitSeed {
  const center = polygonCentroid(vertices);
  const maxDist = Math.max(
    ...vertices.map((v) => haversine(center[0], center[1], v[0], v[1])),
  );
  const footprintRadiusM = maxDist + BUILDING_ORBIT_CLEARANCE_M;
  const heightRadiusM = buildingHeight * MIN_RADIUS_TO_HEIGHT_RATIO;
  let radiusM = Math.max(footprintRadiusM, heightRadiusM);

  if (buildingHeight > 0) {
    const requiredStandoffM = minStandoffForFovM(buildingHeight, vfovDeg);
    for (let i = 0; i < MAX_RADIUS_GROWTH_ITERATIONS; i++) {
      const minDist = minCircleToBuildingDistanceM(center, radiusM, vertices);
      if (minDist >= requiredStandoffM) break;
      radiusM += requiredStandoffM - minDist;
    }
  }

  return {
    center,
    radiusM: Math.round(radiusM),
  };
}

/**
 * Fallback for when `computeOrbitSeedForBuilding`'s radius growth still
 * isn't enough to keep `computeFramedForRadius` above the roofline — e.g. a
 * FOV so narrow that no reasonable growth converges, or an older/manually
 * edited orbit whose radius predates that growth logic. Uses the same
 * `MIN_ALTITUDE_ABOVE_BUILDING_FACTOR` target the radius growth itself grows
 * toward, so the two stay consistent. This only overrides the *initial*
 * recommendation; live edits still go through the plain
 * `computeFramedForRadius`/`computeFramedForAltitude` pair, which correctly
 * honors whatever radius/altitude the user explicitly chose (including ones
 * in the capped regime this exists to avoid for new recommendations — see
 * that pair's own tests).
 */
function ensureAltitudeAboveBuilding(
  framed: { altitude: number; gimbalPitchDeg: number },
  radiusM: number,
  poiHeight: number,
): { altitude: number; gimbalPitchDeg: number } {
  if (framed.altitude >= poiHeight) return framed;
  const altitude = Math.round(poiHeight * MIN_ALTITUDE_ABOVE_BUILDING_FACTOR);
  return {
    altitude,
    gimbalPitchDeg: computeFramingPitch(altitude, poiHeight, radiusM),
  };
}

/**
 * Full OrbitParams recommended for orbiting a building: center/radius from
 * `computeOrbitSeedForBuilding`, POI height set to the building's real
 * height, altitude/gimbal pitch derived so the whole building fits in frame
 * via `computeFramedForRadius`. Uses the selected drone/payload's known wide
 * camera vertical FOV when given; otherwise (no camera selected, or one
 * without known FOV data) falls back to a typical wide-angle lens rather
 * than skipping the framing math — see `DEFAULT_WIDE_VFOV_DEG`. Only when
 * the building itself is degenerate (zero height, zero radius — nothing a
 * FOV assumption can fix) falls back further to the older fixed
 * -45°/`computeAltitudeForPitch` heuristic. Shared by the "place a POI on a
 * building" flow and any direct "create orbit around this building" action
 * so both compute the recommendation identically.
 */
export function orbitParamsForBuilding(
  building: {
    vertices: [number, number][];
    height: number;
  },
  vfovDeg?: number,
): OrbitParams {
  const resolvedVfovDeg = vfovDeg ?? DEFAULT_WIDE_VFOV_DEG;
  const seed = computeOrbitSeedForBuilding(
    building.vertices,
    building.height,
    resolvedVfovDeg,
  );
  const framed = computeFramedForRadius(
    seed.radiusM,
    building.height,
    resolvedVfovDeg,
  );
  if (framed) {
    const { altitude, gimbalPitchDeg } = ensureAltitudeAboveBuilding(
      framed,
      seed.radiusM,
      building.height,
    );
    return {
      ...DEFAULT_ORBIT_PARAMS,
      center: seed.center,
      radiusM: seed.radiusM,
      poiHeight: building.height,
      gimbalPitchDeg,
      altitude,
      buildingVertices: building.vertices,
    };
  }
  const gimbalPitchDeg = DEFAULT_ORBIT_PARAMS.gimbalPitchDeg;
  return {
    ...DEFAULT_ORBIT_PARAMS,
    center: seed.center,
    radiusM: seed.radiusM,
    poiHeight: building.height,
    gimbalPitchDeg,
    altitude: computeAltitudeForPitch(
      gimbalPitchDeg,
      building.height,
      seed.radiusM,
    ),
    buildingVertices: building.vertices,
  };
}

// ── Generators ───────────────────────────────────────────

/**
 * Mutates `waypoints` in place for "video" capture mode: `startRecord` on
 * the first waypoint, `stopRecord` on the last, nothing in between, so the
 * drone flies the whole path with the camera rolling instead of stopping
 * for a photo at each point. Must run *after* any final `reverse()` step,
 * since "first"/"last" here mean the actual flight order, not push order.
 * `StartRecordParams`/`StopRecordParams` have no lens-selection field (only
 * `TakePhotoParams` does — `wpml.ts` never reads `payloadLensIndex` for
 * record actions), so unlike the photo actions there is no per-template
 * lens override here.
 */
function applyVideoCaptureActions(
  waypoints: TemplateResult["waypoints"],
): void {
  if (waypoints.length === 0) return;
  waypoints[0].actions = [
    {
      actionId: 0,
      actionType: "startRecord",
      params: { payloadPositionIndex: 0 },
    },
  ];
  const last = waypoints[waypoints.length - 1];
  const stopAction: WaypointAction = {
    actionId: last.actions.length,
    actionType: "stopRecord",
    params: { payloadPositionIndex: 0 },
  };
  last.actions =
    waypoints.length === 1 ? [...last.actions, stopAction] : [stopAction];
}

export function generateOrbit(params: OrbitParams): TemplateResult {
  const {
    center,
    radiusM,
    altitude,
    numPoints,
    clockwise,
    createPoi,
    startAngleDeg,
    endAngleDeg,
    poiHeight,
    gimbalPitchDeg,
    poiCenter,
    captureMode,
  } = params;
  const [cLat, cLng] = center;
  // Independent camera aim point (see OrbitParams.poiCenter). Falls back to
  // the circle's own center when not set, so undefined always means "the
  // POI and the flight circle are the same point" — the original behavior.
  const [aimLat, aimLng] = poiCenter ?? center;

  const waypoints: TemplateResult["waypoints"] = [];
  const pois: TemplateResult["pois"] = [];

  // Optionally create a POI at the aim point, at the real height the camera
  // should look at (not always ground level).
  const poiName = poiCenter ? "Cíl kamery" : "Střed orbitu";

  if (createPoi) {
    pois.push({
      name: poiName,
      latitude: aimLat,
      longitude: aimLng,
      height: poiHeight,
    });
  }

  // A full circle is a closed loop: numPoints evenly spaced gaps, no
  // duplicate waypoint at the seam. A partial arc is open-ended: numPoints
  // waypoints span startAngleDeg..endAngleDeg inclusive (numPoints - 1 gaps),
  // so the first and last waypoints land exactly on the requested bounds —
  // in BOTH directions. For an open arc, "clockwise" picks which of the two
  // possible arcs between the same two bearings to fly: the direct
  // (increasing-angle) sweep, or its 360°-complement the other way around.
  // Naively negating the sweep (as an earlier version of this code did)
  // only works for a closed loop — for an open arc it lands the last
  // waypoint on the wrong bearing and backtracks through already-flown
  // airspace instead of tracing the requested end angle.
  const isClosedLoop = endAngleDeg - startAngleDeg >= 360;
  const divisor = isClosedLoop ? numPoints : Math.max(1, numPoints - 1);
  let signedSweep: number;
  if (isClosedLoop) {
    signedSweep = clockwise ? 360 : -360;
  } else {
    const clockwiseSweep = (((endAngleDeg - startAngleDeg) % 360) + 360) % 360;
    signedSweep = clockwise ? clockwiseSweep : clockwiseSweep - 360;
  }

  for (let i = 0; i < numPoints; i++) {
    const fraction = i / divisor;
    const angleDeg = startAngleDeg + fraction * signedSweep;
    const [lat, lng] = destinationPoint(cLat, cLng, radiusM, angleDeg);

    // Calculate heading angle toward the aim point (== center unless
    // poiCenter decouples them), and the gimbal pitch. Two cases:
    // - poiCenter set: recompute per waypoint from this waypoint's actual
    //   (now-varying) distance to that decoupled target — an intentionally
    //   dynamic shot, since the whole point of locking the POI is to keep
    //   the camera on it while the flight circle itself moves independently.
    // - otherwise (including a building-derived orbit): the flat-pitch
    //   behavior — every waypoint on a circle is equidistant from its own
    //   center, so recomputing per-waypoint here would be redundant when
    //   there's no independently-moving target to account for. Earlier
    //   revisions recomputed pitch per waypoint from the real distance to a
    //   building's nearest edge instead, to avoid cropping a non-circular
    //   footprint at its closest bearing — but that made the gimbal visibly
    //   tilt up and down over the course of the flight, which reads as an
    //   unsteady shot rather than one continuous view. `computeOrbitSeedForBuilding`
    //   now grows the radius so every bearing clears the same physical FOV
    //   minimum instead, so a single flat pitch (computed once in
    //   `orbitParamsForBuilding`) already covers the whole loop.
    const headingAngle = bearing(lat, lng, aimLat, aimLng);
    // Normalize to -180..180 range expected by DJI
    const normalizedHeading =
      headingAngle > 180 ? headingAngle - 360 : headingAngle;
    const gimbalPitchAngle = poiCenter
      ? computeGimbalPitch(
          altitude,
          poiHeight,
          haversine(lat, lng, aimLat, aimLng),
        )
      : gimbalPitchDeg;

    waypoints.push({
      ...DEFAULT_WAYPOINT,
      latitude: lat,
      longitude: lng,
      height: altitude,
      speed: 5,
      useGlobalSpeed: false,
      useGlobalHeadingParam: false,
      headingMode: "fixed",
      headingAngle: Math.round(normalizedHeading),
      gimbalPitchAngle,
      turnMode: "toPointAndPassWithContinuityCurvature",
      useGlobalTurnParam: false,
      actions:
        captureMode === "photo"
          ? [
              {
                actionId: 0,
                actionType: "takePhoto",
                params: { payloadPositionIndex: 0 },
              },
            ]
          : [],
    });
  }

  if (captureMode === "video") {
    applyVideoCaptureActions(waypoints);
  }

  return { waypoints, pois };
}

/** One flight-line pass over the grid's bounding box at a given rotation —
 * factored out of `generateGrid` so a "crosshatch" survey can call it twice
 * (0° and 90°) and concatenate the results, without duplicating the
 * bounding-box/rotation/spacing math. */
function generateGridPass(
  params: GridParams,
  rotationDeg: number,
  mode: CaptureMode | "none",
): TemplateResult["waypoints"] {
  const { corner1, corner2, altitude, spacingM, photoSpacingM } = params;
  const safePhotoSpacingM = Math.max(photoSpacingM ?? spacingM, 0.1);
  const [lat1, lng1] = corner1;
  const [lat2, lng2] = corner2;

  const waypoints: TemplateResult["waypoints"] = [];

  // Determine bounding box
  const minLat = Math.min(lat1, lat2);
  const maxLat = Math.max(lat1, lat2);
  const minLng = Math.min(lng1, lng2);
  const maxLng = Math.max(lng1, lng2);

  // Center of the bounding box (rotation pivot)
  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;

  // Calculate the width and height of the area in meters
  const widthM = haversine(minLat, minLng, minLat, maxLng);
  const heightM = haversine(minLat, minLng, maxLat, minLng);

  // Determine if we fly N-S or E-W (fly along the longer axis)
  const flyEW = widthM >= heightM;

  // Number of passes
  const crossAxisDist = flyEW ? heightM : widthM;
  const numPasses = Math.max(2, Math.ceil(crossAxisDist / spacingM) + 1);

  const takePhotoAction: WaypointAction = {
    actionId: 0,
    actionType: "takePhoto",
    params: { payloadPositionIndex: 0 },
  };

  // Rotation helper: rotate a lat/lng point around the center by rotationDeg degrees.
  // Uses equirectangular approximation (accurate enough for small areas).
  const rotRad = (rotationDeg * Math.PI) / 180;
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);
  const cosCenter = Math.cos((centerLat * Math.PI) / 180);

  function rotatePoint(lat: number, lng: number): [number, number] {
    if (rotationDeg === 0) return [lat, lng];
    // Convert to local offsets in degrees, scaling lng by cos(lat) for equal units
    const dLat = lat - centerLat;
    const dLng = (lng - centerLng) * cosCenter;
    // Rotate
    const rLat = dLat * cosR - dLng * sinR;
    const rLng = dLat * sinR + dLng * cosR;
    // Convert back
    return [centerLat + rLat, centerLng + rLng / cosCenter];
  }

  for (let pass = 0; pass < numPasses; pass++) {
    const fraction = numPasses <= 1 ? 0 : pass / (numPasses - 1);
    const reverse = pass % 2 === 1; // lawn-mower pattern: alternate direction

    let wpLat1: number, wpLng1: number, wpLat2: number, wpLng2: number;

    if (flyEW) {
      // Cross axis is N-S: each pass is a horizontal E-W line
      const lat = minLat + fraction * (maxLat - minLat);
      const startLng = reverse ? maxLng : minLng;
      const endLng = reverse ? minLng : maxLng;
      wpLat1 = lat;
      wpLng1 = startLng;
      wpLat2 = lat;
      wpLng2 = endLng;
    } else {
      // Cross axis is E-W: each pass is a vertical N-S line
      const lng = minLng + fraction * (maxLng - minLng);
      const startLat = reverse ? maxLat : minLat;
      const endLat = reverse ? minLat : maxLat;
      wpLat1 = startLat;
      wpLng1 = lng;
      wpLat2 = endLat;
      wpLng2 = lng;
    }

    // Apply rotation
    const [rLat1, rLng1] = rotatePoint(wpLat1, wpLng1);
    const [rLat2, rLng2] = rotatePoint(wpLat2, wpLng2);

    // Evenly spaced points along the whole pass (not just its two
    // endpoints), so a photo is taken every ~photoSpacingM the entire
    // length of the line — required for real photogrammetry overlap.
    const passLengthM = haversine(rLat1, rLng1, rLat2, rLng2);
    const numPointsOnPass = Math.max(
      2,
      Math.ceil(passLengthM / safePhotoSpacingM) + 1,
    );

    for (let k = 0; k < numPointsOnPass; k++) {
      const t = numPointsOnPass <= 1 ? 0 : k / (numPointsOnPass - 1);
      waypoints.push({
        ...DEFAULT_WAYPOINT,
        latitude: rLat1 + t * (rLat2 - rLat1),
        longitude: rLng1 + t * (rLng2 - rLng1),
        height: altitude,
        gimbalPitchAngle: -90,
        useGlobalHeadingParam: false,
        headingMode: "followWayline",
        turnMode: "toPointAndStopWithContinuityCurvature",
        useGlobalTurnParam: false,
        actions: mode === "photo" ? [{ ...takePhotoAction, actionId: 0 }] : [],
      });
    }
  }

  return waypoints;
}

export function generateGrid(params: GridParams): TemplateResult {
  const { addPhotos, rotationDeg, reverse, captureMode, crosshatch } = params;
  const mode = captureMode ?? (addPhotos ? "photo" : "none");

  let waypoints = generateGridPass(params, rotationDeg, mode);
  if (crosshatch) {
    // Second pass at 90° to the first — the combined coverage from two
    // perpendicular directions is what makes crosshatch surveys better for
    // 3D reconstruction than a single-direction grid.
    waypoints = [
      ...waypoints,
      ...generateGridPass(params, rotationDeg + 90, mode),
    ];
  }

  if (reverse) {
    waypoints.reverse();
  }

  if (mode === "video") {
    applyVideoCaptureActions(waypoints);
  }

  return { waypoints, pois: [] };
}

export function generateFacade(params: FacadeParams): TemplateResult {
  const {
    point1,
    point2,
    distanceM,
    minAltitude,
    maxAltitude,
    numRows,
    numColumns,
    addPhotos,
    captureMode,
  } = params;
  const mode = captureMode ?? (addPhotos ? "photo" : "none");
  const [lat1, lng1] = point1;
  const [lat2, lng2] = point2;

  const waypoints: TemplateResult["waypoints"] = [];

  // Wall bearing and perpendicular offset direction
  const wallBearing = bearing(lat1, lng1, lat2, lng2);
  // Perpendicular: offset 90° to the right of the wall direction
  const offsetBearing = (wallBearing + 90) % 360;

  // Generate the scan grid along the wall
  for (let row = 0; row < numRows; row++) {
    const altFraction = numRows <= 1 ? 0 : row / (numRows - 1);
    const alt = Math.round(
      minAltitude + altFraction * (maxAltitude - minAltitude),
    );
    const reverse = row % 2 === 1; // zigzag

    for (let col = 0; col < numColumns; col++) {
      const colIdx = reverse ? numColumns - 1 - col : col;
      const colFraction = numColumns <= 1 ? 0 : colIdx / (numColumns - 1);

      // Point along the wall
      const wallLat = lat1 + colFraction * (lat2 - lat1);
      const wallLng = lng1 + colFraction * (lng2 - lng1);

      // Offset perpendicular to wall
      const [wpLat, wpLng] = destinationPoint(
        wallLat,
        wallLng,
        distanceM,
        offsetBearing,
      );

      // Heading: face the wall (opposite of offset direction)
      const headingToWall = (offsetBearing + 180) % 360;
      const normalizedHeading =
        headingToWall > 180 ? headingToWall - 360 : headingToWall;

      // Gimbal: calculate pitch toward wall point at ground level
      const heightDiff = alt; // drone altitude above wall base
      const pitchRad = Math.atan2(heightDiff, distanceM);
      const gimbalPitch = Math.round(-pitchRad * (180 / Math.PI));

      waypoints.push({
        ...DEFAULT_WAYPOINT,
        latitude: wpLat,
        longitude: wpLng,
        height: alt,
        speed: 3,
        useGlobalSpeed: false,
        useGlobalHeadingParam: false,
        headingMode: "fixed",
        headingAngle: Math.round(normalizedHeading),
        gimbalPitchAngle: gimbalPitch,
        turnMode: "toPointAndStopWithContinuityCurvature",
        useGlobalTurnParam: false,
        actions:
          mode === "photo"
            ? [
                {
                  actionId: 0,
                  actionType: "takePhoto",
                  params: { payloadPositionIndex: 0 },
                },
              ]
            : [],
      });
    }
  }

  if (mode === "video") {
    applyVideoCaptureActions(waypoints);
  }

  return { waypoints, pois: [] };
}

// ── Pencil (freehand path) ──────────────────────────────

/**
 * Resample a polyline of raw points into exactly `n` equidistant points.
 * Uses cumulative arc-length along the raw path and linear interpolation.
 */
function resamplePath(raw: [number, number][], n: number): [number, number][] {
  if (raw.length === 0) return [];
  if (raw.length === 1 || n <= 1) return [raw[0]];

  // 1. Compute cumulative arc-length distances
  const cumDist: number[] = [0];
  for (let i = 1; i < raw.length; i++) {
    cumDist.push(
      cumDist[i - 1] +
        haversine(raw[i - 1][0], raw[i - 1][1], raw[i][0], raw[i][1]),
    );
  }
  const totalLength = cumDist[cumDist.length - 1];

  if (totalLength === 0) return [raw[0]];

  // 2. Place n points at equal arc-length intervals
  const result: [number, number][] = [];
  let segIdx = 0; // current segment index in the raw path

  for (let k = 0; k < n; k++) {
    const targetDist = (k / (n - 1)) * totalLength;

    // Advance segIdx to find the segment containing targetDist
    while (segIdx < raw.length - 2 && cumDist[segIdx + 1] < targetDist) {
      segIdx++;
    }

    const segLen = cumDist[segIdx + 1] - cumDist[segIdx];
    const t = segLen > 0 ? (targetDist - cumDist[segIdx]) / segLen : 0;

    const lat = raw[segIdx][0] + t * (raw[segIdx + 1][0] - raw[segIdx][0]);
    const lng = raw[segIdx][1] + t * (raw[segIdx + 1][1] - raw[segIdx][1]);
    result.push([lat, lng]);
  }

  return result;
}

/** Total arc-length of a polyline in meters */
export function pathLength(path: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += haversine(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
  }
  return total;
}

export function generatePencil(params: PencilParams): TemplateResult {
  const {
    path,
    numPoints,
    altitude,
    speed,
    gimbalPitchAngle,
    reverse,
    poiId,
    captureMode,
  } = params;

  if (path.length < 2 || numPoints < 2) return { waypoints: [], pois: [] };

  const resampled = resamplePath(path, numPoints);

  const useTowardPoi = !!poiId;

  const waypoints: TemplateResult["waypoints"] = resampled.map(
    ([lat, lng]) => ({
      ...DEFAULT_WAYPOINT,
      latitude: lat,
      longitude: lng,
      height: altitude,
      speed,
      useGlobalSpeed: false,
      useGlobalHeadingParam: false,
      headingMode: useTowardPoi
        ? ("towardPOI" as const)
        : ("followWayline" as const),
      ...(useTowardPoi ? { poiId } : {}),
      gimbalPitchAngle,
      turnMode: "toPointAndPassWithContinuityCurvature" as const,
      useGlobalTurnParam: false,
      actions:
        captureMode === "photo"
          ? [
              {
                actionId: 0,
                actionType: "takePhoto" as const,
                params: { payloadPositionIndex: 0 },
              },
            ]
          : [],
    }),
  );

  if (reverse) {
    waypoints.reverse();
  }

  if (captureMode === "video") {
    applyVideoCaptureActions(waypoints);
  }

  return { waypoints, pois: [] };
}

// ── Corridor (bridges, pipelines, power lines, linear structures) ─

/** Circular mean of two bearings (degrees, 0=N) — used to get a smoothed local tangent direction at an interior path vertex, so an offset pass doesn't kink at every drawn point. */
function averageBearing(b1: number, b2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const x = Math.cos(toRad(b1)) + Math.cos(toRad(b2));
  const y = Math.sin(toRad(b1)) + Math.sin(toRad(b2));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Local tangent bearing at each point of a path: the single segment's bearing at the endpoints, the circular mean of the incoming/outgoing segment bearings at interior points. */
function pathTangents(path: [number, number][]): number[] {
  const n = path.length;
  if (n < 2) return Array.from({ length: n }, () => 0);
  const tangents: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tangents.push(bearing(path[0][0], path[0][1], path[1][0], path[1][1]));
    } else if (i === n - 1) {
      tangents.push(
        bearing(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]),
      );
    } else {
      const incoming = bearing(
        path[i - 1][0],
        path[i - 1][1],
        path[i][0],
        path[i][1],
      );
      const outgoing = bearing(
        path[i][0],
        path[i][1],
        path[i + 1][0],
        path[i + 1][1],
      );
      tangents.push(averageBearing(incoming, outgoing));
    }
  }
  return tangents;
}

/**
 * Generates parallel passes offset from a drawn centerline — for
 * inspecting a bridge, pipeline, power line row, road, or railway from
 * multiple lateral positions (e.g. both sides of a bridge deck) instead of
 * just flying directly over it once. Passes alternate direction
 * (lawn-mower style) so the aircraft doesn't need a long non-flying
 * transit back to the start between passes.
 */
export function generateCorridor(params: CorridorParams): TemplateResult {
  const {
    path,
    numPoints,
    altitude,
    offsetM,
    numPasses,
    speed,
    gimbalPitchAngle,
    reverse,
    captureMode,
  } = params;

  if (path.length < 2 || numPoints < 2) return { waypoints: [], pois: [] };

  const resampled = resamplePath(path, numPoints);
  const tangents = pathTangents(resampled);
  const safeNumPasses = Math.max(1, Math.round(numPasses));

  const takePhotoAction: WaypointAction = {
    actionId: 0,
    actionType: "takePhoto",
    params: { payloadPositionIndex: 0 },
  };

  const waypoints: TemplateResult["waypoints"] = [];

  for (let pass = 0; pass < safeNumPasses; pass++) {
    // Centered on the drawn centerline: odd pass counts include an exact
    // centerline pass (offset 0), even counts straddle it symmetrically.
    const lateralOffsetM = (pass - (safeNumPasses - 1) / 2) * offsetM;
    const passReversed = pass % 2 === 1;
    const indices = passReversed
      ? [...resampled.keys()].reverse()
      : [...resampled.keys()];

    for (const i of indices) {
      const [lat, lng] = resampled[i];
      // destinationPoint tolerates a negative distance (equivalent to the
      // reverse bearing) and a zero distance (returns the input point
      // unchanged), so no special-casing is needed for the centerline
      // pass or for offsetting to either side.
      const [offLat, offLng] = destinationPoint(
        lat,
        lng,
        lateralOffsetM,
        tangents[i] + 90,
      );

      waypoints.push({
        ...DEFAULT_WAYPOINT,
        latitude: offLat,
        longitude: offLng,
        height: altitude,
        speed,
        useGlobalSpeed: false,
        useGlobalHeadingParam: false,
        headingMode: "followWayline" as const,
        gimbalPitchAngle,
        turnMode: "toPointAndPassWithContinuityCurvature" as const,
        useGlobalTurnParam: false,
        actions: captureMode === "photo" ? [{ ...takePhotoAction }] : [],
      });
    }
  }

  if (reverse) {
    waypoints.reverse();
  }

  if (captureMode === "video") {
    applyVideoCaptureActions(waypoints);
  }

  return { waypoints, pois: [] };
}

// ── Wind turbine blade inspection ─────────────────────────

/**
 * Generates a close-proximity inspection flight for each blade of a wind
 * turbine, from a single clicked hub position. Models the blades as lying
 * in a vertical "sweep-plane" disc facing `rotorYawDeg` (perpendicular to
 * the wind): each blade radiates outward from the hub at its own angle
 * within that disc (`blade1AngleDeg` for blade 1, evenly spaced for the
 * rest), contributing partly to altitude (the "up" component) and partly
 * to a horizontal chordwise offset (the "sweep" component, along
 * `rotorYawDeg + 90`). The drone hovers `standoffM` in front of the disc
 * (along `rotorYawDeg`) and flies root-to-tip along each blade; extra
 * passes spread `edgeSpacingM` apart across the chord cover the leading
 * and trailing edges. Heading is baked directly into each waypoint (fixed,
 * pointing back at the hub) the same way `generateOrbit` does, so the
 * camera keeps facing the turbine regardless of how far up the blade the
 * drone currently is.
 */
export function generateTurbineInspection(
  params: TurbineParams,
): TemplateResult {
  const {
    hubCenter,
    hubHeight,
    bladeLengthM,
    numBlades,
    rotorYawDeg,
    blade1AngleDeg,
    standoffM,
    edgeSpacingM,
    numPasses,
    numPointsPerBlade,
    speed,
    gimbalPitchAngle,
    createPoi,
    captureMode,
  } = params;
  const [hubLat, hubLng] = hubCenter;

  if (numBlades < 1 || numPointsPerBlade < 2) {
    return { waypoints: [], pois: [] };
  }

  const safeNumPasses = Math.max(1, Math.round(numPasses));
  const chordBearing = rotorYawDeg + 90;
  const toRad = (d: number) => (d * Math.PI) / 180;

  const takePhotoAction: WaypointAction = {
    actionId: 0,
    actionType: "takePhoto",
    params: { payloadPositionIndex: 0 },
  };

  const waypoints: TemplateResult["waypoints"] = [];

  for (let b = 0; b < numBlades; b++) {
    const bladeAngleRad = toRad(blade1AngleDeg + (b * 360) / numBlades);
    const upFraction = Math.cos(bladeAngleRad);
    const chordFraction = Math.sin(bladeAngleRad);

    for (let pass = 0; pass < safeNumPasses; pass++) {
      const passChordOffsetM = (pass - (safeNumPasses - 1) / 2) * edgeSpacingM;
      const passReversed = pass % 2 === 1;
      const order = Array.from({ length: numPointsPerBlade }, (_, i) => i);
      if (passReversed) order.reverse();

      for (const i of order) {
        const f = i / (numPointsPerBlade - 1);
        const altitude = hubHeight + bladeLengthM * f * upFraction;
        const chordOffsetM = bladeLengthM * f * chordFraction;

        const [chordLat, chordLng] = destinationPoint(
          hubLat,
          hubLng,
          chordOffsetM + passChordOffsetM,
          chordBearing,
        );
        const [lat, lng] = destinationPoint(
          chordLat,
          chordLng,
          standoffM,
          rotorYawDeg,
        );

        const headingAngle = bearing(lat, lng, hubLat, hubLng);
        const normalizedHeading =
          headingAngle > 180 ? headingAngle - 360 : headingAngle;

        waypoints.push({
          ...DEFAULT_WAYPOINT,
          latitude: lat,
          longitude: lng,
          height: altitude,
          speed,
          useGlobalSpeed: false,
          useGlobalHeadingParam: false,
          headingMode: "fixed" as const,
          headingAngle: Math.round(normalizedHeading),
          gimbalPitchAngle,
          turnMode: "toPointAndPassWithContinuityCurvature" as const,
          useGlobalTurnParam: false,
          actions: captureMode === "photo" ? [{ ...takePhotoAction }] : [],
        });
      }
    }
  }

  if (captureMode === "video") {
    applyVideoCaptureActions(waypoints);
  }

  const pois: TemplateResult["pois"] = createPoi
    ? [
        {
          name: "Rotor turbíny",
          latitude: hubLat,
          longitude: hubLng,
          height: hubHeight,
        },
      ]
    : [];

  return { waypoints, pois };
}

// ── Solar panel survey (polygon-clipped lawn-mower grid) ─

/**
 * Local tangent-plane meters (east, north) relative to a reference lat/lng.
 * A flat-earth approximation, adequate at the scale of a single PV array
 * (tens to low hundreds of meters) — the same assumption already used
 * throughout this file for haversine/destination-point math.
 */
function toLocalMeters(
  lat: number,
  lng: number,
  refLat: number,
  refLng: number,
): [number, number] {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((refLat * Math.PI) / 180);
  const x = (lng - refLng) * mPerDegLng;
  const y = (lat - refLat) * mPerDegLat;
  return [x, y];
}

function fromLocalMeters(
  x: number,
  y: number,
  refLat: number,
  refLng: number,
): [number, number] {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((refLat * Math.PI) / 180);
  const lat = refLat + y / mPerDegLat;
  const lng = refLng + x / mPerDegLng;
  return [lat, lng];
}

function rotatePoint2D(
  [x, y]: [number, number],
  rad: number,
): [number, number] {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [x * cos - y * sin, x * sin + y * cos];
}

/**
 * X-coordinates where the horizontal line y=y0 crosses the polygon's edges,
 * sorted ascending. Standard scanline-fill (even-odd rule): consecutive
 * pairs are the "inside" segments for that line. Works for concave and
 * multi-segment (e.g. L-shaped) polygons, not just convex ones. The
 * half-open interval test (`y1 <= y0 && y2 > y0`, or the reverse) avoids
 * double-counting a vertex that sits exactly on the scanline.
 */
function scanlineIntersectionsX(
  localPoly: [number, number][],
  y0: number,
): number[] {
  const xs: number[] = [];
  const n = localPoly.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = localPoly[i];
    const [x2, y2] = localPoly[(i + 1) % n];
    const crosses = (y1 <= y0 && y2 > y0) || (y2 <= y0 && y1 > y0);
    if (!crosses) continue;
    const t = (y0 - y1) / (y2 - y1);
    xs.push(x1 + t * (x2 - x1));
  }
  xs.sort((a, b) => a - b);
  return xs;
}

/**
 * Generates a lawn-mower flight path clipped to an arbitrary drawn polygon
 * (not just its bounding rectangle) — for surveying an irregular field of
 * solar panels without flying beyond its edges. Flight lines run at
 * `rowAngleDeg` (set by the user's drawn reference line) so they line up
 * with the actual panel rows instead of a guessed edge, and photos are
 * placed every `photoSpacingM` along each line — not just at its two
 * endpoints — so nothing between the ends of a long row goes unphotographed.
 */
export function generateSolarSurvey(params: SolarParams): TemplateResult {
  const {
    vertices,
    altitude,
    spacingM,
    photoSpacingM,
    rowAngleDeg,
    addPhotos,
    captureMode,
  } = params;
  const mode = captureMode ?? (addPhotos ? "photo" : "none");

  if (vertices.length < 3) return { waypoints: [], pois: [] };

  const [refLat, refLng] = vertices[0];
  const localPoly = vertices.map(([lat, lng]) =>
    toLocalMeters(lat, lng, refLat, refLng),
  );

  // rowAngleDeg is a compass bearing (0=N, 90=E, clockwise), but the
  // rotation math below (rotatePoint2D) works in the standard counter-
  // clockwise-from-east "math angle" convention — the two are
  // complementary: mathAngle = 90 - bearing.
  const orientationRad = ((90 - rowAngleDeg) * Math.PI) / 180;
  // De-rotate into a frame where flight lines are horizontal (constant y),
  // so clipping reduces to a simple 1D scanline test.
  const derotated = localPoly.map((p) => rotatePoint2D(p, -orientationRad));

  const ys = derotated.map(([, y]) => y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const extent = maxY - minY;
  const numLines = Math.max(2, Math.ceil(extent / spacingM) + 1);

  // scanlineIntersectionsX uses a half-open [y1, y2) interval per edge to
  // avoid double-counting a vertex the scanline passes through exactly.
  // That convention is asymmetric: a scanline sampled at exactly the
  // polygon's minY always finds a match (some edge's lower endpoint sits
  // at y0 with its upper endpoint above it), but one sampled at exactly
  // maxY never can (no edge endpoint is *above* the polygon's own
  // maximum) — every edge fails both halves of the test, so the topmost
  // line silently returns zero crossings and gets dropped. Nudge the
  // sampled range a hair inside the true extent so no line ever lands
  // exactly on a vertex; at real-world scales this loses no meaningful
  // coverage but keeps the top line correct.
  const eps = Math.max(extent * 1e-9, 1e-6);
  const sampleMinY = minY + eps;
  const sampleMaxY = maxY - eps;

  const safePhotoSpacingM = Math.max(photoSpacingM, 0.1);

  const waypoints: TemplateResult["waypoints"] = [];
  let segmentIndex = 0;

  for (let i = 0; i < numLines; i++) {
    const y =
      numLines <= 1
        ? sampleMinY
        : sampleMinY + (i / (numLines - 1)) * (sampleMaxY - sampleMinY);
    const xs = scanlineIntersectionsX(derotated, y);

    for (let j = 0; j + 1 < xs.length; j += 2) {
      const reverseSegment = segmentIndex % 2 === 1;
      const [xStart, xEnd] = reverseSegment
        ? [xs[j + 1], xs[j]]
        : [xs[j], xs[j + 1]];

      // Evenly spaced points along the whole segment (not just its two
      // endpoints), so a photo is taken every ~photoSpacingM the entire
      // length of the row, including between the ends.
      const segLength = Math.abs(xEnd - xStart);
      const numPointsOnLine = Math.max(
        2,
        Math.ceil(segLength / safePhotoSpacingM) + 1,
      );

      for (let k = 0; k < numPointsOnLine; k++) {
        const t = numPointsOnLine <= 1 ? 0 : k / (numPointsOnLine - 1);
        const x = xStart + t * (xEnd - xStart);
        const [rx, ry] = rotatePoint2D([x, y], orientationRad);
        const [lat, lng] = fromLocalMeters(rx, ry, refLat, refLng);

        waypoints.push({
          ...DEFAULT_WAYPOINT,
          latitude: lat,
          longitude: lng,
          height: altitude,
          gimbalPitchAngle: -90,
          useGlobalHeadingParam: false,
          headingMode: "followWayline",
          turnMode: "toPointAndStopWithContinuityCurvature",
          useGlobalTurnParam: false,
          actions:
            mode === "photo"
              ? [
                  {
                    actionId: 0,
                    actionType: "takePhoto",
                    params: {
                      payloadPositionIndex: 0,
                      payloadLensIndex: "ir",
                    },
                  },
                ]
              : [],
        });
      }
      segmentIndex++;
    }
  }

  if (mode === "video") {
    applyVideoCaptureActions(waypoints);
  }

  return { waypoints, pois: [] };
}
