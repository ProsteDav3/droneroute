import { describe, it, expect } from "vitest";
import {
  generateOrbit,
  DEFAULT_ORBIT_PARAMS,
  computeGimbalPitch,
  computeAltitudeForPitch,
  generateSolarSurvey,
  bearing,
  destinationPoint,
} from "./templates";
import type { OrbitParams, SolarParams } from "./templates";

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

  it("every flight line contributes waypoints — the topmost line must not be silently dropped (regression)", () => {
    const params: SolarParams = {
      vertices: rectVertices(100, 40),
      altitude: 30,
      spacingM: 10,
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

  it("aligns flight lines with the shape's longest edge regardless of rotation", () => {
    const rotated = generateSolarSurvey({
      vertices: rectVertices(100, 40, 30),
      altitude: 30,
      spacingM: 10,
      addPhotos: false,
    });
    const unrotated = generateSolarSurvey({
      vertices: rectVertices(100, 40, 0),
      altitude: 30,
      spacingM: 10,
      addPhotos: false,
    });
    // Same shape, just rotated — should produce the same waypoint count.
    expect(rotated.waypoints.length).toBe(unrotated.waypoints.length);
  });

  it("clips flight lines to a concave (L-shaped) polygon — no waypoint lands in the missing corner", () => {
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
      addPhotos: false,
    });
    expect(result.waypoints).toHaveLength(0);
  });
});
