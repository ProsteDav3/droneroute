import { describe, it, expect } from "vitest";
import {
  generateOrbit,
  DEFAULT_ORBIT_PARAMS,
  computeGimbalPitch,
  computeAltitudeForPitch,
  computeOrbitSeedForBuilding,
  orbitParamsForBuilding,
  generateSolarSurvey,
  bearing,
  destinationPoint,
} from "./templates";
import type { OrbitParams, SolarParams } from "./templates";
import { recommendSolarSpacing, THERMAL_CAMERA_FOV } from "@/lib/solarCamera";
import { haversineDistance } from "@/lib/geo";

const CENTER: [number, number] = [50.06, 14.43];

describe("generateOrbit", () => {
  it("closed loop (360°) is unaffected by direction beyond a mirror", () => {
    const cw = generateOrbit({
      ...DEFAULT_ORBIT_PARAMS,
      center: CENTER,
      radiusM: 70,
      numPoints: 8,
      clockwise: true,
    } satisfies OrbitParams);
    const ccw = generateOrbit({
      ...DEFAULT_ORBIT_PARAMS,
      center: CENTER,
      radiusM: 70,
      numPoints: 8,
      clockwise: false,
    } satisfies OrbitParams);
    expect(cw.waypoints).toHaveLength(8);
    expect(ccw.waypoints).toHaveLength(8);
  });

  it("open arc: both clockwise and counter-clockwise end exactly on endAngleDeg (regression — CCW used to backtrack and miss it)", () => {
    for (const clockwise of [true, false]) {
      const result = generateOrbit({
        ...DEFAULT_ORBIT_PARAMS,
        center: CENTER,
        radiusM: 70,
        numPoints: 4,
        startAngleDeg: 0,
        endAngleDeg: 270,
        clockwise,
      } satisfies OrbitParams);

      const last = result.waypoints[result.waypoints.length - 1];
      const lastBearing = bearing(
        CENTER[0],
        CENTER[1],
        last.latitude,
        last.longitude,
      );
      // Allow a small tolerance for the local-flat-earth approximation.
      expect(Math.abs(lastBearing - 270)).toBeLessThan(1);
    }
  });

  it("open arc: first waypoint always lands on startAngleDeg", () => {
    const result = generateOrbit({
      ...DEFAULT_ORBIT_PARAMS,
      center: CENTER,
      radiusM: 70,
      numPoints: 5,
      startAngleDeg: 45,
      endAngleDeg: 200,
      clockwise: true,
    } satisfies OrbitParams);
    const first = result.waypoints[0];
    const firstBearing = bearing(
      CENTER[0],
      CENTER[1],
      first.latitude,
      first.longitude,
    );
    expect(Math.abs(firstBearing - 45)).toBeLessThan(1);
  });
});

describe("computeGimbalPitch / computeAltitudeForPitch", () => {
  it("round-trips: altitude -> pitch -> altitude", () => {
    const altitude = computeAltitudeForPitch(
      computeGimbalPitch(45, 30, 70),
      30,
      70,
    );
    expect(altitude).toBe(45);
  });

  it("round-trips: pitch -> altitude -> pitch", () => {
    const pitch = computeGimbalPitch(
      computeAltitudeForPitch(-30, 30, 70),
      30,
      70,
    );
    expect(pitch).toBe(-30);
  });

  it("does not produce an astronomical altitude at the ±90° asymptote (regression)", () => {
    const altitude = computeAltitudeForPitch(-90, 30, 70);
    expect(altitude).toBeLessThanOrEqual(500);
    expect(altitude).toBeGreaterThanOrEqual(1);
  });

  it("converges to a stable fixed point instead of drifting forever once floored (regression)", () => {
    // poiHeight=0, pitch=0, large radius pushes the naive altitude below 1m,
    // triggering the floor clamp. One extra round-trip should reach a fixed
    // point (same altitude/pitch pair reproduces itself), rather than
    // oscillating indefinitely as edits accumulate.
    let altitude = computeAltitudeForPitch(0, 0, 90);
    let pitch = computeGimbalPitch(altitude, 0, 90);
    altitude = computeAltitudeForPitch(pitch, 0, 90);
    pitch = computeGimbalPitch(altitude, 0, 90);

    const nextAltitude = computeAltitudeForPitch(pitch, 0, 90);
    const nextPitch = computeGimbalPitch(nextAltitude, 0, 90);

    expect(nextAltitude).toBe(altitude);
    expect(nextPitch).toBe(pitch);
  });
});

describe("generateSolarSurvey", () => {
  function rectVertices(
    widthM: number,
    heightM: number,
    rotationDeg = 0,
  ): [number, number][] {
    const corners: [number, number][] = [
      [-widthM / 2, -heightM / 2],
      [widthM / 2, -heightM / 2],
      [widthM / 2, heightM / 2],
      [-widthM / 2, heightM / 2],
    ];
    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return corners.map(([x, y]) => {
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      // Reuse destinationPoint (bearing/distance) to place each corner
      // precisely relative to CENTER without duplicating projection math.
      const dist = Math.sqrt(rx * rx + ry * ry);
      const brg = (Math.atan2(rx, ry) * 180) / Math.PI;
      return dist === 0
        ? CENTER
        : destinationPoint(CENTER[0], CENTER[1], dist, brg);
    });
  }

  // rowAngleDeg is a compass bearing (0=N, 90=E). For an un-rotated
  // rectVertices(w, h) shape, the "width" edge runs due east — bearing 90° —
  // which is what these fixtures pass unless testing a rotated shape.
  const EAST_ROW_ANGLE = 90;

  it("every flight line contributes waypoints — the topmost line must not be silently dropped (regression)", () => {
    const params: SolarParams = {
      vertices: rectVertices(100, 40),
      altitude: 30,
      spacingM: 10,
      // Larger than the row length, so each line still gets exactly its
      // two endpoints — isolates the topmost-line regression from the
      // separate along-track photo-spacing behavior tested below.
      photoSpacingM: 200,
      rowAngleDeg: EAST_ROW_ANGLE,
      addPhotos: true,
    };
    const result = generateSolarSurvey(params);
    // No line should ever contribute zero waypoints. Group by height (all
    // waypoints share the mission altitude, so use position along the
    // cross-sweep axis via index pairing instead): every consecutive pair
    // is one line's two endpoints, so the total must be even and non-zero
    // per expected line count.
    expect(result.waypoints.length).toBeGreaterThan(0);
    expect(result.waypoints.length % 2).toBe(0);
    // With a 40m cross-extent (worst case, ignoring which edge is longest)
    // and 10m spacing, there must be at least ceil(40/10)+1 = 5 lines, i.e.
    // at least 10 waypoints — the old bug capped this at 4 lines (8 pts)
    // by always losing the last line.
    expect(result.waypoints.length).toBeGreaterThanOrEqual(10);
  });

  it("produces the same waypoint count for a rotated shape when rowAngleDeg is adjusted to match (manual row-angle rotation-invariance)", () => {
    // rectVertices' rotationDeg is a counterclockwise math rotation of the
    // local (east, north) coordinates, which *decreases* compass bearing
    // (clockwise-increasing) by the same amount — a +30° shape rotation
    // means the row's compass bearing drops from 90° to 60°.
    const rotated = generateSolarSurvey({
      vertices: rectVertices(100, 40, 30),
      altitude: 30,
      spacingM: 10,
      photoSpacingM: 200,
      rowAngleDeg: EAST_ROW_ANGLE - 30,
      addPhotos: false,
    });
    const unrotated = generateSolarSurvey({
      vertices: rectVertices(100, 40, 0),
      altitude: 30,
      spacingM: 10,
      photoSpacingM: 200,
      rowAngleDeg: EAST_ROW_ANGLE,
      addPhotos: false,
    });
    // Same shape, just rotated, with rowAngleDeg rotated by the same
    // amount — should produce the same waypoint count.
    expect(rotated.waypoints.length).toBe(unrotated.waypoints.length);
  });

  it("clips flight lines to a concave (L-shaped) polygon — no waypoint lands in the missing corner, including along-track points mid-row", () => {
    // L-shape: a big block with the top-right quadrant notched out.
    const local: [number, number][] = [
      [0, 0],
      [80, 0],
      [80, 30],
      [40, 30],
      [40, 60],
      [0, 60],
    ];
    const vertices = local.map(([x, y]) =>
      destinationPoint(
        CENTER[0],
        CENTER[1],
        Math.sqrt(x * x + y * y),
        (Math.atan2(x, y) * 180) / Math.PI,
      ),
    );
    const result = generateSolarSurvey({
      vertices,
      altitude: 30,
      spacingM: 15,
      // Small on purpose: stresses that intermediate along-track points
      // (not just each row's two endpoints) also respect the clip boundary.
      photoSpacingM: 5,
      rowAngleDeg: EAST_ROW_ANGLE,
      addPhotos: false,
    });

    expect(result.waypoints.length).toBeGreaterThan(0);

    for (const wp of result.waypoints) {
      const distLat = (wp.latitude - CENTER[0]) * 111320;
      const distLng =
        (wp.longitude - CENTER[1]) *
        111320 *
        Math.cos((CENTER[0] * Math.PI) / 180);
      // Local x/y in the same frame used to build the fixture above.
      const localY = distLat;
      const localX = distLng;
      const inNotch = localY > 30.5 && localX > 40.5;
      expect(inNotch).toBe(false);
    }
  });

  it("returns no waypoints for a degenerate (fewer than 3 vertices) shape", () => {
    const result = generateSolarSurvey({
      vertices: [CENTER, destinationPoint(CENTER[0], CENTER[1], 10, 0)],
      altitude: 30,
      spacingM: 10,
      photoSpacingM: 8,
      rowAngleDeg: EAST_ROW_ANGLE,
      addPhotos: false,
    });
    expect(result.waypoints).toHaveLength(0);
  });

  it("places photos every ~photoSpacingM along a long row, not just at its two ends (regression for the reported 'only photographs the ends' bug)", () => {
    // A single long thin strip: one flight line spans its full ~200m length.
    const result = generateSolarSurvey({
      vertices: rectVertices(200, 10),
      altitude: 30,
      spacingM: 100, // wider than the 10m extent -> exactly one flight line
      photoSpacingM: 20,
      rowAngleDeg: EAST_ROW_ANGLE,
      addPhotos: true,
    });

    // ceil(200/20)+1 = 11 points along the single row.
    expect(result.waypoints.length).toBeGreaterThanOrEqual(11);
    expect(result.waypoints.every((wp) => wp.actions.length === 1)).toBe(true);

    // The points must actually be spread along the row, not clustered at
    // the two ends — the middle third of the row must contain at least one
    // waypoint (would fail under the old "2 points per line" behavior).
    const lngs = result.waypoints.map((wp) => wp.longitude);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const midLow = minLng + (maxLng - minLng) / 3;
    const midHigh = maxLng - (maxLng - minLng) / 3;
    expect(lngs.some((lng) => lng > midLow && lng < midHigh)).toBe(true);
  });
});

describe("recommendSolarSpacing", () => {
  const H20T = 43;
  const M30T = 53;

  it("returns null for a payload with no known thermal FOV", () => {
    expect(recommendSolarSpacing(30, 999999)).toBeNull();
  });

  it("returns positive spacing values, smaller than the raw (no-overlap) footprint, for a known payload", () => {
    const rec = recommendSolarSpacing(30, M30T);
    expect(rec).not.toBeNull();
    expect(rec!.lineSpacingM).toBeGreaterThan(0);
    expect(rec!.photoSpacingM).toBeGreaterThan(0);
    // Default overlap is positive, so the recommendation must be strictly
    // less than the raw (0% overlap) ground footprint at this altitude.
    const rawFootprintWidth = 2 * 30 * Math.tan((49.4 * Math.PI) / 180 / 2);
    expect(rec!.lineSpacingM).toBeLessThan(rawFootprintWidth);
  });

  it("recommends larger spacing at a higher altitude (wider ground footprint)", () => {
    const low = recommendSolarSpacing(20, H20T)!;
    const high = recommendSolarSpacing(60, H20T)!;
    expect(high.lineSpacingM).toBeGreaterThan(low.lineSpacingM);
    expect(high.photoSpacingM).toBeGreaterThan(low.photoSpacingM);
  });

  it("flags the Matrice 4T entry as experimental, matching its unconfirmed drone/payload identity in DRONE_MODELS", () => {
    expect(THERMAL_CAMERA_FOV[103].experimental).toBe(true);
    // Verified payloads must not carry the caveat.
    expect(THERMAL_CAMERA_FOV[43].experimental).toBeUndefined();
    expect(THERMAL_CAMERA_FOV[53].experimental).toBeUndefined();
  });

  it("a narrower-FOV camera (H20T) recommends tighter spacing than a wider-FOV one (M30T) at the same altitude", () => {
    const h20t = recommendSolarSpacing(30, H20T)!;
    const m30t = recommendSolarSpacing(30, M30T)!;
    expect(h20t.lineSpacingM).toBeLessThan(m30t.lineSpacingM);
  });
});

describe("computeOrbitSeedForBuilding", () => {
  it("centers on the footprint centroid and radius covers the farthest corner plus clearance", () => {
    const size = 40;
    const c00 = CENTER;
    const c10 = destinationPoint(c00[0], c00[1], size, 90);
    const c01 = destinationPoint(c00[0], c00[1], size, 0);
    const c11 = destinationPoint(c01[0], c01[1], size, 90);
    const vertices: [number, number][] = [c00, c10, c11, c01];

    const seed = computeOrbitSeedForBuilding(vertices);

    // True geometric center of a 40x40 square is ~28.3m from any corner.
    const distFromCorner = haversineDistance(
      seed.center[0],
      seed.center[1],
      c00[0],
      c00[1],
    );
    expect(distFromCorner).toBeGreaterThan(25);
    expect(distFromCorner).toBeLessThan(32);

    // Radius covers the half-diagonal (~28.3m) plus the fixed clearance.
    expect(seed.radiusM).toBeGreaterThan(40);
    expect(seed.radiusM).toBeLessThan(46);
  });

  it("is invariant under vertex winding order", () => {
    const vertices: [number, number][] = [
      CENTER,
      destinationPoint(CENTER[0], CENTER[1], 30, 90),
      destinationPoint(CENTER[0], CENTER[1], 30, 45),
    ];
    const forward = computeOrbitSeedForBuilding(vertices);
    const reversed = computeOrbitSeedForBuilding([...vertices].reverse());
    expect(reversed.center).toEqual(forward.center);
    expect(reversed.radiusM).toEqual(forward.radiusM);
  });
});

describe("orbitParamsForBuilding", () => {
  function squareFootprint(size: number): [number, number][] {
    const c00 = CENTER;
    const c10 = destinationPoint(c00[0], c00[1], size, 90);
    const c01 = destinationPoint(c00[0], c00[1], size, 0);
    const c11 = destinationPoint(c01[0], c01[1], size, 90);
    return [c00, c10, c11, c01];
  }

  it("uses the building's height as POI height, and derives center/radius/altitude/gimbal pitch consistently with computeOrbitSeedForBuilding + computeAltitudeForPitch", () => {
    const vertices = squareFootprint(40);
    const params = orbitParamsForBuilding({ vertices, height: 25 });

    const seed = computeOrbitSeedForBuilding(vertices);
    expect(params.center).toEqual(seed.center);
    expect(params.radiusM).toBe(seed.radiusM);
    expect(params.poiHeight).toBe(25);
    expect(params.altitude).toBe(
      computeAltitudeForPitch(params.gimbalPitchDeg, 25, seed.radiusM),
    );
    // Round-trip sanity: the stored altitude/gimbal pair should reproduce
    // itself through computeGimbalPitch, same as any linked orbit.
    expect(computeGimbalPitch(params.altitude, 25, seed.radiusM)).toBe(
      params.gimbalPitchDeg,
    );
  });

  it("produces params usable directly by generateOrbit (a full waypoint loop, not just a seed)", () => {
    const vertices = squareFootprint(40);
    const params = orbitParamsForBuilding({ vertices, height: 25 });
    const result = generateOrbit(params);
    expect(result.waypoints.length).toBe(params.numPoints);
  });
});
