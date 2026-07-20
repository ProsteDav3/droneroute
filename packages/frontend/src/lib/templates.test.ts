import { describe, it, expect } from "vitest";
import {
  generateOrbit,
  DEFAULT_ORBIT_PARAMS,
  computeGimbalPitch,
  computeAltitudeForPitch,
  computeFramedForRadius,
  computeFramedForAltitude,
  computeOrbitSeedForBuilding,
  orbitParamsForBuilding,
  DEFAULT_WIDE_VFOV_DEG,
  generateSolarSurvey,
  DEFAULT_SOLAR_PARAMS,
  generateGrid,
  DEFAULT_GRID_PARAMS,
  generateFacade,
  DEFAULT_FACADE_PARAMS,
  generatePencil,
  DEFAULT_PENCIL_PARAMS,
  generateCorridor,
  DEFAULT_CORRIDOR_PARAMS,
  generateTurbineInspection,
  DEFAULT_TURBINE_PARAMS,
  bearing,
  destinationPoint,
  minStandoffForFovM,
  clampOrbitCenterForPoiClearance,
} from "./templates";
import type {
  OrbitParams,
  SolarParams,
  GridParams,
  FacadeParams,
  CorridorParams,
  TurbineParams,
} from "./templates";
import {
  recommendSolarSpacing,
  recommendGridSpacing,
  recommendFacadeGrid,
  deriveFacadeGridCounts,
  computeGsdCm,
  computeAltitudeForGsd,
  isMultispectralPayload,
  THERMAL_CAMERA_FOV,
  estimatePhotoFileSizeMB,
  estimateMissionPhotoData,
} from "@/lib/solarCamera";
import {
  haversineDistance,
  distanceToPolygonBoundaryM,
  offsetLatLng,
} from "@/lib/geo";

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

  it("with poiCenter undefined, output is unchanged (byte-identical) from the original flat-pitch/center-heading behavior (regression guard)", () => {
    const withoutPoiCenter = generateOrbit({
      ...DEFAULT_ORBIT_PARAMS,
      center: CENTER,
      radiusM: 70,
      numPoints: 8,
      altitudeGimbalLinked: false,
      // An arbitrary stored pitch that does NOT equal computeGimbalPitch's
      // output — this must still be used as-is when poiCenter is absent.
      gimbalPitchDeg: -12,
    } satisfies OrbitParams);

    expect(
      withoutPoiCenter.waypoints.every((wp) => wp.gimbalPitchAngle === -12),
    ).toBe(true);
    withoutPoiCenter.waypoints.forEach((wp) => {
      const expectedHeading = bearing(
        wp.latitude,
        wp.longitude,
        CENTER[0],
        CENTER[1],
      );
      const normalized =
        expectedHeading > 180 ? expectedHeading - 360 : expectedHeading;
      expect(wp.headingAngle).toBe(Math.round(normalized));
    });
  });

  it("with poiCenter set to an offset point, heading points at poiCenter (not center) and gimbal pitch varies per waypoint", () => {
    const poiCenter = destinationPoint(CENTER[0], CENTER[1], 40, 0);
    const result = generateOrbit({
      ...DEFAULT_ORBIT_PARAMS,
      center: CENTER,
      radiusM: 70,
      numPoints: 8,
      poiHeight: 20,
      altitude: 60,
      poiCenter,
    } satisfies OrbitParams);

    const pitches = new Set(result.waypoints.map((wp) => wp.gimbalPitchAngle));
    // An off-center orbit has varying distance to the fixed aim point, so
    // pitch should not be flat across every waypoint.
    expect(pitches.size).toBeGreaterThan(1);

    result.waypoints.forEach((wp) => {
      const expectedHeading = bearing(
        wp.latitude,
        wp.longitude,
        poiCenter[0],
        poiCenter[1],
      );
      const normalized =
        expectedHeading > 180 ? expectedHeading - 360 : expectedHeading;
      expect(wp.headingAngle).toBe(Math.round(normalized));
    });

    // The POI marker should sit at the aim point, not the circle's center.
    expect(result.pois[0].latitude).toBeCloseTo(poiCenter[0], 6);
    expect(result.pois[0].longitude).toBeCloseTo(poiCenter[1], 6);
  });

  describe("buildingVertices (per-waypoint framing for a non-circular footprint)", () => {
    // An 80m (N-S) x 10m (E-W) rectangle centered on CENTER — deliberately
    // elongated, so a single radius measured from the center is a poor
    // stand-in for the real per-waypoint distance to the nearest edge: a
    // waypoint due north or south sits near the short tip (close), one due
    // east or west sits opposite the long side (far), at the same nominal
    // orbit radius.
    const buildingVertices: [number, number][] = [
      offsetLatLng(CENTER[0], CENTER[1], -40, -5),
      offsetLatLng(CENTER[0], CENTER[1], -40, 5),
      offsetLatLng(CENTER[0], CENTER[1], 40, 5),
      offsetLatLng(CENTER[0], CENTER[1], 40, -5),
    ];

    it("varies gimbal pitch per waypoint instead of the flat gimbalPitchDeg, when linked", () => {
      const result = generateOrbit({
        ...DEFAULT_ORBIT_PARAMS,
        center: CENTER,
        radiusM: 50,
        numPoints: 8,
        altitude: 20,
        poiHeight: 25,
        altitudeGimbalLinked: true,
        buildingVertices,
      } satisfies OrbitParams);

      const pitches = result.waypoints.map((wp) => wp.gimbalPitchAngle);
      expect(new Set(pitches).size).toBeGreaterThan(1);
    });

    it("a waypoint closer to the building's actual edge gets a steeper (more negative) pitch than one farther from it, at the same nominal radius", () => {
      const result = generateOrbit({
        ...DEFAULT_ORBIT_PARAMS,
        center: CENTER,
        radiusM: 50,
        numPoints: 8,
        altitude: 20,
        poiHeight: 25,
        altitudeGimbalLinked: true,
        buildingVertices,
      } satisfies OrbitParams);

      let closest = result.waypoints[0];
      let closestDist = Infinity;
      let farthest = result.waypoints[0];
      let farthestDist = -Infinity;
      for (const wp of result.waypoints) {
        const d = distanceToPolygonBoundaryM(
          [wp.latitude, wp.longitude],
          buildingVertices,
        );
        if (d < closestDist) {
          closestDist = d;
          closest = wp;
        }
        if (d > farthestDist) {
          farthestDist = d;
          farthest = wp;
        }
      }
      expect(closestDist).toBeLessThan(farthestDist);
      expect(closest.gimbalPitchAngle).toBeLessThan(farthest.gimbalPitchAngle);
    });

    it("leaves gimbal pitch flat when altitudeGimbalLinked is false — a manually unlocked pitch is not overridden by building geometry", () => {
      const result = generateOrbit({
        ...DEFAULT_ORBIT_PARAMS,
        center: CENTER,
        radiusM: 25,
        numPoints: 8,
        altitude: 20,
        poiHeight: 25,
        altitudeGimbalLinked: false,
        gimbalPitchDeg: -12,
        buildingVertices,
      } satisfies OrbitParams);

      expect(result.waypoints.every((wp) => wp.gimbalPitchAngle === -12)).toBe(
        true,
      );
    });

    it("poiCenter takes precedence over buildingVertices when both are set", () => {
      const poiCenter = destinationPoint(CENTER[0], CENTER[1], 40, 0);
      const result = generateOrbit({
        ...DEFAULT_ORBIT_PARAMS,
        center: CENTER,
        radiusM: 25,
        numPoints: 8,
        altitude: 20,
        poiHeight: 25,
        altitudeGimbalLinked: true,
        poiCenter,
        buildingVertices,
      } satisfies OrbitParams);

      result.waypoints.forEach((wp) => {
        const expected = computeGimbalPitch(
          20,
          25,
          haversineDistance(
            wp.latitude,
            wp.longitude,
            poiCenter[0],
            poiCenter[1],
          ),
        );
        expect(wp.gimbalPitchAngle).toBeCloseTo(expected, 3);
      });
    });
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

/** Vertical angular span (degrees) of a ground-to-poiHeight object as seen from radiusM/altitude. */
function verticalSpanDeg(
  altitude: number,
  poiHeight: number,
  radiusM: number,
): number {
  const angleBottom = Math.atan2(altitude, radiusM);
  const angleTop = Math.atan2(altitude - poiHeight, radiusM);
  return ((angleBottom - angleTop) * 180) / Math.PI;
}

describe("computeFramedForRadius / computeFramedForAltitude", () => {
  const VFOV = 56.8;
  const SAFETY_MARGIN = 0.5;

  it("computeFramedForRadius: resulting altitude frames the object within the target FOV span", () => {
    const result = computeFramedForRadius(40, 25, VFOV);
    expect(result).not.toBeNull();
    const span = verticalSpanDeg(result!.altitude, 25, 40);
    expect(span).toBeLessThanOrEqual(VFOV * SAFETY_MARGIN + 0.5);
    expect(span).toBeGreaterThan(VFOV * SAFETY_MARGIN - 0.5);
  });

  it("computeFramedForAltitude: resulting radius frames the object within the target FOV span", () => {
    // prevRadius=40 steers root selection to the larger, realistic root —
    // the smaller root here (~3.5m) is an unrealistically close orbit that
    // gets pulled off-target by the MIN_RADIUS_M clamp.
    const result = computeFramedForAltitude(30, 25, VFOV, 40);
    expect(result).not.toBeNull();
    const span = verticalSpanDeg(30, 25, result!.radiusM);
    expect(span).toBeLessThanOrEqual(VFOV * SAFETY_MARGIN + 0.5);
    expect(span).toBeGreaterThan(VFOV * SAFETY_MARGIN - 0.5);
  });

  it("gimbal pitch centers the vertical span (equal angle to top and bottom of the object)", () => {
    const result = computeFramedForRadius(40, 25, VFOV);
    expect(result).not.toBeNull();
    const { altitude, gimbalPitchDeg } = result!;
    const angleBottom = (Math.atan2(altitude, 40) * 180) / Math.PI;
    const angleTop = (Math.atan2(altitude - 25, 40) * 180) / Math.PI;
    const midAngle = (angleBottom + angleTop) / 2;
    expect(gimbalPitchDeg).toBeCloseTo(-midAngle, 0);
  });

  it("returns null when poiHeight is 0 (no vertical extent to frame)", () => {
    expect(computeFramedForRadius(40, 0, VFOV)).toBeNull();
    expect(computeFramedForAltitude(60, 0, VFOV)).toBeNull();
  });

  it("returns null only when altitude/poiHeight aren't positive — NOT for altitude at or below poiHeight, which is also always solvable (regression — an earlier version of this fix wrongly returned null for that whole range)", () => {
    expect(computeFramedForAltitude(0, 25, VFOV)).toBeNull();
    expect(computeFramedForAltitude(-5, 25, VFOV)).toBeNull();
    // altitude === poiHeight and altitude < poiHeight must both still
    // resolve — the camera is at or below the object's own top, but the
    // desired span is unconditionally achievable there (see doc comment on
    // computeFramedForAltitude), so no capping/null is needed.
    expect(computeFramedForAltitude(25, 25, VFOV)).not.toBeNull();
    expect(computeFramedForAltitude(20, 25, VFOV)).not.toBeNull();
  });

  it("computeFramedForRadius: for a radius far too large to ever reach the aspirational target, still returns the best achievable framing instead of null (regression — this used to silently fall back to gimbal-only linking for any realistically large radius)", () => {
    const result = computeFramedForRadius(5000, 10, VFOV);
    expect(result).not.toBeNull();
    // The achievable span for such a large radius is tiny — nowhere near
    // the aspirational 28.4° target — but a real, flyable altitude/pitch
    // pair must still come back.
    const span = verticalSpanDeg(result!.altitude, 10, 5000);
    expect(span).toBeGreaterThan(0);
    expect(span).toBeLessThan(1);
  });

  it("computeFramedForRadius: a large but realistic radius (further than the building is tall) frames at the capped achievable maximum instead of returning null (regression for the reported bug)", () => {
    // Matches the real-world report: radius grown to 105m for a 40m-tall
    // building — comfortably beyond the 79m point where the old fixed
    // 28.4° target became unreachable and silently stopped updating.
    const result = computeFramedForRadius(105, 40, VFOV, 32);
    expect(result).not.toBeNull();
    const span = verticalSpanDeg(result!.altitude, 40, 105);
    const expectedMaxSpanDeg =
      ((2 * Math.atan(40 / (2 * 105))) / Math.PI) * 180 * 0.98;
    expect(span).toBeCloseTo(expectedMaxSpanDeg, 0);
  });

  it("computeFramedForAltitude: a high altitude relative to a modest poiHeight frames at the capped achievable maximum instead of returning null (regression for the reported bug)", () => {
    // Matches the real-world report: altitude raised to 150m for a 40m-tall
    // building — the old fixed 28.4° target was unreachable there too.
    const result = computeFramedForAltitude(150, 40, VFOV, 55);
    expect(result).not.toBeNull();
    const span = verticalSpanDeg(150, 40, result!.radiusM);
    const expectedMaxSpanDeg =
      (Math.atan(40 / (2 * Math.sqrt(150 * (150 - 40)))) / Math.PI) *
      180 *
      0.98;
    expect(span).toBeCloseTo(expectedMaxSpanDeg, 0);
  });

  it("picks the root closest to a given previous value instead of jumping", () => {
    // radiusM=48 (with poiHeight=25) sits in the narrow band where both
    // quadratic roots for altitude are positive (~4m and ~21m) — a good case
    // to confirm prevAltitude actually steers which one gets picked.
    const near = computeFramedForRadius(48, 25, VFOV, 5);
    const far = computeFramedForRadius(48, 25, VFOV, 20);
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    expect(near!.altitude).not.toBe(far!.altitude);
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

  it("no longer flags the Matrice 4T entry as experimental now that its drone/payload identity is confirmed against a real DJI Pilot 2 export", () => {
    expect(THERMAL_CAMERA_FOV[89].experimental).toBeUndefined();
    expect(THERMAL_CAMERA_FOV[43].experimental).toBeUndefined();
    expect(THERMAL_CAMERA_FOV[53].experimental).toBeUndefined();
  });

  it("a narrower-FOV camera (H20T) recommends tighter spacing than a wider-FOV one (M30T) at the same altitude", () => {
    const h20t = recommendSolarSpacing(30, H20T)!;
    const m30t = recommendSolarSpacing(30, M30T)!;
    expect(h20t.lineSpacingM).toBeLessThan(m30t.lineSpacingM);
  });
});

describe("computeGsdCm / computeAltitudeForGsd", () => {
  const M3E = 66; // 20MP, 5280x3956, vfovDeg 56.8

  it("returns null for a payload with no known wide-camera FOV", () => {
    expect(computeGsdCm(80, 999999)).toBeNull();
    expect(computeAltitudeForGsd(2, 999999)).toBeNull();
  });

  it("returns null for a payload with known FOV but unknown resolution (e.g. H30)", () => {
    expect(computeGsdCm(80, 82)).toBeNull();
  });

  it("computeAltitudeForGsd is the inverse of computeGsdCm", () => {
    const gsd = computeGsdCm(80, M3E)!;
    expect(gsd).toBeGreaterThan(0);
    const altitude = computeAltitudeForGsd(gsd, M3E)!;
    expect(altitude).toBeCloseTo(80, 1);
  });

  it("GSD grows with altitude (coarser resolution higher up)", () => {
    const low = computeGsdCm(40, M3E)!;
    const high = computeGsdCm(120, M3E)!;
    expect(high).toBeGreaterThan(low);
  });
});

describe("estimatePhotoFileSizeMB / estimateMissionPhotoData", () => {
  const M3E = 66; // 20MP, known resolution
  const H30 = 82; // known FOV, unknown resolution

  it("returns null for a payload with unknown resolution", () => {
    expect(estimatePhotoFileSizeMB(H30)).toBeNull();
    expect(estimatePhotoFileSizeMB(999999)).toBeNull();
  });

  it("returns a positive, plausible file size for a known payload", () => {
    const sizeMB = estimatePhotoFileSizeMB(M3E)!;
    expect(sizeMB).toBeGreaterThan(0);
    // 20MP at the documented ~0.4MB/MP estimate should land well within a
    // sane real-world JPEG range, not an absurd number.
    expect(sizeMB).toBeGreaterThan(1);
    expect(sizeMB).toBeLessThan(50);
  });

  it("a higher-resolution payload estimates a larger file size", () => {
    const miniPro4 = 100; // 48MP
    expect(estimatePhotoFileSizeMB(miniPro4)!).toBeGreaterThan(
      estimatePhotoFileSizeMB(M3E)!,
    );
  });

  it("estimateMissionPhotoData scales linearly with photo count", () => {
    const ten = estimateMissionPhotoData(10, M3E);
    const twenty = estimateMissionPhotoData(20, M3E);
    expect(ten.photoCount).toBe(10);
    expect(twenty.estimatedSizeMB).toBeCloseTo(ten.estimatedSizeMB! * 2, 5);
  });

  it("estimateMissionPhotoData returns null size (but a real count) for an unknown-resolution payload", () => {
    const result = estimateMissionPhotoData(50, H30);
    expect(result.photoCount).toBe(50);
    expect(result.estimatedSizeMB).toBeNull();
  });
});

describe("recommendGridSpacing", () => {
  const M3E = 66;

  it("returns null for a payload with no known wide-camera FOV", () => {
    expect(recommendGridSpacing(80, 999999, 75, 65)).toBeNull();
  });

  it("returns positive spacing below the raw (no-overlap) footprint", () => {
    const rec = recommendGridSpacing(80, M3E, 75, 65)!;
    expect(rec).not.toBeNull();
    expect(rec.lineSpacingM).toBeGreaterThan(0);
    expect(rec.photoSpacingM).toBeGreaterThan(0);
  });

  it("higher overlap % recommends tighter spacing", () => {
    const looseOverlap = recommendGridSpacing(80, M3E, 50, 50)!;
    const tightOverlap = recommendGridSpacing(80, M3E, 90, 90)!;
    expect(tightOverlap.lineSpacingM).toBeLessThan(looseOverlap.lineSpacingM);
    expect(tightOverlap.photoSpacingM).toBeLessThan(looseOverlap.photoSpacingM);
  });
});

describe("recommendFacadeGrid", () => {
  const M30T = 53;

  it("returns null for a payload with no known thermal FOV", () => {
    expect(recommendFacadeGrid(20, 999999, 20, 20)).toBeNull();
  });

  it("returns positive spacing below the raw (no-overlap) footprint", () => {
    const rec = recommendFacadeGrid(20, M30T, 20, 20)!;
    expect(rec).not.toBeNull();
    expect(rec.horizSpacingM).toBeGreaterThan(0);
    expect(rec.vertSpacingM).toBeGreaterThan(0);
    const rawFootprintWidth = 2 * 20 * Math.tan((49.4 * Math.PI) / 180 / 2);
    expect(rec.horizSpacingM).toBeLessThan(rawFootprintWidth);
  });

  it("higher overlap % recommends tighter spacing", () => {
    const looseOverlap = recommendFacadeGrid(20, M30T, 10, 10)!;
    const tightOverlap = recommendFacadeGrid(20, M30T, 60, 60)!;
    expect(tightOverlap.horizSpacingM).toBeLessThan(looseOverlap.horizSpacingM);
    expect(tightOverlap.vertSpacingM).toBeLessThan(looseOverlap.vertSpacingM);
  });

  it("recommends larger spacing at a greater standoff distance (wider footprint)", () => {
    const close = recommendFacadeGrid(10, M30T, 20, 20)!;
    const far = recommendFacadeGrid(30, M30T, 20, 20)!;
    expect(far.horizSpacingM).toBeGreaterThan(close.horizSpacingM);
    expect(far.vertSpacingM).toBeGreaterThan(close.vertSpacingM);
  });

  it("returns null for a zero or negative standoff distance instead of a zero/degenerate footprint (regression — avoids Infinity/NaN downstream)", () => {
    expect(recommendFacadeGrid(0, M30T, 20, 20)).toBeNull();
    expect(recommendFacadeGrid(-5, M30T, 20, 20)).toBeNull();
  });
});

describe("deriveFacadeGridCounts", () => {
  it("computes counts whose delivered spacing is never coarser than requested", () => {
    const { numColumns, numRows } = deriveFacadeGridCounts(100, 20, 12, 8);
    // numColumns-1 gaps must cover wallLengthM at <= the requested spacing.
    expect(100 / (numColumns - 1)).toBeLessThanOrEqual(12);
    expect(20 / (numRows - 1)).toBeLessThanOrEqual(8);
  });

  it("never returns fewer than the minimum sensible counts for a zero-size wall", () => {
    expect(deriveFacadeGridCounts(0, 0, 5, 5)).toEqual({
      numColumns: 2,
      numRows: 1,
    });
  });

  it("does not produce Infinity/NaN when spacing is zero (defends against a stale/degenerate recommendFacadeGrid result)", () => {
    const { numColumns, numRows } = deriveFacadeGridCounts(50, 10, 0, 0);
    expect(Number.isFinite(numColumns)).toBe(true);
    expect(Number.isFinite(numRows)).toBe(true);
  });
});

describe("isMultispectralPayload", () => {
  it("identifies the Mavic 3M (multispectral) payload", () => {
    expect(isMultispectralPayload(68)).toBe(true);
  });

  it("returns false for RGB-only and thermal payloads", () => {
    expect(isMultispectralPayload(66)).toBe(false); // M3E Camera
    expect(isMultispectralPayload(89)).toBe(false); // Matrice 4T Camera
    expect(isMultispectralPayload(999999)).toBe(false);
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

    // Height well under the footprint radius so the height floor doesn't
    // interfere with this footprint-only assertion.
    const seed = computeOrbitSeedForBuilding(vertices, 10);

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
    const forward = computeOrbitSeedForBuilding(vertices, 10);
    const reversed = computeOrbitSeedForBuilding([...vertices].reverse(), 10);
    expect(reversed.center).toEqual(forward.center);
    expect(reversed.radiusM).toEqual(forward.radiusM);
  });

  it("floors the radius to the building's height when the footprint is small relative to how tall it is", () => {
    // A narrow 6x6 footprint: footprint-based radius is only
    // ~4.2 (half-diagonal) + 15 clearance =~ 19m, far less than a 25m-tall
    // building — the height floor (radius >= height) must take over.
    const size = 6;
    const c00 = CENTER;
    const c10 = destinationPoint(c00[0], c00[1], size, 90);
    const c01 = destinationPoint(c00[0], c00[1], size, 0);
    const c11 = destinationPoint(c01[0], c01[1], size, 90);
    const vertices: [number, number][] = [c00, c10, c11, c01];

    const seed = computeOrbitSeedForBuilding(vertices, 25);

    expect(seed.radiusM).toBeGreaterThanOrEqual(25);
  });

  it("grows the radius so even the bearing closest to the building's real edge (not just the farthest vertex) clears enough distance to frame it comfortably", () => {
    // Same elongated 80x10m footprint as the buildingVertices describe block
    // below: the farthest-vertex radius clears the short N/S tips by only
    // BUILDING_ORBIT_CLEARANCE_M (15m) — nowhere near enough standoff to
    // frame a 25m-tall building at a realistic camera FOV from there.
    const vertices: [number, number][] = [
      offsetLatLng(CENTER[0], CENTER[1], -40, -5),
      offsetLatLng(CENTER[0], CENTER[1], -40, 5),
      offsetLatLng(CENTER[0], CENTER[1], 40, 5),
      offsetLatLng(CENTER[0], CENTER[1], 40, -5),
    ];
    const vfovDeg = 55;
    const height = 25;

    const seed = computeOrbitSeedForBuilding(vertices, height, vfovDeg);

    // Independent re-derivation of the physical "closest distance for the
    // whole object to fit inside the FOV at any pitch" minimum (mirrors
    // minStandoffForFovM's own math: occurs at altitude = height/2, using
    // 90% of the real FOV so the object isn't touching the frame edge).
    const targetSpanRad = ((vfovDeg * 0.9) / 2) * (Math.PI / 180);
    const requiredStandoffM = height / (2 * Math.tan(targetSpanRad));

    // Sample the resulting circle at many bearings — the worst (closest)
    // one must still clear the required standoff, not just the bearing the
    // old farthest-vertex-only radius happened to be sized for.
    let minDist = Infinity;
    for (let i = 0; i < 72; i++) {
      const point = destinationPoint(
        seed.center[0],
        seed.center[1],
        seed.radiusM,
        (360 * i) / 72,
      );
      minDist = Math.min(minDist, distanceToPolygonBoundaryM(point, vertices));
    }
    expect(minDist).toBeGreaterThanOrEqual(requiredStandoffM - 1);
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

  it("uses the building's height as POI height, and derives center/radius/altitude/gimbal pitch consistently with computeOrbitSeedForBuilding + computeFramedForRadius using the default wide-angle FOV", () => {
    const vertices = squareFootprint(40);
    const params = orbitParamsForBuilding({ vertices, height: 25 });

    const seed = computeOrbitSeedForBuilding(vertices, 25);
    expect(params.center).toEqual(seed.center);
    expect(params.radiusM).toBe(seed.radiusM);
    expect(params.poiHeight).toBe(25);
    const span = verticalSpanDeg(params.altitude, 25, seed.radiusM);
    expect(span).toBeLessThanOrEqual(DEFAULT_WIDE_VFOV_DEG * 0.5 + 0.5);
  });

  it("produces params usable directly by generateOrbit (a full waypoint loop, not just a seed)", () => {
    const vertices = squareFootprint(40);
    const params = orbitParamsForBuilding({ vertices, height: 25 });
    const result = generateOrbit(params);
    expect(result.waypoints.length).toBe(params.numPoints);
  });

  it("with a known camera vfovDeg, derives altitude/gimbal pitch so the whole building fits in frame using that camera's own FOV rather than the default", () => {
    const vertices = squareFootprint(40);
    const vfovDeg = 26; // narrower than the default wide-angle FOV
    const seed = computeOrbitSeedForBuilding(vertices, 25, vfovDeg);
    const params = orbitParamsForBuilding({ vertices, height: 25 }, vfovDeg);

    expect(params.center).toEqual(seed.center);
    expect(params.radiusM).toBe(seed.radiusM);
    expect(params.poiHeight).toBe(25);
    const span = verticalSpanDeg(params.altitude, 25, seed.radiusM);
    expect(span).toBeLessThanOrEqual(vfovDeg * 0.5 + 0.5);
  });

  it("frames using a default wide-angle FOV instead of the fixed -45°/computeAltitudeForPitch heuristic when vfovDeg is omitted (no drone/camera selected)", () => {
    const vertices = squareFootprint(40);
    const seed = computeOrbitSeedForBuilding(vertices, 25);
    const params = orbitParamsForBuilding({ vertices, height: 25 });

    expect(params.gimbalPitchDeg).not.toBe(-45);
    expect(params.altitude).not.toBe(
      computeAltitudeForPitch(-45, 25, seed.radiusM),
    );
  });

  it("recommends an altitude above the building's own roofline even when its footprint pushes the radius past what the desired framing margin can achieve (regression — a 25m building with a 60m-wide footprint at a 55°-FOV camera used to come back with altitude=20m, below its own 25m roof)", () => {
    // Half-diagonal of a 60x60 square (~42.4m) + 15m clearance = ~57.4m
    // radius, comfortably past the ~51m achievability threshold for a 25m
    // building at a 55° FOV — computeFramedForRadius alone would land both
    // its altitude roots below 25m here (as its own "picks the root closest
    // to a given previous value" test documents for a similar radius).
    const vertices = squareFootprint(60);
    const params = orbitParamsForBuilding({ vertices, height: 25 }, 55);

    expect(params.altitude).toBeGreaterThanOrEqual(25);
    // The whole building (ground to roof) must still be inside the frame:
    // the gimbal should look at least slightly downward past the roofline,
    // not level or upward.
    const angleTop =
      (Math.atan2(params.altitude - 25, params.radiusM) * 180) / Math.PI;
    expect(angleTop).toBeGreaterThan(0);
  });
});

describe("clampOrbitCenterForPoiClearance", () => {
  const poi: [number, number] = CENTER;
  const height = 25;
  const vfovDeg = 55;
  const minStandoffM = minStandoffForFovM(height, vfovDeg);

  it("leaves the candidate center untouched when already far enough from the POI", () => {
    // 200m due east — the circle's near edge (200 - radius) is still well
    // past the minimum standoff.
    const radiusM = 50;
    const candidate = destinationPoint(poi[0], poi[1], 200, 90);
    const clamped = clampOrbitCenterForPoiClearance(
      candidate,
      poi,
      radiusM,
      minStandoffM,
    );
    expect(clamped).toEqual(candidate);
  });

  it("pushes the center farther away when the circle's near edge would otherwise cross the minimum standoff", () => {
    const radiusM = 50;
    // Only 60m from the POI — with a 50m radius, the near edge would sit
    // just 10m from the POI, far inside the physical minimum.
    const candidate = destinationPoint(poi[0], poi[1], 60, 90);
    const clamped = clampOrbitCenterForPoiClearance(
      candidate,
      poi,
      radiusM,
      minStandoffM,
    );

    const clampedDist = bearing(poi[0], poi[1], clamped[0], clamped[1]);
    // Direction (bearing) is preserved — still due east.
    expect(clampedDist).toBeCloseTo(90, 0);

    // The circle's near edge now sits exactly at the minimum standoff.
    const distFromPoi = Math.hypot(
      (clamped[0] - poi[0]) * 111320,
      (clamped[1] - poi[1]) * 111320 * Math.cos((poi[0] * Math.PI) / 180),
    );
    expect(Math.abs(distFromPoi - radiusM)).toBeCloseTo(minStandoffM, 0);
  });

  it("keeps the POI inside the circle rather than pushing it outside, when that requires less movement", () => {
    // A large radius (300m) with the candidate center placed so the POI
    // sits just 10m inside the circle's boundary (dist = radius - 10) —
    // closer to satisfying the standoff by nudging the center a little
    // farther out (POI stays inside) than by dragging the whole 300m circle
    // all the way past the POI to the outside.
    const radiusM = 300;
    const candidate = destinationPoint(poi[0], poi[1], radiusM - 10, 45);
    const clamped = clampOrbitCenterForPoiClearance(
      candidate,
      poi,
      radiusM,
      minStandoffM,
    );

    const distFromPoi = Math.hypot(
      (clamped[0] - poi[0]) * 111320,
      (clamped[1] - poi[1]) * 111320 * Math.cos((poi[0] * Math.PI) / 180),
    );
    // Confirms the "inside" branch was chosen: distance from POI to the new
    // center is close to radiusM - minStandoffM, not radiusM + minStandoffM.
    expect(distFromPoi).toBeCloseTo(radiusM - minStandoffM, 0);
  });

  it("picks an arbitrary direction (doesn't throw) when the candidate lands exactly on the POI", () => {
    const clamped = clampOrbitCenterForPoiClearance(poi, poi, 50, minStandoffM);
    expect(Number.isFinite(clamped[0])).toBe(true);
    expect(Number.isFinite(clamped[1])).toBe(true);
  });
});

describe("capture mode (photo/video)", () => {
  it("generateOrbit: video mode puts startRecord only on the first waypoint and stopRecord only on the last", () => {
    const result = generateOrbit({
      ...DEFAULT_ORBIT_PARAMS,
      center: CENTER,
      radiusM: 50,
      numPoints: 6,
      captureMode: "video",
    } satisfies OrbitParams);

    expect(result.waypoints[0].actions).toEqual([
      {
        actionId: 0,
        actionType: "startRecord",
        params: { payloadPositionIndex: 0 },
      },
    ]);
    expect(result.waypoints[result.waypoints.length - 1].actions).toEqual([
      {
        actionId: 0,
        actionType: "stopRecord",
        params: { payloadPositionIndex: 0 },
      },
    ]);
    for (const wp of result.waypoints.slice(1, -1)) {
      expect(wp.actions).toEqual([]);
    }
  });

  it("generateOrbit: photo mode puts a takePhoto action on every waypoint", () => {
    const result = generateOrbit({
      ...DEFAULT_ORBIT_PARAMS,
      center: CENTER,
      radiusM: 50,
      numPoints: 6,
      captureMode: "photo",
    } satisfies OrbitParams);

    expect(
      result.waypoints.every(
        (wp) =>
          wp.actions.length === 1 && wp.actions[0].actionType === "takePhoto",
      ),
    ).toBe(true);
  });

  it("generateOrbit: no captureMode at all produces no actions (regression — matches every orbit generated before this field existed)", () => {
    const { captureMode: _omit, ...legacyParams } = {
      ...DEFAULT_ORBIT_PARAMS,
      center: CENTER,
      radiusM: 50,
      numPoints: 6,
    } satisfies OrbitParams;
    const result = generateOrbit(legacyParams as OrbitParams);

    expect(result.waypoints.every((wp) => wp.actions.length === 0)).toBe(true);
  });

  it("generateGrid: legacy addPhotos:true with no captureMode still behaves as photo mode (regression)", () => {
    const { captureMode: _omit, ...legacyParams } = {
      ...DEFAULT_GRID_PARAMS,
      corner1: CENTER,
      corner2: destinationPoint(CENTER[0], CENTER[1], 100, 45),
      addPhotos: true,
    } satisfies GridParams;
    const result = generateGrid(legacyParams as GridParams);

    expect(result.waypoints.length).toBeGreaterThan(0);
    expect(
      result.waypoints.every(
        (wp) =>
          wp.actions.length === 1 && wp.actions[0].actionType === "takePhoto",
      ),
    ).toBe(true);
  });

  it("generateGrid: places photos at regular intervals along each pass, not just at its two endpoints", () => {
    const result = generateGrid({
      ...DEFAULT_GRID_PARAMS,
      corner1: CENTER,
      corner2: destinationPoint(CENTER[0], CENTER[1], 200, 45),
      spacingM: 100,
      photoSpacingM: 20,
    } satisfies GridParams);

    // Each pass is roughly 200m long with a 20m photo spacing, so every
    // pass should contribute well more than its 2 endpoints.
    expect(result.waypoints.length).toBeGreaterThan(4);
  });

  it("generateGrid: missing photoSpacingM (legacy saved data) falls back to spacingM instead of breaking", () => {
    const { photoSpacingM: _omit, ...legacyParams } = {
      ...DEFAULT_GRID_PARAMS,
      corner1: CENTER,
      corner2: destinationPoint(CENTER[0], CENTER[1], 200, 45),
      spacingM: 30,
    } satisfies GridParams;

    const result = generateGrid(legacyParams as GridParams);

    expect(result.waypoints.length).toBeGreaterThan(0);
    expect(result.waypoints.every((wp) => Number.isFinite(wp.latitude))).toBe(
      true,
    );
  });

  it("generateGrid: crosshatch flies a second pass at 90° and roughly doubles the waypoint count", () => {
    const baseParams = {
      ...DEFAULT_GRID_PARAMS,
      corner1: CENTER,
      corner2: destinationPoint(CENTER[0], CENTER[1], 200, 45),
      spacingM: 100,
      photoSpacingM: 20,
      rotationDeg: 0,
    } satisfies GridParams;

    const singlePass = generateGrid(baseParams);
    const crosshatched = generateGrid({ ...baseParams, crosshatch: true });

    // Roughly double — the 90°-rotated second pass over the same area can
    // have a slightly different line count for a non-square bounding box,
    // so this checks "about 2x", not an exact multiple.
    const ratio = crosshatched.waypoints.length / singlePass.waypoints.length;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.5);
  });

  it("generateGrid: crosshatch's second pass is genuinely rotated 90° from the first, not a duplicate", () => {
    const params = {
      ...DEFAULT_GRID_PARAMS,
      corner1: CENTER,
      corner2: destinationPoint(CENTER[0], CENTER[1], 200, 45),
      spacingM: 100,
      photoSpacingM: 200,
      rotationDeg: 0,
      crosshatch: true,
    } satisfies GridParams;

    const result = generateGrid(params);
    const withoutCrosshatch = generateGrid({ ...params, crosshatch: false });

    // The first N waypoints (single-pass count) should match the
    // non-crosshatch run exactly — crosshatch appends, it doesn't alter
    // the first pass.
    const firstPassCount = withoutCrosshatch.waypoints.length;
    expect(result.waypoints.slice(0, firstPassCount)).toEqual(
      withoutCrosshatch.waypoints,
    );
    // The appended second pass must differ in actual position from the
    // first (proving it's a real 90°-rotated pass, not a re-run of the
    // same rotation).
    const secondPass = result.waypoints.slice(firstPassCount);
    expect(secondPass.length).toBeGreaterThan(0);
    expect(secondPass).not.toEqual(
      withoutCrosshatch.waypoints.slice(0, secondPass.length),
    );
  });

  it("generateGrid: video mode puts startRecord/stopRecord only on the first/last waypoint, after the reverse step", () => {
    const result = generateGrid({
      ...DEFAULT_GRID_PARAMS,
      corner1: CENTER,
      corner2: destinationPoint(CENTER[0], CENTER[1], 100, 45),
      captureMode: "video",
      reverse: true,
    } satisfies GridParams);

    expect(result.waypoints[0].actions[0]?.actionType).toBe("startRecord");
    expect(
      result.waypoints[result.waypoints.length - 1].actions[0]?.actionType,
    ).toBe("stopRecord");
    for (const wp of result.waypoints.slice(1, -1)) {
      expect(wp.actions).toEqual([]);
    }
  });

  it("generatePencil: no captureMode at all produces no actions (regression — matches every pencil path generated before this field existed)", () => {
    const path: [number, number][] = [
      CENTER,
      destinationPoint(CENTER[0], CENTER[1], 50, 90),
      destinationPoint(CENTER[0], CENTER[1], 100, 90),
    ];
    const { captureMode: _omit, ...legacyParams } = {
      ...DEFAULT_PENCIL_PARAMS,
      path,
    } satisfies Parameters<typeof generatePencil>[0];
    const result = generatePencil(
      legacyParams as Parameters<typeof generatePencil>[0],
    );

    expect(result.waypoints.every((wp) => wp.actions.length === 0)).toBe(true);
  });

  it("generatePencil: video mode puts startRecord/stopRecord only on the first/last waypoint", () => {
    const path: [number, number][] = [
      CENTER,
      destinationPoint(CENTER[0], CENTER[1], 50, 90),
      destinationPoint(CENTER[0], CENTER[1], 100, 90),
    ];
    const result = generatePencil({
      ...DEFAULT_PENCIL_PARAMS,
      path,
      captureMode: "video",
    });

    expect(result.waypoints[0].actions[0]?.actionType).toBe("startRecord");
    expect(
      result.waypoints[result.waypoints.length - 1].actions[0]?.actionType,
    ).toBe("stopRecord");
  });

  it("generateCorridor: returns empty for a path with fewer than 2 points or numPoints < 2", () => {
    expect(
      generateCorridor({
        ...DEFAULT_CORRIDOR_PARAMS,
        path: [CENTER],
      } satisfies CorridorParams).waypoints,
    ).toEqual([]);
    expect(
      generateCorridor({
        ...DEFAULT_CORRIDOR_PARAMS,
        path: [CENTER, destinationPoint(CENTER[0], CENTER[1], 100, 90)],
        numPoints: 1,
      } satisfies CorridorParams).waypoints,
    ).toEqual([]);
  });

  it("generateCorridor: a single pass (numPasses=1) flies directly along the drawn centerline", () => {
    const path: [number, number][] = [
      CENTER,
      destinationPoint(CENTER[0], CENTER[1], 100, 90),
    ];
    const result = generateCorridor({
      ...DEFAULT_CORRIDOR_PARAMS,
      path,
      numPoints: 5,
      numPasses: 1,
    } satisfies CorridorParams);

    expect(result.waypoints).toHaveLength(5);
    // Every waypoint should sit almost exactly on the original straight line
    // (no lateral offset applied for a single centerline pass).
    for (const wp of result.waypoints) {
      expect(Math.abs(wp.latitude - CENTER[0])).toBeLessThan(1e-6);
    }
  });

  it("generateCorridor: two passes straddle the centerline, offsetM apart", () => {
    const path: [number, number][] = [
      CENTER,
      destinationPoint(CENTER[0], CENTER[1], 100, 90), // heading east
    ];
    const offsetM = 20;
    const result = generateCorridor({
      ...DEFAULT_CORRIDOR_PARAMS,
      path,
      numPoints: 3,
      numPasses: 2,
      offsetM,
    } satisfies CorridorParams);

    expect(result.waypoints).toHaveLength(6);
    // First waypoint of pass 1 and last waypoint of pass 2 correspond to the
    // same original path position (index 0) on opposite passes — lawn-mower
    // ordering reverses every other pass, so pass 2 starts where pass 1 (in
    // physical position) ends. Compare the two passes' waypoints at the
    // same original index instead of relying on array position.
    const pass1Start = result.waypoints[0];
    const pass2End = result.waypoints[5];
    const dist = haversineDistance(
      pass1Start.latitude,
      pass1Start.longitude,
      pass2End.latitude,
      pass2End.longitude,
    );
    expect(dist).toBeCloseTo(offsetM, 0);
  });

  it("generateCorridor: video mode puts startRecord/stopRecord only on the first/last waypoint", () => {
    const path: [number, number][] = [
      CENTER,
      destinationPoint(CENTER[0], CENTER[1], 100, 90),
    ];
    const result = generateCorridor({
      ...DEFAULT_CORRIDOR_PARAMS,
      path,
      numPoints: 4,
      numPasses: 2,
      captureMode: "video",
    } satisfies CorridorParams);

    expect(result.waypoints[0].actions[0]?.actionType).toBe("startRecord");
    expect(
      result.waypoints[result.waypoints.length - 1].actions[0]?.actionType,
    ).toBe("stopRecord");
  });

  it("generateCorridor: photo mode puts a takePhoto action on every waypoint", () => {
    const path: [number, number][] = [
      CENTER,
      destinationPoint(CENTER[0], CENTER[1], 100, 90),
    ];
    const result = generateCorridor({
      ...DEFAULT_CORRIDOR_PARAMS,
      path,
      numPoints: 4,
      numPasses: 3,
      captureMode: "photo",
    } satisfies CorridorParams);

    expect(
      result.waypoints.every(
        (wp) =>
          wp.actions.length === 1 && wp.actions[0].actionType === "takePhoto",
      ),
    ).toBe(true);
  });

  it("generateTurbineInspection: returns empty when numBlades < 1 or numPointsPerBlade < 2", () => {
    expect(
      generateTurbineInspection({
        ...DEFAULT_TURBINE_PARAMS,
        hubCenter: CENTER,
        numBlades: 0,
      } satisfies TurbineParams).waypoints,
    ).toEqual([]);
    expect(
      generateTurbineInspection({
        ...DEFAULT_TURBINE_PARAMS,
        hubCenter: CENTER,
        numPointsPerBlade: 1,
      } satisfies TurbineParams).waypoints,
    ).toEqual([]);
  });

  it("generateTurbineInspection: produces numBlades * numPasses * numPointsPerBlade waypoints", () => {
    const result = generateTurbineInspection({
      ...DEFAULT_TURBINE_PARAMS,
      hubCenter: CENTER,
      numBlades: 3,
      numPasses: 2,
      numPointsPerBlade: 10,
    } satisfies TurbineParams);
    expect(result.waypoints).toHaveLength(3 * 2 * 10);
  });

  it("generateTurbineInspection: a vertical blade (angle 0) climbs from hub height to hub height + blade length, at a constant lateral position exactly standoffM from the hub", () => {
    const standoffM = 12;
    const result = generateTurbineInspection({
      ...DEFAULT_TURBINE_PARAMS,
      hubCenter: CENTER,
      hubHeight: 90,
      bladeLengthM: 50,
      numBlades: 1,
      numPasses: 1,
      numPointsPerBlade: 5,
      rotorYawDeg: 0,
      blade1AngleDeg: 0,
      standoffM,
    } satisfies TurbineParams);

    expect(result.waypoints[0].height).toBeCloseTo(90, 5);
    expect(result.waypoints[4].height).toBeCloseTo(140, 5);
    const lat0 = result.waypoints[0].latitude;
    const lng0 = result.waypoints[0].longitude;
    for (const wp of result.waypoints) {
      expect(wp.latitude).toBeCloseTo(lat0, 6);
      expect(wp.longitude).toBeCloseTo(lng0, 6);
      // The blade has zero chordwise offset at this angle, so the only
      // horizontal displacement from the hub is the standoff itself — a
      // regression that dropped or zeroed that offset must fail this.
      const distFromHub = haversineDistance(
        CENTER[0],
        CENTER[1],
        wp.latitude,
        wp.longitude,
      );
      expect(distFromHub).toBeCloseTo(standoffM, 0);
    }
  });

  it("generateTurbineInspection: a horizontal blade (angle 90) stays at hub height and moves laterally by ~bladeLengthM", () => {
    const result = generateTurbineInspection({
      ...DEFAULT_TURBINE_PARAMS,
      hubCenter: CENTER,
      hubHeight: 90,
      bladeLengthM: 50,
      numBlades: 1,
      numPasses: 1,
      numPointsPerBlade: 5,
      rotorYawDeg: 0,
      blade1AngleDeg: 90,
    } satisfies TurbineParams);

    for (const wp of result.waypoints) {
      expect(wp.height).toBeCloseTo(90, 3);
    }
    const distRootToTip = haversineDistance(
      result.waypoints[0].latitude,
      result.waypoints[0].longitude,
      result.waypoints[4].latitude,
      result.waypoints[4].longitude,
    );
    expect(distRootToTip).toBeCloseTo(50, 0);
  });

  it("generateTurbineInspection: heading is fixed and points back toward the hub", () => {
    const result = generateTurbineInspection({
      ...DEFAULT_TURBINE_PARAMS,
      hubCenter: CENTER,
      numBlades: 1,
      numPasses: 1,
      numPointsPerBlade: 5,
      rotorYawDeg: 0,
      blade1AngleDeg: 90,
    } satisfies TurbineParams);

    for (const wp of result.waypoints) {
      expect(wp.headingMode).toBe("fixed");
      const expectedHeading = bearing(
        wp.latitude,
        wp.longitude,
        CENTER[0],
        CENTER[1],
      );
      const normalized =
        expectedHeading > 180 ? expectedHeading - 360 : expectedHeading;
      expect(wp.headingAngle).toBe(Math.round(normalized));
    }
  });

  it("generateTurbineInspection: creates a POI at the hub only when createPoi is true", () => {
    const withPoi = generateTurbineInspection({
      ...DEFAULT_TURBINE_PARAMS,
      hubCenter: CENTER,
      createPoi: true,
    } satisfies TurbineParams);
    expect(withPoi.pois).toHaveLength(1);
    expect(withPoi.pois[0].latitude).toBeCloseTo(CENTER[0], 6);

    const withoutPoi = generateTurbineInspection({
      ...DEFAULT_TURBINE_PARAMS,
      hubCenter: CENTER,
      createPoi: false,
    } satisfies TurbineParams);
    expect(withoutPoi.pois).toEqual([]);
  });

  it("generateTurbineInspection: video mode puts startRecord/stopRecord only on the first/last waypoint", () => {
    const result = generateTurbineInspection({
      ...DEFAULT_TURBINE_PARAMS,
      hubCenter: CENTER,
      numBlades: 3,
      numPasses: 2,
      numPointsPerBlade: 5,
      captureMode: "video",
    } satisfies TurbineParams);

    expect(result.waypoints[0].actions[0]?.actionType).toBe("startRecord");
    expect(
      result.waypoints[result.waypoints.length - 1].actions[0]?.actionType,
    ).toBe("stopRecord");
    for (const wp of result.waypoints.slice(1, -1)) {
      expect(wp.actions).toEqual([]);
    }
  });

  it("generateFacade: legacy addPhotos:true with no captureMode still behaves as photo mode (regression)", () => {
    const { captureMode: _omit, ...legacyParams } = {
      ...DEFAULT_FACADE_PARAMS,
      point1: CENTER,
      point2: destinationPoint(CENTER[0], CENTER[1], 40, 90),
      addPhotos: true,
    } satisfies FacadeParams;
    const result = generateFacade(legacyParams as FacadeParams);

    expect(result.waypoints.length).toBeGreaterThan(0);
    expect(
      result.waypoints.every(
        (wp) =>
          wp.actions.length === 1 && wp.actions[0].actionType === "takePhoto",
      ),
    ).toBe(true);
  });

  it("generateFacade: addPhotos:false with no captureMode produces no actions (regression)", () => {
    const { captureMode: _omit, ...legacyParams } = {
      ...DEFAULT_FACADE_PARAMS,
      point1: CENTER,
      point2: destinationPoint(CENTER[0], CENTER[1], 40, 90),
      addPhotos: false,
    } satisfies FacadeParams;
    const result = generateFacade(legacyParams as FacadeParams);

    expect(result.waypoints.every((wp) => wp.actions.length === 0)).toBe(true);
  });

  it("generateFacade: video mode puts startRecord/stopRecord only on the first/last waypoint", () => {
    const result = generateFacade({
      ...DEFAULT_FACADE_PARAMS,
      point1: CENTER,
      point2: destinationPoint(CENTER[0], CENTER[1], 40, 90),
      captureMode: "video",
    });

    expect(result.waypoints[0].actions[0]?.actionType).toBe("startRecord");
    expect(
      result.waypoints[result.waypoints.length - 1].actions[0]?.actionType,
    ).toBe("stopRecord");
    for (const wp of result.waypoints.slice(1, -1)) {
      expect(wp.actions).toEqual([]);
    }
  });

  function squareVertices(sizeM: number): [number, number][] {
    const east = destinationPoint(CENTER[0], CENTER[1], sizeM, 90);
    const northEast = destinationPoint(east[0], east[1], sizeM, 0);
    const north = destinationPoint(CENTER[0], CENTER[1], sizeM, 0);
    return [CENTER, east, northEast, north];
  }

  it("generateSolarSurvey: legacy addPhotos:true with no captureMode still behaves as photo mode (regression)", () => {
    const { captureMode: _omit, ...legacyParams } = {
      ...DEFAULT_SOLAR_PARAMS,
      vertices: squareVertices(40),
      rowAngleDeg: 90,
      addPhotos: true,
    } satisfies SolarParams;
    const result = generateSolarSurvey(legacyParams as SolarParams);

    expect(result.waypoints.length).toBeGreaterThan(0);
    expect(
      result.waypoints.every(
        (wp) =>
          wp.actions.length === 1 && wp.actions[0].actionType === "takePhoto",
      ),
    ).toBe(true);
  });

  it("generateSolarSurvey: video mode puts startRecord/stopRecord only on the first/last waypoint", () => {
    const result = generateSolarSurvey({
      ...DEFAULT_SOLAR_PARAMS,
      vertices: squareVertices(40),
      rowAngleDeg: 90,
      captureMode: "video",
    });

    expect(result.waypoints[0].actions[0]?.actionType).toBe("startRecord");
    expect(
      result.waypoints[result.waypoints.length - 1].actions[0]?.actionType,
    ).toBe("stopRecord");
    for (const wp of result.waypoints.slice(1, -1)) {
      expect(wp.actions).toEqual([]);
    }
  });

  it("applyVideoCaptureActions edge case: a single-waypoint path gets both startRecord and stopRecord with distinct actionIds", () => {
    const result = generateOrbit({
      ...DEFAULT_ORBIT_PARAMS,
      center: CENTER,
      radiusM: 50,
      numPoints: 1,
      captureMode: "video",
    } satisfies OrbitParams);

    expect(result.waypoints).toHaveLength(1);
    expect(result.waypoints[0].actions).toEqual([
      {
        actionId: 0,
        actionType: "startRecord",
        params: { payloadPositionIndex: 0 },
      },
      {
        actionId: 1,
        actionType: "stopRecord",
        params: { payloadPositionIndex: 0 },
      },
    ]);
  });
});
