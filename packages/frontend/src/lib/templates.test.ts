import { describe, it, expect } from "vitest";
import { CAMERA_SETTLE_SECONDS } from "@droneroute/shared";
import {
  generateOrbit,
  DEFAULT_ORBIT_PARAMS,
  computeGimbalPitch,
  computeOrbitAimPitch,
  computeRadiusForPitch,
  aimPitchOutOfRange,
  CINEMA_SPEED_MPS,
  fitRadiusRange,
  fitAltitudeRange,
  MAX_GIMBAL_PITCH_DEG,
  MIN_GIMBAL_PITCH_DEG,
  objectFitsInFrame,
  computeAltitudeForPitch,
  computeFramedForRadius,
  computeFramedForAltitude,
  computeOrbitSeedForBuilding,
  orbitParamsForBuilding,
  recomputeBuildingOrbitForArc,
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
  minStandoffForBuildingPoiClearanceM,
  poiDistanceSwing,
  orbitStandoffViolation,
  orbitMinStandoffM,
  buildingLengthShortfall,
  clampOrbitCenterForPoiClearance,
  radiusForNearestStandoffM,
  orbitRadiusAtBearing,
  alignOrbitToDistance,
  signedArcSweepDeg,
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

  describe("buildingVertices (a single flat pitch for the whole orbit, regardless of footprint shape)", () => {
    // An 80m (N-S) x 10m (E-W) rectangle centered on CENTER — deliberately
    // elongated, so the real per-waypoint distance to the nearest edge
    // varies a lot around the loop (a waypoint due north or south sits near
    // the short tip, one due east or west sits opposite the long side, at
    // the same nominal orbit radius) — exactly the shape that used to make
    // pitch vary per waypoint before that was replaced with a single flat
    // value, computed once, so the whole flight reads as one continuous
    // shot instead of the gimbal visibly tilting over the flight.
    const buildingVertices: [number, number][] = [
      offsetLatLng(CENTER[0], CENTER[1], -40, -5),
      offsetLatLng(CENTER[0], CENTER[1], -40, 5),
      offsetLatLng(CENTER[0], CENTER[1], 40, 5),
      offsetLatLng(CENTER[0], CENTER[1], 40, -5),
    ];

    it("keeps gimbal pitch flat across every waypoint, matching gimbalPitchDeg, even though real edge distance varies a lot around this footprint", () => {
      const result = generateOrbit({
        ...DEFAULT_ORBIT_PARAMS,
        center: CENTER,
        radiusM: 50,
        numPoints: 8,
        altitude: 20,
        poiHeight: 25,
        altitudeGimbalLinked: true,
        gimbalPitchDeg: -18,
        buildingVertices,
      } satisfies OrbitParams);

      // Confirms this building really does have widely varying edge
      // distance around the loop — otherwise a flat pitch wouldn't be
      // distinguishing this behavior from the trivial "any circle" case.
      const distances = result.waypoints.map((wp) =>
        distanceToPolygonBoundaryM(
          [wp.latitude, wp.longitude],
          buildingVertices,
        ),
      );
      expect(Math.max(...distances) - Math.min(...distances)).toBeGreaterThan(
        10,
      );

      expect(result.waypoints.every((wp) => wp.gimbalPitchAngle === -18)).toBe(
        true,
      );
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

    it("poiCenter takes precedence over buildingVertices for the aim point, and pitch aims at the middle of the object from that point", () => {
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

      // One aiming rule for a locked POI, building or not: point the camera
      // at the aim height (default: the middle of the object) from the real
      // distance to poiCenter. An earlier revision used the ground-to-roof
      // bisector when buildingVertices was set, which put the created POI
      // and the pitch on different targets and, in the field, aimed at the
      // roof.
      expect(result.pois[0].height).toBe(12.5);
      result.waypoints.forEach((wp) => {
        const expected = computeGimbalPitch(
          20,
          12.5,
          haversineDistance(
            wp.latitude,
            wp.longitude,
            poiCenter[0],
            poiCenter[1],
          ),
        );
        expect(wp.gimbalPitchAngle).toBe(expected);
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

  it("points the gimbal at the middle of the object's height", () => {
    // Was the ground-to-top angle bisector, which centers the object's
    // angular extent a touch better but corresponds to no single height —
    // so the panel's aim-height field couldn't state it truthfully and
    // every inverse solve disagreed with the angle on screen. See
    // computeOrbitAimPitch.
    const result = computeFramedForRadius(40, 25, VFOV);
    expect(result).not.toBeNull();
    const { altitude, gimbalPitchDeg } = result!;
    const midHeightAngle = (Math.atan2(altitude - 12.5, 40) * 180) / Math.PI;
    expect(gimbalPitchDeg).toBeCloseTo(-midHeightAngle, 0);
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

    // Radius comfortably clears more than just the half-diagonal (~28.3m)
    // plus the fixed clearance (~43m total): a corner-facing bearing sees
    // *both* adjacent walls at once (their combined apparent width is the
    // full diagonal, ~56.6m for a 40m square), which needs meaningfully
    // more standoff to fit edge-to-edge than the vertex-clearance floor
    // alone provides — see the horizontal-fit growth in
    // `worstBuildingStandoffDeficitM`.
    expect(seed.radiusM).toBeGreaterThan(60);
    expect(seed.radiusM).toBeLessThan(75);
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

  it("recommends a smaller radius for a partial arc facing the building's long side than for the full 360° loop", () => {
    // Same 80x10m elongated footprint: the full-circle radius has to clear
    // the short N/S tips (close to the circle), which a partial arc facing
    // only the long E/W sides never actually visits.
    const vertices: [number, number][] = [
      offsetLatLng(CENTER[0], CENTER[1], -40, -5),
      offsetLatLng(CENTER[0], CENTER[1], -40, 5),
      offsetLatLng(CENTER[0], CENTER[1], 40, 5),
      offsetLatLng(CENTER[0], CENTER[1], 40, -5),
    ];
    const vfovDeg = 55;
    const height = 25;

    const fullLoop = computeOrbitSeedForBuilding(vertices, height, vfovDeg);
    // An arc centered on due east (90°), comfortably within the long side,
    // nowhere near the narrow N/S tips at 0°/180°.
    const partialArc = computeOrbitSeedForBuilding(
      vertices,
      height,
      vfovDeg,
      60,
      120,
    );

    expect(partialArc.radiusM).toBeLessThan(fullLoop.radiusM);
  });
});

describe("recomputeBuildingOrbitForArc", () => {
  it("shrinks the radius (and re-centers altitude/pitch accordingly) when narrowing to a partial arc facing the building's long side", () => {
    const vertices: [number, number][] = [
      offsetLatLng(CENTER[0], CENTER[1], -40, -5),
      offsetLatLng(CENTER[0], CENTER[1], -40, 5),
      offsetLatLng(CENTER[0], CENTER[1], 40, 5),
      offsetLatLng(CENTER[0], CENTER[1], 40, -5),
    ];
    const vfovDeg = 55;
    const height = 25;

    const fullLoop = orbitParamsForBuilding({ vertices, height }, vfovDeg);
    const partial = recomputeBuildingOrbitForArc(
      vertices,
      height,
      vfovDeg,
      60,
      120,
    );

    expect(partial.radiusM).toBeLessThan(fullLoop.radiusM);
    // Center is the building's own centroid regardless of which arc is
    // flown — narrowing the arc only affects standoff distance, not where
    // the (unflown portion of the) circle would be centered.
    expect(partial.center).toEqual(fullLoop.center);
    // Altitude still stays comfortably above the roofline even at the
    // smaller radius.
    expect(partial.altitude).toBeGreaterThanOrEqual(height);
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
  // A closed loop flies every bearing, so nothing can hide in a gap — this is
  // the case where "nearest flown waypoint" and "the circle's near edge"
  // agree, which is what these limit tests are about.
  const closedLoop = { startAngleDeg: 0, endAngleDeg: 360, numPoints: 72 };
  const distFromPoi = (p: [number, number]) =>
    haversineDistance(poi[0], poi[1], p[0], p[1]);

  it("leaves the candidate center untouched when already far enough from the POI", () => {
    // 200m due east — the circle's near edge (200 - radius) is still well
    // past the minimum standoff.
    const candidate = destinationPoint(poi[0], poi[1], 200, 90);
    const clamped = clampOrbitCenterForPoiClearance(candidate, poi, {
      poiCenter: poi,
      radiusM: 50,
      minStandoffM,
      ...closedLoop,
    });
    expect(clamped).toEqual(candidate);
  });

  it("stops the drag at the limit when the circle would otherwise cross the minimum standoff", () => {
    const radiusM = 50;
    // Only 60m from the POI — with a 50m radius the near edge would sit just
    // 10m away, far inside the physical minimum. Dragged out from the POI,
    // so the clamp holds it at the last position that still clears.
    const candidate = destinationPoint(poi[0], poi[1], 60, 90);
    const clamped = clampOrbitCenterForPoiClearance(candidate, poi, {
      poiCenter: poi,
      radiusM,
      minStandoffM,
      ...closedLoop,
    });

    // Direction (bearing) is preserved — still due east, on the drag line.
    expect(bearing(poi[0], poi[1], clamped[0], clamped[1])).toBeCloseTo(90, 0);
    // And the circle's near edge sits at the minimum, not past it.
    expect(Math.abs(distFromPoi(clamped) - radiusM)).toBeGreaterThanOrEqual(
      minStandoffM - 0.5,
    );
    expect(distFromPoi(clamped)).toBeLessThan(60);
  });

  it("keeps the POI inside the circle rather than flinging it outside", () => {
    // A large radius (300m) with the candidate placed so the POI sits just
    // 10m inside the circle's boundary. Satisfying the standoff by pushing
    // the whole 300m circle past the POI would be a teleport; the drag stops
    // on its own side instead.
    const radiusM = 300;
    const candidate = destinationPoint(poi[0], poi[1], radiusM - 10, 45);
    const clamped = clampOrbitCenterForPoiClearance(candidate, poi, {
      poiCenter: poi,
      radiusM,
      minStandoffM,
      ...closedLoop,
    });

    expect(distFromPoi(clamped)).toBeLessThanOrEqual(
      radiusM - minStandoffM + 1,
    );
  });

  it("does not throw when the candidate lands exactly on the previous center", () => {
    const clamped = clampOrbitCenterForPoiClearance(poi, poi, {
      poiCenter: poi,
      radiusM: 50,
      minStandoffM,
      ...closedLoop,
    });
    expect(Number.isFinite(clamped[0])).toBe(true);
    expect(Number.isFinite(clamped[1])).toBe(true);
  });
});

describe("minStandoffForBuildingPoiClearanceM", () => {
  it("matches minStandoffForFovM for a footprint with negligible width (near-point target)", () => {
    // A tiny footprint has almost no horizontal-fit requirement, so the
    // combined minimum should reduce to the plain vertical one.
    const vertices: [number, number][] = [
      offsetLatLng(CENTER[0], CENTER[1], -0.1, -0.1),
      offsetLatLng(CENTER[0], CENTER[1], -0.1, 0.1),
      offsetLatLng(CENTER[0], CENTER[1], 0.1, 0.1),
      offsetLatLng(CENTER[0], CENTER[1], 0.1, -0.1),
    ];
    const height = 25;
    const vfovDeg = 55;

    const combined = minStandoffForBuildingPoiClearanceM(
      vertices,
      height,
      vfovDeg,
    );
    expect(combined).toBeCloseTo(minStandoffForFovM(height, vfovDeg), 0);
  });

  it("exceeds the vertical-only minimum for an elongated building, whose length needs more standoff than its height does", () => {
    // Same 80x10m elongated footprint used by computeOrbitSeedForBuilding's
    // own arc tests: looking along its long side, 80m of length needs far
    // more standoff to fit inside frame than a 25m roofline ever does.
    const vertices: [number, number][] = [
      offsetLatLng(CENTER[0], CENTER[1], -40, -5),
      offsetLatLng(CENTER[0], CENTER[1], -40, 5),
      offsetLatLng(CENTER[0], CENTER[1], 40, 5),
      offsetLatLng(CENTER[0], CENTER[1], 40, -5),
    ];
    const height = 25;
    const vfovDeg = 55;

    const combined = minStandoffForBuildingPoiClearanceM(
      vertices,
      height,
      vfovDeg,
    );
    expect(combined).toBeGreaterThan(minStandoffForFovM(height, vfovDeg) * 2);
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

    // Only the capture actions are asserted here: an orbit also carries the
    // gimbal/focus actions that aim the camera (see the aiming-actions suite),
    // and those legitimately sit on the same waypoints.
    const captureTypes = (i: number) =>
      result.waypoints[i].actions
        .map((a) => a.actionType)
        .filter((t) => t === "startRecord" || t === "stopRecord");

    expect(captureTypes(0)).toEqual(["startRecord"]);
    expect(captureTypes(result.waypoints.length - 1)).toEqual(["stopRecord"]);
    for (let i = 1; i < result.waypoints.length - 1; i++) {
      expect(captureTypes(i)).toEqual([]);
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
          wp.actions.filter((a) => a.actionType === "takePhoto").length === 1,
      ),
    ).toBe(true);
  });

  it("generateOrbit: no captureMode at all shoots nothing (regression — matches every orbit generated before this field existed; the camera-aiming actions are separate and always present)", () => {
    const { captureMode: _omit, ...legacyParams } = {
      ...DEFAULT_ORBIT_PARAMS,
      center: CENTER,
      radiusM: 50,
      numPoints: 6,
    } satisfies OrbitParams;
    const result = generateOrbit(legacyParams as OrbitParams);

    const CAPTURE = ["takePhoto", "startRecord", "stopRecord"];
    expect(
      result.waypoints.every(
        (wp) => !wp.actions.some((a) => CAPTURE.includes(a.actionType)),
      ),
    ).toBe(true);
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

  it("generateTurbineInspection: heading is smoothTransition and points back toward the hub", () => {
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
      expect(wp.headingMode).toBe("smoothTransition");
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
    const capture = result.waypoints[0].actions.filter(
      (a) => a.actionType === "startRecord" || a.actionType === "stopRecord",
    );
    // Both present, in order, and after the camera setup that now precedes
    // them on the opening waypoint — hence ids are asserted as unique and
    // sequential below rather than as literal 0 and 1.
    expect(capture.map((a) => a.actionType)).toEqual([
      "startRecord",
      "stopRecord",
    ]);
    expect(capture.map((a) => a.params)).toEqual([
      { payloadPositionIndex: 0 },
      { payloadPositionIndex: 0 },
    ]);
    // Ids stay unique and sequential once the camera-aiming actions join
    // them, or Pilot 2 dedupes one of them away.
    const ids = result.waypoints[0].actions.map((a) => a.actionId);
    expect(ids).toEqual(ids.map((_, i) => i));
  });
});

describe("orbit aim height", () => {
  it("aims at the middle of the object when no aim height is set", () => {
    for (const [altitude, objectHeight, radiusM] of [
      [10, 5, 50],
      [52, 40, 60],
      [120, 8, 15],
    ]) {
      expect(
        computeOrbitAimPitch(altitude, objectHeight, radiusM, undefined),
      ).toBe(computeGimbalPitch(altitude, objectHeight / 2, radiusM));
    }
  });

  it("round-trips against the altitude solve, so retyping a shown pitch is a no-op", () => {
    // The defect this guards: the panel displayed one aiming rule (the
    // ground-to-top bisector) and solved with another (aim at a height), so
    // typing back the angle already on screen moved the aircraft — metres of
    // it at a long radius. One rule everywhere, or this stops holding.
    for (const [objectHeight, radiusM, aimHeight] of [
      [20, 215, 10],
      [40, 60, 20],
      [5, 50, 2.5],
    ]) {
      const altitude = 80;
      const shown = computeOrbitAimPitch(
        altitude,
        objectHeight,
        radiusM,
        aimHeight,
      );
      const solved = computeAltitudeForPitch(shown, aimHeight, radiusM);
      expect(
        computeOrbitAimPitch(solved, objectHeight, radiusM, aimHeight),
      ).toBe(shown);
    }
  });

  it("points exactly at the aim height when one is set", () => {
    // 10 m above the aim point, 10 m out = 45 degrees down.
    expect(computeOrbitAimPitch(20, 20, 10, 10)).toBe(-45);
    // Aiming at the roof of the same object is shallower than aiming halfway.
    expect(computeOrbitAimPitch(30, 20, 40, 20)).toBe(-14);
    expect(computeOrbitAimPitch(30, 20, 40, 10)).toBe(-27);
  });

  it("seeds a building orbit's aim height at half the building's height", () => {
    const params = orbitParamsForBuilding({
      vertices: [
        [41.25, 0.93],
        [41.2502, 0.93],
        [41.2502, 0.9302],
        [41.25, 0.9302],
      ],
      height: 20,
    });
    expect(params.poiHeight).toBe(20);
    expect(params.aimHeight).toBe(10);
  });

  it("aims a locked POI at the aim height even for a building orbit", () => {
    // Previously a locked POI on a building used the ground-to-roof bisector
    // instead of the requested point; with an explicit aim height the
    // building/non-building split goes away.
    const result = generateOrbit({
      ...DEFAULT_ORBIT_PARAMS,
      center: [41.25, 0.93],
      radiusM: 40,
      altitude: 30,
      poiHeight: 20,
      aimHeight: 10,
      poiCenter: [41.25, 0.93],
      buildingVertices: [
        [41.25, 0.93],
        [41.2502, 0.93],
        [41.2502, 0.9302],
      ],
    } satisfies OrbitParams);

    for (const wp of result.waypoints) {
      expect(wp.gimbalPitchAngle).toBe(computeOrbitAimPitch(30, 20, 40, 10));
    }
  });

  it("puts a created POI at the aim height, not the object's full height", () => {
    const result = generateOrbit({
      ...DEFAULT_ORBIT_PARAMS,
      center: [41.25, 0.93],
      radiusM: 40,
      poiHeight: 20,
      aimHeight: 10,
      createPoi: true,
    } satisfies OrbitParams);

    expect(result.pois[0].height).toBe(10);
  });
});

describe("computeRadiusForPitch", () => {
  it("solves the radius that puts the aim point at the requested pitch", () => {
    // 20 m above the aim point at -45 degrees means 20 m out.
    expect(computeRadiusForPitch(-45, 30, 10)).toBe(20);
  });

  it("round-trips with computeOrbitAimPitch", () => {
    for (const pitch of [-10, -30, -45, -60, -80]) {
      const radiusM = computeRadiusForPitch(pitch, 60, 10);
      expect(computeOrbitAimPitch(60, 20, radiusM, 10)).toBe(pitch);
    }
  });

  it("clamps instead of diverging when the camera is at or below the aim point", () => {
    expect(computeRadiusForPitch(-30, 10, 10)).toBe(2000);
    expect(computeRadiusForPitch(-30, 5, 20)).toBe(2000);
  });

  it("clamps a level or upward pitch to the maximum radius", () => {
    expect(computeRadiusForPitch(0, 50, 10)).toBe(2000);
    expect(computeRadiusForPitch(15, 50, 10)).toBe(2000);
  });

  it("never returns a radius below the minimum", () => {
    expect(computeRadiusForPitch(-89, 500, 0)).toBeGreaterThanOrEqual(5);
  });
});

describe("objectFitsInFrame", () => {
  it("fits when framed for the radius and aimed at the middle", () => {
    const framed = computeFramedForRadius(40, 20, DEFAULT_WIDE_VFOV_DEG);
    expect(framed).not.toBeNull();
    expect(
      objectFitsInFrame(framed!.altitude, 20, 40, DEFAULT_WIDE_VFOV_DEG, 10),
    ).toBe(true);
  });

  it("still fits when aimed at the roof instead of the middle", () => {
    // The framing solve targets half the vertical FOV, so shifting the aim
    // by half the object's angular span still leaves it inside the frame.
    const framed = computeFramedForRadius(40, 20, DEFAULT_WIDE_VFOV_DEG);
    expect(
      objectFitsInFrame(framed!.altitude, 20, 40, DEFAULT_WIDE_VFOV_DEG, 20),
    ).toBe(true);
  });

  it("reports a miss when the object is far too tall for the frame", () => {
    // 60 m of building seen from 8 m away cannot fit in a 63 degree FOV.
    expect(objectFitsInFrame(30, 60, 8, DEFAULT_WIDE_VFOV_DEG, 30)).toBe(false);
  });
});

describe("gimbal pitch bounds", () => {
  it("never derives a pitch outside the range the panel offers", () => {
    // Flying below the aim point (a 60m subject aimed at 30m, from 19m up
    // and 10m out) wants roughly +48 degrees — past the +45 the field
    // itself declares, and past what the aircraft would accept in WPML.
    expect(computeOrbitAimPitch(19, 60, 10, 30)).toBe(MAX_GIMBAL_PITCH_DEG);
    expect(computeOrbitAimPitch(19, 60, 10, 30)).toBeLessThanOrEqual(
      MAX_GIMBAL_PITCH_DEG,
    );
    expect(computeOrbitAimPitch(400, 5, 1, 0)).toBeGreaterThanOrEqual(
      MIN_GIMBAL_PITCH_DEG,
    );
  });

  it("reports when the aim can no longer be met", () => {
    expect(aimPitchOutOfRange(19, 60, 10, 30)).toBe(true);
    // A normal look-down orbit is well inside the range.
    expect(aimPitchOutOfRange(50, 20, 40, 10)).toBe(false);
  });
});

describe("fit ranges", () => {
  const VFOV = 56.8;

  it("radius: fits from a minimum outward, no upper bound", () => {
    // 60m building aimed at its middle, flying at 40m: needs ~59m of standoff
    // (measured by scanning objectFitsInFrame), then fits forever after —
    // farther away always makes the object smaller.
    const r = fitRadiusRange(40, 60, VFOV, 30, 120)!;
    expect(r.fitsFrom).toBeGreaterThanOrEqual(58);
    expect(r.fitsFrom).toBeLessThanOrEqual(60);
    expect(r.fitsTo).toBeNull();
    // Just inside/outside the boundary must agree with the fit check.
    expect(objectFitsInFrame(40, 60, r.fitsFrom, VFOV, 30)).toBe(true);
    expect(objectFitsInFrame(40, 60, r.fitsFrom - 2, VFOV, 30)).toBe(false);
  });

  it("radius: already fits at any distance when flying comfortably above", () => {
    const r = fitRadiusRange(80, 60, VFOV, 30, 120)!;
    expect(r.fitsFrom).toBeLessThanOrEqual(1);
    expect(r.fitsTo).toBeNull();
  });

  it("radius: the ideal band sits around the oblique hump, not at the overhead sliver", () => {
    // Flying at 80m over a 60m building, the object's share of the frame is
    // NOT monotone in radius: ~6% from directly overhead, peaking ~87% near
    // 40m out, then shrinking with distance. The ideal 35–65% band therefore
    // lives on the far side of that hump (roughly 75–160m), and a solver
    // that bisects from the near edge lands on a one-metre sliver at r=1
    // instead. Verified by hand against the sampled curve.
    const r = fitRadiusRange(80, 60, VFOV, 30, 120)!;
    expect(r.idealFrom).toBeGreaterThan(60);
    expect(r.idealFrom).toBeLessThan(90);
    expect(r.idealTo).toBeGreaterThan(140);
    expect(r.idealTo).toBeLessThan(180);
    // And the user's current 120m is inside it — the framing they got.
    expect(120).toBeGreaterThanOrEqual(r.idealFrom);
    expect(120).toBeLessThanOrEqual(r.idealTo);
  });

  it("altitude: a tight radius needs a minimum altitude, then fits forever", () => {
    // 60m building from only 30m out: needs ~77m altitude.
    const a = fitAltitudeRange(30, 60, VFOV, 30, 100)!;
    expect(a.fitsFrom).toBeGreaterThanOrEqual(76);
    expect(a.fitsFrom).toBeLessThanOrEqual(78);
    expect(a.fitsTo).toBeNull();
    expect(objectFitsInFrame(a.fitsFrom, 60, 30, VFOV, 30)).toBe(true);
    expect(objectFitsInFrame(a.fitsFrom - 2, 60, 30, VFOV, 30)).toBe(false);
  });

  it("altitude: fits at any altitude when the radius is generous", () => {
    const a = fitAltitudeRange(120, 60, VFOV, 30, 48)!;
    expect(a.fitsFrom).toBeLessThanOrEqual(1);
    expect(a.fitsTo).toBeNull();
  });

  it("ideal band brackets the framing target and is ordered", () => {
    // The framing solve targets 50% of the FOV; the ideal band is 35–65%,
    // so a freshly framed orbit must sit inside it.
    const framed = computeFramedForRadius(120, 60, VFOV, undefined, 30)!;
    const r = fitRadiusRange(framed.altitude, 60, VFOV, 30, 120)!;
    expect(r.idealFrom).toBeLessThan(r.idealTo);
    expect(120).toBeGreaterThanOrEqual(r.idealFrom);
    expect(120).toBeLessThanOrEqual(r.idealTo);

    const a = fitAltitudeRange(120, 60, VFOV, 30, framed.altitude)!;
    expect(a.idealFrom).toBeLessThan(a.idealTo);
    expect(framed.altitude).toBeGreaterThanOrEqual(a.idealFrom);
    expect(framed.altitude).toBeLessThanOrEqual(a.idealTo);
  });

  it("ideal band never reaches outside the fitting range", () => {
    for (const [alt, obj, aim] of [
      [40, 60, 30],
      [80, 60, 60],
      [15, 20, 10],
      [200, 60, 30],
    ]) {
      const r = fitRadiusRange(alt, obj, VFOV, aim, 100)!;
      expect(r.idealFrom).toBeGreaterThanOrEqual(r.fitsFrom);
      if (r.fitsTo !== null) expect(r.idealTo).toBeLessThanOrEqual(r.fitsTo);
    }
  });

  it("returns null ranges when there is no object to frame", () => {
    expect(fitRadiusRange(50, 0, VFOV, 0)).toBeNull();
    expect(fitAltitudeRange(50, 0, VFOV, 0)).toBeNull();
  });
});

describe("target-facing templates use a heading mode the aircraft honours", () => {
  // DJI WPML: "fixed" means "keep the yaw the aircraft had leaving the
  // previous waypoint after its action" — waypointHeadingAngle is IGNORED in
  // that mode and only read for "smoothTransition". Emitting fixed + a bearing
  // therefore did nothing on the aircraft: it flew the whole orbit with its
  // nose wherever it happened to point on arrival at waypoint 1 (observed on
  // an M4T). smoothTransition is the mode whose contract is "yaw to this
  // angle at the waypoint, transition evenly to the next" — supported on
  // every model in the spec, and it is what a hand-planned Pilot 2 route
  // with per-waypoint headings writes.
  it("orbit: every waypoint faces the centre via smoothTransition", () => {
    const result = generateOrbit({
      ...DEFAULT_ORBIT_PARAMS,
      center: [41.25, 0.93],
      radiusM: 50,
      numPoints: 8,
    } satisfies OrbitParams);
    for (const wp of result.waypoints) {
      expect(wp.headingMode).toBe("smoothTransition");
      expect(wp.useGlobalHeadingParam).toBe(false);
      const expected = bearing(wp.latitude, wp.longitude, 41.25, 0.93);
      const normalized = expected > 180 ? expected - 360 : expected;
      expect(wp.headingAngle).toBe(Math.round(normalized));
    }
  });

  it("facade: every waypoint faces the wall via smoothTransition", () => {
    const result = generateFacade({
      ...DEFAULT_FACADE_PARAMS,
      point1: [41.25, 0.93],
      point2: [41.25, 0.931],
    } satisfies FacadeParams);
    expect(result.waypoints.length).toBeGreaterThan(0);
    for (const wp of result.waypoints) {
      expect(wp.headingMode).toBe("smoothTransition");
      expect(typeof wp.headingAngle).toBe("number");
    }
  });
});

describe("orbit cinema mode", () => {
  it("caps every waypoint at CINEMA_SPEED_MPS while still recording start-to-finish", () => {
    const result = generateOrbit({
      ...DEFAULT_ORBIT_PARAMS,
      center: [41.25, 0.93],
      radiusM: 50,
      numPoints: 6,
      captureMode: "video",
      cinema: true,
    } satisfies OrbitParams);

    for (const wp of result.waypoints) {
      expect(wp.speed).toBe(CINEMA_SPEED_MPS);
      expect(wp.useGlobalSpeed).toBe(false);
    }
    expect(CINEMA_SPEED_MPS).toBeLessThanOrEqual(3);
    // Still a continuous video: one startRecord at the first waypoint, one
    // stopRecord at the last, nothing in between. (Camera-aiming actions sit
    // alongside them and are asserted in their own suite.)
    const captureTypes = (i: number) =>
      result.waypoints[i].actions
        .map((a) => a.actionType)
        .filter((t) => t === "startRecord" || t === "stopRecord");
    expect(captureTypes(0)).toEqual(["startRecord"]);
    expect(captureTypes(result.waypoints.length - 1)).toEqual(["stopRecord"]);
    for (let i = 1; i < result.waypoints.length - 1; i++) {
      expect(captureTypes(i)).toEqual([]);
    }
  });

  it("leaves the normal orbit speed alone when cinema is off", () => {
    const result = generateOrbit({
      ...DEFAULT_ORBIT_PARAMS,
      center: [41.25, 0.93],
      radiusM: 50,
      captureMode: "video",
    } satisfies OrbitParams);
    for (const wp of result.waypoints) {
      expect(wp.speed).toBeGreaterThan(CINEMA_SPEED_MPS);
    }
  });
});

describe("orbit POI height matches where the gimbal aims", () => {
  // The POI written into the file (waypointPoiPoint) is what the aircraft
  // actually tracks; the per-waypoint gimbal pitch is computed for the same
  // aim height. If they disagree — POI at the roof, pitch aimed at the middle
  // — the two mechanisms fight and the flown result aims at the roof.
  // Field-observed on a Matrice 4T: an orbit with a locked POI and object
  // height 9 wrote poi height 9 and pitch -38 (roof), where the middle would
  // be 4.5 / -48.
  it("puts the created POI at the middle of the object when no aim height is set", () => {
    const r = generateOrbit({
      ...DEFAULT_ORBIT_PARAMS,
      center: [49.8261, 15.08897],
      radiusM: 17,
      altitude: 20,
      poiHeight: 9,
      poiCenter: [49.82599, 15.08924],
      createPoi: true,
    } satisfies OrbitParams);
    expect(r.pois[0].height).toBe(4.5);
  });

  it("puts the created POI exactly at an explicit aim height", () => {
    const r = generateOrbit({
      ...DEFAULT_ORBIT_PARAMS,
      center: [49.8261, 15.08897],
      radiusM: 17,
      altitude: 20,
      poiHeight: 9,
      aimHeight: 9,
      poiCenter: [49.82599, 15.08924],
      createPoi: true,
    } satisfies OrbitParams);
    expect(r.pois[0].height).toBe(9);
  });

  it("POI height and per-waypoint pitch agree on the aim point for a locked POI", () => {
    const r = generateOrbit({
      ...DEFAULT_ORBIT_PARAMS,
      center: [49.8261, 15.08897],
      radiusM: 17,
      altitude: 20,
      poiHeight: 9,
      poiCenter: [49.82599, 15.08924],
      createPoi: true,
    } satisfies OrbitParams);
    const poi = r.pois[0];
    for (const wp of r.waypoints) {
      const d = haversineDistance(
        wp.latitude,
        wp.longitude,
        poi.latitude,
        poi.longitude,
      );
      const expected = computeGimbalPitch(wp.height, poi.height, d);
      expect(wp.gimbalPitchAngle).toBe(expected);
    }
  });
});

describe("poiDistanceSwing — how much a locked POI's apparent size changes over the flown arc", () => {
  // Replaces the hard "max offset" clamp: an arc that starts and ends just
  // short of the subject and swings round its far side is a legitimate
  // composition, and its near/far ratio is inherently well above the old
  // 1.6 cap. Rather than forbid the drag, measure the swing on the waypoints
  // actually flown and let the panel say what it means.
  const CENTER_: [number, number] = [49.8261, 15.08897];
  it("is 1.0 when the POI is at the centre of a full circle", () => {
    const s = poiDistanceSwing(CENTER_, CENTER_, 26, 0, 360, 12);
    expect(s.ratio).toBeCloseTo(1, 3);
    expect(s.nearM).toBeCloseTo(26, 0);
    expect(s.farM).toBeCloseTo(26, 0);
  });
  it("only counts flown waypoints: an arc whose gap faces the POI reports a far larger near distance than the circle's own nearest point", () => {
    // POI 20 m from centre toward bearing 0; arc 45..315 leaves the gap at 0.
    const poi = destinationPoint(CENTER_[0], CENTER_[1], 20, 0);
    const full = poiDistanceSwing(CENTER_, poi, 26, 0, 360, 12);
    const arc = poiDistanceSwing(CENTER_, poi, 26, 45, 315, 12);
    expect(full.nearM).toBeLessThan(8); // circle passes ~6 m from the POI
    expect(arc.nearM).toBeGreaterThan(15); // nearest FLOWN point is an endpoint, ~18 m
    expect(arc.ratio).toBeLessThan(full.ratio);
  });
  it("uses the actual waypoint count, so a coarse arc's endpoints are what count", () => {
    const poi = destinationPoint(CENTER_[0], CENTER_[1], 20, 0);
    const a12 = poiDistanceSwing(CENTER_, poi, 26, 45, 315, 12);
    const a4 = poiDistanceSwing(CENTER_, poi, 26, 45, 315, 4);
    // both start/end at the same bearings, so nearest is identical
    expect(a4.nearM).toBeCloseTo(a12.nearM, 3);
  });
});

describe("orbitStandoffViolation — guards the nearest FLOWN waypoint, not the radius", () => {
  const VFOV = 56.8;
  const center: [number, number] = [49.826099451597734, 15.088971112134274];
  // The user's own case: locked POI 23 m from the centre, radius 17, full
  // circle -> waypoint 12 passes 5.9 m from the cottage and flies over it.
  // The old check compared the RADIUS (17 m) against the minimum and passed.
  const poi: [number, number] = [49.82599267824013, 15.089243863310132];

  it("catches a waypoint that comes closer than the object needs, even though the radius looks fine", () => {
    const v = orbitStandoffViolation(
      {
        center,
        poiCenter: poi,
        radiusM: 17,
        startAngleDeg: 0,
        endAngleDeg: 360,
        numPoints: 12,
        poiHeight: 9,
      },
      VFOV,
    );
    expect(v).not.toBeNull();
    expect(v!.nearestM).toBeCloseTo(5.9, 0);
    expect(v!.requiredM).toBeGreaterThan(v!.nearestM);
    // 1-based waypoint number, so it reads like the panel's own labels
    expect(v!.waypointNumber).toBeGreaterThanOrEqual(1);
    expect(v!.waypointNumber).toBeLessThanOrEqual(12);
  });

  it("is null when every flown waypoint keeps its distance", () => {
    expect(
      orbitStandoffViolation(
        {
          center,
          poiCenter: poi,
          radiusM: 60,
          startAngleDeg: 0,
          endAngleDeg: 360,
          numPoints: 12,
          poiHeight: 9,
        },
        VFOV,
      ),
    ).toBeNull();
  });

  it("judges an open arc on its flown points: the same geometry passes once the gap faces the POI", () => {
    // Circle's own nearest point is still 5.9 m away, but that bearing is
    // never flown when the arc's gap faces the POI.
    const bad = orbitStandoffViolation(
      {
        center,
        poiCenter: poi,
        radiusM: 17,
        startAngleDeg: 0,
        endAngleDeg: 360,
        numPoints: 12,
        poiHeight: 9,
      },
      VFOV,
    );
    const good = orbitStandoffViolation(
      {
        center,
        poiCenter: poi,
        radiusM: 17,
        startAngleDeg: 200,
        endAngleDeg: 200 + 240,
        numPoints: 12,
        poiHeight: 9,
      },
      VFOV,
    );
    expect(bad).not.toBeNull();
    expect(good).toBeNull();
  });

  it("does NOT block on a building's width — that is advice, not a limit", () => {
    // A long building cannot fit end-to-end up close; demanding it as a hard
    // minimum forbade every close orbit of one and pinned the centre handle.
    // See buildingLengthShortfall for the advisory that replaced it.
    const wide: [number, number][] = [
      destinationPoint(poi[0], poi[1], 35, 90),
      destinationPoint(poi[0], poi[1], 35, 270),
      destinationPoint(poi[0], poi[1], 4, 0),
    ];
    expect(
      orbitStandoffViolation(
        {
          center: poi,
          poiCenter: poi,
          radiusM: 20,
          startAngleDeg: 0,
          endAngleDeg: 360,
          numPoints: 12,
          poiHeight: 9,
          buildingVertices: wide,
        },
        VFOV,
      ),
    ).toBeNull();
  });

  it("is null when there is no locked POI or no object to frame", () => {
    expect(
      orbitStandoffViolation(
        {
          center,
          radiusM: 5,
          startAngleDeg: 0,
          endAngleDeg: 360,
          numPoints: 12,
          poiHeight: 9,
        },
        VFOV,
      ),
    ).toBeNull();
    expect(
      orbitStandoffViolation(
        {
          center,
          poiCenter: poi,
          radiusM: 1,
          startAngleDeg: 0,
          endAngleDeg: 360,
          numPoints: 12,
          poiHeight: 0,
        },
        VFOV,
      ),
    ).toBeNull();
  });
});

describe("standoff guard blocks only what is objectively broken", () => {
  const VFOV = 56.8;
  const c: [number, number] = [49.8, 15.0];
  /** ~70 x 18 m hall, 10 m tall — the reported case. */
  const hall: [number, number][] = [
    destinationPoint(c[0], c[1], 35, 0),
    destinationPoint(c[0], c[1], 35, 180),
    destinationPoint(
      destinationPoint(c[0], c[1], 35, 180)[0],
      destinationPoint(c[0], c[1], 35, 180)[1],
      18,
      90,
    ),
    destinationPoint(
      destinationPoint(c[0], c[1], 35, 0)[0],
      destinationPoint(c[0], c[1], 35, 0)[1],
      18,
      90,
    ),
  ];

  it("a close orbit around a long hall is allowed: fitting its whole LENGTH is impossible up close and must not block", () => {
    // Height rule wants ~10.5 m; the building's length wants ~57 m. Orbiting
    // at 28 m is a real, useful shot — the subject simply doesn't fit
    // end-to-end, which is what the advisory below is for.
    expect(
      orbitStandoffViolation(
        {
          center: c,
          poiCenter: c,
          radiusM: 28,
          startAngleDeg: 0,
          endAngleDeg: 360,
          numPoints: 12,
          poiHeight: 10,
          buildingVertices: hall,
        },
        VFOV,
      ),
    ).toBeNull();
  });

  it("still blocks a waypoint that is too close for the object's own HEIGHT (the reported fly-over)", () => {
    const v = orbitStandoffViolation(
      {
        center: c,
        poiCenter: c,
        radiusM: 6,
        startAngleDeg: 0,
        endAngleDeg: 360,
        numPoints: 12,
        poiHeight: 10,
        buildingVertices: hall,
      },
      VFOV,
    );
    expect(v).not.toBeNull();
    expect(v!.requiredM).toBeCloseTo(minStandoffForFovM(10, VFOV), 1);
  });

  it("orbitMinStandoffM is the height requirement, not the building's width", () => {
    expect(orbitMinStandoffM(10, VFOV)).toBeCloseTo(
      minStandoffForFovM(10, VFOV),
      6,
    );
  });

  it("reports the building-length shortfall as advice, with the distance that would fit it", () => {
    const advice = buildingLengthShortfall(
      {
        center: c,
        poiCenter: c,
        radiusM: 28,
        startAngleDeg: 0,
        endAngleDeg: 360,
        numPoints: 12,
        poiHeight: 10,
        buildingVertices: hall,
      },
      VFOV,
    );
    expect(advice).not.toBeNull();
    expect(advice!.requiredM).toBeGreaterThan(50);
    expect(advice!.nearestM).toBeCloseTo(28, 0);
  });

  it("no advice once the orbit is far enough for the whole building", () => {
    expect(
      buildingLengthShortfall(
        {
          center: c,
          poiCenter: c,
          radiusM: 90,
          startAngleDeg: 0,
          endAngleDeg: 360,
          numPoints: 12,
          poiHeight: 10,
          buildingVertices: hall,
        },
        VFOV,
      ),
    ).toBeNull();
  });

  it("no advice without a building outline — a bare POI has no length to fit", () => {
    expect(
      buildingLengthShortfall(
        {
          center: c,
          poiCenter: c,
          radiusM: 12,
          startAngleDeg: 0,
          endAngleDeg: 360,
          numPoints: 12,
          poiHeight: 10,
        },
        VFOV,
      ),
    ).toBeNull();
  });
});

describe("centre drag is judged on the waypoints actually flown", () => {
  const POI: [number, number] = [50.06, 14.43];
  const radiusM = 89;
  const minStandoffM = orbitMinStandoffM(50, DEFAULT_WIDE_VFOV_DEG);

  // A 270 degree arc whose 90 degree gap faces the POI — the composition the
  // user asked for: start and end just short of the building, swing round its
  // far side. The circle's own closest point lies inside that gap and is
  // never visited.
  const ARC = { startAngleDeg: 15.75, endAngleDeg: 285.75, numPoints: 12 };

  // Bearing from the POI that puts the POI in the middle of the arc's gap as
  // seen from the centre, i.e. the "start and end in front of the building"
  // layout. The opposite bearing points the gap away and drags a waypoint
  // straight at the POI.
  const GAP_SIDE = 150.75;
  const FLOWN_SIDE = 330.75;

  const at = (m: number, bearingDeg = GAP_SIDE) =>
    destinationPoint(POI[0], POI[1], m, bearingDeg);
  const offsetOf = (p: [number, number]) =>
    haversineDistance(POI[0], POI[1], p[0], p[1]);
  const clamp = (candidate: [number, number], previous: [number, number]) =>
    clampOrbitCenterForPoiClearance(candidate, previous, {
      poiCenter: POI,
      radiusM,
      minStandoffM,
      ...ARC,
    });

  it("allows an offset centre the flown waypoints clear, even where the full circle would not", () => {
    // 60 m off the POI puts the circle's nearest point 29 m away — under the
    // ~52 m minimum — so the old whole-circle clamp refused to move at all.
    // But that point sits in the arc's gap: the nearest FLOWN waypoint is
    // well clear, which is what the panel itself reports and what actually
    // matters for the shot.
    const candidate = at(60);
    const { nearM } = poiDistanceSwing(
      candidate,
      POI,
      radiusM,
      ARC.startAngleDeg,
      ARC.endAngleDeg,
      ARC.numPoints,
    );
    expect(nearM).toBeGreaterThan(minStandoffM);
    expect(Math.abs(offsetOf(candidate) - radiusM)).toBeLessThan(minStandoffM);

    expect(offsetOf(clamp(candidate, at(10)))).toBeCloseTo(60, 0);
  });

  it("still stops a drag that would fly a waypoint too close", () => {
    // Same arc, dragged the other way: now a flown waypoint closes in on the
    // POI and the drag must stop before it does.
    const previous = at(10);
    const candidate = at(radiusM, FLOWN_SIDE);
    const clamped = clamp(candidate, previous);
    const { nearM } = poiDistanceSwing(
      clamped,
      POI,
      radiusM,
      ARC.startAngleDeg,
      ARC.endAngleDeg,
      ARC.numPoints,
    );
    expect(nearM).toBeGreaterThanOrEqual(minStandoffM - 0.5);
    expect(offsetOf(clamped)).toBeLessThan(offsetOf(candidate));
  });

  it("never jumps: the clamped centre always lies between the old and the new one", () => {
    const previous = at(10);
    for (const d of [40, 80, 120, 160, 200]) {
      const candidate = at(d, FLOWN_SIDE);
      const clamped = clamp(candidate, previous);
      // On the segment means: no farther from the previous centre than the
      // candidate is. A teleport to the far side of the POI would break this.
      expect(
        haversineDistance(previous[0], previous[1], clamped[0], clamped[1]),
      ).toBeLessThanOrEqual(
        haversineDistance(
          previous[0],
          previous[1],
          candidate[0],
          candidate[1],
        ) + 0.5,
      );
    }
  });

  it("leaves a closed 360 degree orbit judged on the whole circle", () => {
    // No gap to hide in: every point of the circle is flown, so a centre that
    // brings the ring within the minimum must still be stopped.
    const previous = at(5);
    const candidate = at(radiusM - minStandoffM + 25);
    const clamped = clampOrbitCenterForPoiClearance(candidate, previous, {
      poiCenter: POI,
      radiusM,
      minStandoffM,
      startAngleDeg: 0,
      endAngleDeg: 360,
      numPoints: 36,
    });
    expect(offsetOf(clamped)).toBeLessThan(radiusM - minStandoffM + 3);
  });

  it("does not trap a centre that is already too close — it can be dragged back out", () => {
    // Radius or waypoint count changed underneath an existing orbit and left
    // it violating. The panel's guard blocks Apply; the handle must still
    // move, or there is no way to fix it.
    const stuck = at(radiusM, FLOWN_SIDE);
    const target = at(5);
    expect(offsetOf(clamp(target, stuck))).toBeCloseTo(5, 0);
  });
});

describe("radiusForNearestStandoffM", () => {
  const POI: [number, number] = [50.06, 14.43];
  const ARC = { startAngleDeg: 16.98, endAngleDeg: 286.98, numPoints: 72 };
  // Centre offset from the POI, the "start and end in front of the building"
  // layout — this is exactly the case where the radius and the distance to
  // the subject are NOT the same number.
  const center = destinationPoint(POI[0], POI[1], 47, 150.75);
  const nearestFor = (radiusM: number) =>
    poiDistanceSwing(
      center,
      POI,
      radiusM,
      ARC.startAngleDeg,
      ARC.endAngleDeg,
      ARC.numPoints,
    ).nearM;

  it("returns the radius that puts the nearest flown waypoint at the required distance", () => {
    const requiredM = 118;
    const radius = radiusForNearestStandoffM(
      { center, poiCenter: POI, ...ARC },
      requiredM,
      100,
    );
    expect(radius).not.toBeNull();
    expect(nearestFor(radius!)).toBeGreaterThanOrEqual(requiredM);
    // And it is the SMALLEST such radius — a metre less no longer clears.
    expect(nearestFor(radius! - 1)).toBeLessThan(requiredM);
  });

  it("is larger than the required distance itself when the centre is offset", () => {
    // The whole point of the helper: with the POI 47 m off-centre, typing the
    // required distance into the radius field leaves the near side of the arc
    // far too close.
    const requiredM = 118;
    const radius = radiusForNearestStandoffM(
      { center, poiCenter: POI, ...ARC },
      requiredM,
      100,
    );
    expect(radius!).toBeGreaterThan(requiredM);
    expect(nearestFor(requiredM)).toBeLessThan(requiredM);
  });

  it("equals the required distance for a centred POI, where radius IS the distance", () => {
    const radius = radiusForNearestStandoffM(
      { center: POI, poiCenter: POI, ...ARC },
      118,
      100,
    );
    expect(radius!).toBeCloseTo(118, 0);
  });

  it("returns null when the current radius already clears the requirement", () => {
    expect(
      radiusForNearestStandoffM({ center, poiCenter: POI, ...ARC }, 50, 200),
    ).toBeNull();
  });
});

describe("orbit drives the gimbal and focuses, the way the field tests settled it", () => {
  // Flight-verified on a Matrice 4T. Two variants of the same orbit, flown
  // back to back:
  //
  //   C1 — per-waypoint gimbalPitchAngle only, gimbalPitchMode
  //        usePointSetting, no gimbal actions. Result: the aircraft turned to
  //        the POI correctly but the gimbal stayed put ("zůstal na 6
  //        stupních, nemířil vůbec dolů") and the shot was never in focus.
  //   C9 — same, plus gimbalRotate on the first waypoint, gimbalEvenlyRotate
  //        toward the next waypoint's pitch on every leg, and a focus action
  //        once the aircraft has turned to the POI. Result: correct aim,
  //        correct gimbal, in focus.
  //
  // The pitch numbers alone are not enough — these actions are what actually
  // moves the gimbal.
  const params: OrbitParams = {
    ...DEFAULT_ORBIT_PARAMS,
    center: CENTER,
    radiusM: 100,
    numPoints: 12,
    altitude: 40,
    poiHeight: 50,
    aimHeight: 25,
    poiCenter: destinationPoint(CENTER[0], CENTER[1], 40, 90),
    startAngleDeg: 17,
    endAngleDeg: 287,
    captureMode: "video",
  };
  const typesAt = (
    wps: ReturnType<typeof generateOrbit>["waypoints"],
    i: number,
  ) => wps[i].actions.map((a) => a.actionType);

  it("sets the starting gimbal angle on the first waypoint", () => {
    const { waypoints } = generateOrbit(params);
    expect(typesAt(waypoints, 0)).toContain("gimbalRotate");
    const rotate = waypoints[0].actions.find(
      (a) => a.actionType === "gimbalRotate",
    )!;
    expect(
      (rotate.params as { gimbalPitchRotateAngle: number })
        .gimbalPitchRotateAngle,
    ).toBe(waypoints[0].gimbalPitchAngle);
  });

  it("walks the gimbal to the next waypoint's pitch on every leg but the last", () => {
    const { waypoints } = generateOrbit(params);
    for (let i = 0; i < waypoints.length - 1; i++) {
      const evenly = waypoints[i].actions.find(
        (a) => a.actionType === "gimbalEvenlyRotate",
      );
      expect(evenly, `waypoint ${i} should walk the gimbal`).toBeDefined();
      expect(
        (evenly!.params as { gimbalPitchRotateAngle: number })
          .gimbalPitchRotateAngle,
      ).toBe(waypoints[i + 1].gimbalPitchAngle);
    }
    // Nothing to interpolate toward past the end.
    expect(typesAt(waypoints, waypoints.length - 1)).not.toContain(
      "gimbalEvenlyRotate",
    );
  });

  it("aims, settles and focuses on the FIRST waypoint, before anything starts shooting", () => {
    // The shot has to be sharp from its very first frame. Focusing on
    // arrival used to lock onto whatever the aircraft saw on the way in —
    // it lands at the start point still carrying its transit heading and
    // only then swings toward the POI ("kamera zaostří při doletění na start
    // point, ale při otočení na POI už ne"). The settle is what fixes that:
    // gimbal to the leg's angle, hold while the turn and the gimbal finish,
    // focus, and only then record. The pause is before startRecord, so it is
    // not in the footage.
    const { waypoints } = generateOrbit(params);
    const types = typesAt(waypoints, 0);
    expect(types).toContain("focus");
    expect(types.indexOf("gimbalRotate")).toBeLessThan(types.indexOf("hover"));
    expect(types.indexOf("hover")).toBeLessThan(types.indexOf("focus"));
    expect(types.indexOf("focus")).toBeLessThan(types.indexOf("startRecord"));

    const hover = waypoints[0].actions.find((a) => a.actionType === "hover")!;
    expect(hover.params).toMatchObject({ hoverTime: CAMERA_SETTLE_SECONDS });
    expect(CAMERA_SETTLE_SECONDS).toBeGreaterThanOrEqual(3);
    // Nothing left behind on the second waypoint to re-focus mid-shot.
    expect(typesAt(waypoints, 1)).not.toContain("focus");
    expect(typesAt(waypoints, 1)).not.toContain("hover");

    const focus = waypoints[0].actions.find((a) => a.actionType === "focus")!;
    expect(focus.params).toMatchObject({
      isPointFocus: true,
      focusX: 0.5,
      focusY: 0.5,
      isInfiniteFocus: false,
    });
  });

  it("keeps recording and photo actions alongside the aiming ones", () => {
    const video = generateOrbit(params);
    expect(typesAt(video.waypoints, 0)).toContain("startRecord");
    expect(typesAt(video.waypoints, video.waypoints.length - 1)).toContain(
      "stopRecord",
    );

    const photo = generateOrbit({ ...params, captureMode: "photo" });
    expect(typesAt(photo.waypoints, 0)).toContain("takePhoto");
    expect(typesAt(photo.waypoints, 0)).toContain("gimbalRotate");
  });

  it("gives every action on a waypoint its own id", () => {
    // Duplicated actionIds inside one waypoint are what Pilot 2 dedupes
    // against — two actions sharing an id is a silently dropped action.
    for (const wp of generateOrbit(params).waypoints) {
      const ids = wp.actions.map((a) => a.actionId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("does not aim the gimbal for an orbit with no locked target and a flat pitch", () => {
    // A plain circular orbit around its own centre holds one pitch the whole
    // way; walking the gimbal toward an identical angle every leg is noise in
    // the file. The starting angle is still set.
    const flat = generateOrbit({
      ...params,
      poiCenter: undefined,
      gimbalPitchDeg: -30,
    });
    expect(typesAt(flat.waypoints, 0)).toContain("gimbalRotate");
    expect(
      flat.waypoints.some((wp) =>
        wp.actions.some((a) => a.actionType === "gimbalEvenlyRotate"),
      ),
    ).toBe(false);
  });
});

describe("an orbit's opening gimbal command never touches yaw", () => {
  it("omits the yaw enable, so the gimbal keeps following the aircraft onto the target", () => {
    // The aircraft yaws toward the POI for the whole orbit. A gimbal yaw
    // command is absolute (relative to north), so enabling it pins the camera
    // to one compass direction and the subject slides out of frame after the
    // first waypoint — field-observed over the Congress Centre.
    const { waypoints } = generateOrbit({
      ...DEFAULT_ORBIT_PARAMS,
      center: CENTER,
      radiusM: 100,
      numPoints: 8,
      altitude: 60,
      poiHeight: 50,
      aimHeight: 25,
      poiCenter: destinationPoint(CENTER[0], CENTER[1], 40, 90),
      startAngleDeg: 17,
      endAngleDeg: 287,
      captureMode: "video",
    } as OrbitParams);

    const rotate = waypoints[0].actions.find(
      (a) => a.actionType === "gimbalRotate",
    )!;
    const params = rotate.params as unknown as Record<string, unknown>;
    expect(params.gimbalYawRotateEnable).toBeFalsy();
    expect(params).toHaveProperty("gimbalPitchRotateAngle");
  });
});

describe("oval geometry: distance held from the target", () => {
  // The shape's one number is the distance from the CAMERA TARGET that the
  // middle of the arc holds — not a radius from the orbit's own centre.
  // Holding a radius still lets the subject grow and shrink whenever the
  // target sits off to one side, which is the whole case this exists for.
  const POI: [number, number] = [50.06, 14.43];
  const center = destinationPoint(POI[0], POI[1], 47, 150.75);
  const base = {
    center,
    poiCenter: POI,
    radiusM: 100,
    startAngleDeg: 17,
    endAngleDeg: 287,
    clockwise: true,
  };
  const distanceFromPoiAt = (
    shape: Parameters<typeof orbitRadiusAtBearing>[0],
    bearingDeg: number,
  ) => {
    const [lat, lng] = destinationPoint(
      shape.center[0],
      shape.center[1],
      orbitRadiusAtBearing(shape, bearingDeg),
      bearingDeg,
    );
    return haversineDistance(lat, lng, POI[0], POI[1]);
  };

  it("is a plain circle when no distance is set", () => {
    for (const angle of [17, 100, 152, 250, 287]) {
      expect(orbitRadiusAtBearing(base, angle)).toBeCloseTo(100, 6);
    }
  });

  it("is a plain circle when there is no target to hold a distance from", () => {
    const noTarget = { ...base, poiCenter: undefined, evenDistanceM: 60 };
    expect(orbitRadiusAtBearing(noTarget, 152)).toBeCloseTo(100, 6);
  });

  it("keeps the arc's two ends at the original radius", () => {
    const oval = { ...base, evenDistanceM: 90 };
    expect(orbitRadiusAtBearing(oval, 17)).toBeCloseTo(100, 6);
    expect(orbitRadiusAtBearing(oval, 287)).toBeCloseTo(100, 6);
  });

  it("holds the requested distance from the target through the middle", () => {
    const oval = { ...base, evenDistanceM: 90 };
    // Middle of the arc, and a good way either side of it.
    for (const offset of [-90, -45, 0, 45, 90]) {
      expect(distanceFromPoiAt(oval, 17 + 135 + offset)).toBeCloseTo(90, 0);
    }
  });

  it("opens back out only near the two ends", () => {
    const oval = { ...base, evenDistanceM: 90 };
    // 15% of the half-sweep on a 270 degree arc is the last 20 degrees.
    expect(distanceFromPoiAt(oval, 17 + 135 + 115)).toBeCloseTo(90, 0);
    // By the very end it has left the held distance behind and is back on
    // the circle, which here is farther from the target than 90 m.
    expect(
      Math.abs(distanceFromPoiAt(oval, 17 + 135 + 135) - 90),
    ).toBeGreaterThan(10);
  });

  it("mirrors the distance held, not the radius", () => {
    // The radius is not symmetric about the middle of the arc and should not
    // be: the target here sits 1.25 degrees off that axis, so the two sides
    // genuinely need different distances from the centre. What has to match
    // is the thing the shape is for — how far the aircraft is from the
    // subject.
    const oval = { ...base, evenDistanceM: 80 };
    for (const offset of [10, 45, 90]) {
      expect(distanceFromPoiAt(oval, 17 + 135 + offset)).toBeCloseTo(
        distanceFromPoiAt(oval, 17 + 135 - offset),
        1,
      );
    }
  });

  it("can hold a distance farther out than the circle reaches", () => {
    const oval = { ...base, evenDistanceM: 200 };
    expect(distanceFromPoiAt(oval, 17 + 135)).toBeCloseTo(200, 0);
    expect(orbitRadiusAtBearing(oval, 17)).toBeCloseTo(100, 6);
  });

  it("follows the flown arc when it runs anticlockwise", () => {
    // The middle of the arc is the middle of the path actually flown, not
    // the middle of the numeric angle range.
    const ccw = { ...base, clockwise: false, evenDistanceM: 90 };
    expect(distanceFromPoiAt(ccw, 17 - 45)).toBeCloseTo(90, 0);
    expect(orbitRadiusAtBearing(ccw, 17)).toBeCloseTo(100, 6);
    expect(orbitRadiusAtBearing(ccw, 287)).toBeCloseTo(100, 6);
  });

  it("never returns a nonsensical radius on a bearing that can't reach the distance", () => {
    // Bearings whose ray passes farther from the target than the requested
    // distance have no exact solution; the shape still has to be a shape.
    const tight = { ...base, evenDistanceM: 5 };
    for (let angle = 0; angle < 360; angle += 7) {
      const r = orbitRadiusAtBearing(tight, angle);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThan(0);
    }
  });
});

describe("an oval orbit's waypoints, and everything that measures them", () => {
  const POI: [number, number] = [50.06152, 14.429187];
  const params: OrbitParams = {
    ...DEFAULT_ORBIT_PARAMS,
    center: destinationPoint(POI[0], POI[1], 47, 150.75),
    radiusM: 100,
    numPoints: 24,
    altitude: 60,
    poiHeight: 50,
    aimHeight: 25,
    poiCenter: POI,
    startAngleDeg: 17,
    endAngleDeg: 287,
    captureMode: "video",
  };
  const distances = (p: OrbitParams) =>
    generateOrbit(p).waypoints.map((wp) =>
      haversineDistance(wp.latitude, wp.longitude, POI[0], POI[1]),
    );

  it("evens out how far the aircraft gets from the subject", () => {
    const circle = distances(params);
    const oval = distances({ ...params, evenDistanceM: 60 });
    const swing = (d: number[]) => Math.max(...d) / Math.min(...d);

    expect(swing(oval)).toBeLessThan(swing(circle));
    expect(Math.max(...oval)).toBeLessThan(Math.max(...circle) - 20);
  });

  it("leaves the first and last waypoints exactly where the circle had them", () => {
    const circle = generateOrbit(params).waypoints;
    const oval = generateOrbit({ ...params, evenDistanceM: 60 }).waypoints;
    const last = circle.length - 1;

    for (const i of [0, last]) {
      expect(oval[i].latitude).toBeCloseTo(circle[i].latitude, 9);
      expect(oval[i].longitude).toBeCloseTo(circle[i].longitude, 9);
    }
  });

  it("re-aims the gimbal for the distances actually flown", () => {
    // Pulling the middle in brings the subject closer there, so the camera
    // has to look further down at those waypoints than it would on a circle.
    const middle = Math.floor(params.numPoints / 2);
    const circle = generateOrbit(params).waypoints[middle];
    const oval = generateOrbit({ ...params, evenDistanceM: 60 }).waypoints[
      middle
    ];
    expect(oval.gimbalPitchAngle).toBeLessThan(circle.gimbalPitchAngle);
  });

  it("reports the swing of the oval, not of the circle it started as", () => {
    const oval = { ...params, evenDistanceM: 60 };
    const swing = poiDistanceSwing(
      oval.center,
      POI,
      oval.radiusM,
      oval.startAngleDeg,
      oval.endAngleDeg,
      oval.numPoints,
      { clockwise: oval.clockwise, evenDistanceM: oval.evenDistanceM },
    );
    const flown = distances(oval);

    expect(swing.nearM).toBeCloseTo(Math.min(...flown), 0);
    expect(swing.farM).toBeCloseTo(Math.max(...flown), 0);
  });

  it("checks the standoff on the oval's own waypoints", () => {
    // An oval pulled hard in must trip the same guard a too-small circle
    // would — the guard has to judge the shape that will actually be flown.
    // The arc here is turned so its middle faces the POI (on the KCP orbit
    // the middle faces away from it, and pulling that in can never get
    // closer to the subject than the centre itself).
    const facingPoi: OrbitParams = {
      ...params,
      startAngleDeg: 240,
      endAngleDeg: 60,
    };
    expect(orbitStandoffViolation(facingPoi, DEFAULT_WIDE_VFOV_DEG)).toBeNull();

    const pulledOntoIt = { ...facingPoi, evenDistanceM: 40 };
    const violation = orbitStandoffViolation(
      pulledOntoIt,
      DEFAULT_WIDE_VFOV_DEG,
    );
    expect(violation).not.toBeNull();
    expect(violation!.nearestM).toBeLessThan(
      orbitMinStandoffM(params.poiHeight, DEFAULT_WIDE_VFOV_DEG),
    );
  });
});

describe("oval holds an even distance from the target, flaring only at the ends", () => {
  // The first cut blended the radius with a raised cosine, flat at both the
  // middle and the ends. Flown, that put nearly all of the pull into the
  // middle while the waypoints beside the start and end barely moved — the
  // shape came out pinched instead of an oval, and the subject still grew
  // and shrank along the way. What the shot wants is the opposite: hold one
  // distance from the target for as much of the arc as possible, and open
  // out only where the path has to reach the two fixed ends.
  const POI: [number, number] = [50.06152, 14.429187];
  const params: OrbitParams = {
    ...DEFAULT_ORBIT_PARAMS,
    center: destinationPoint(POI[0], POI[1], 47, 150.75),
    radiusM: 100,
    numPoints: 36,
    altitude: 60,
    poiHeight: 50,
    aimHeight: 25,
    poiCenter: POI,
    startAngleDeg: 17,
    endAngleDeg: 287,
    captureMode: "video",
  };
  const distances = (p: OrbitParams) =>
    generateOrbit(p).waypoints.map((wp) =>
      haversineDistance(wp.latitude, wp.longitude, POI[0], POI[1]),
    );

  it("holds the requested distance from the target across the middle of the arc", () => {
    const oval = { ...params, evenDistanceM: 90 };
    const d = distances(oval);
    // The middle half of the flight is the part that should be steady.
    const middle = d.slice(
      Math.floor(d.length / 4),
      Math.ceil((3 * d.length) / 4),
    );
    for (const distance of middle) {
      expect(Math.abs(distance - 90)).toBeLessThan(6);
    }
  });

  it("moves the waypoints beside the ends, not just the ones in the middle", () => {
    // On the old blend the pull was concentrated in the middle and the
    // waypoints either side of the ends barely shifted, which is what made
    // the shape look pinched. Now all but the two fixed ends sit on the held
    // distance, so almost the whole flight is steady.
    const oval = distances({ ...params, evenDistanceM: 90 });
    const held = oval.filter((d) => Math.abs(d - 90) < 3).length;
    // Everything except the two fixed ends and the short flare into them.
    expect(held / oval.length).toBeGreaterThan(0.8);
  });

  it("still leaves the two ends exactly where they were", () => {
    const circle = generateOrbit(params).waypoints;
    const oval = generateOrbit({ ...params, evenDistanceM: 90 }).waypoints;
    for (const i of [0, circle.length - 1]) {
      expect(oval[i].latitude).toBeCloseTo(circle[i].latitude, 9);
      expect(oval[i].longitude).toBeCloseTo(circle[i].longitude, 9);
    }
  });

  it("keeps the subject a far steadier size than the circle does", () => {
    const swing = (d: number[]) => Math.max(...d) / Math.min(...d);
    expect(swing(distances({ ...params, evenDistanceM: 90 }))).toBeLessThan(
      1.3,
    );
    expect(swing(distances(params))).toBeGreaterThan(1.9);
  });

  it("spaces the waypoints evenly along the path", () => {
    // Bearing-spaced waypoints bunch up wherever the path comes closer to
    // the centre — visible on the map as a crowd of markers on one side.
    const wps = generateOrbit({ ...params, evenDistanceM: 90 }).waypoints;
    const legs: number[] = [];
    for (let i = 1; i < wps.length; i++) {
      legs.push(
        haversineDistance(
          wps[i - 1].latitude,
          wps[i - 1].longitude,
          wps[i].latitude,
          wps[i].longitude,
        ),
      );
    }
    expect(Math.max(...legs) / Math.min(...legs)).toBeLessThan(1.6);
  });

  it("does not fold back on itself when pulled in hard", () => {
    // A 7 m pull on a 150 m orbit is what the user actually typed. It must
    // still come out as a path that runs one way round the target, not a
    // knot: every step keeps making progress around it.
    const wps = generateOrbit({
      ...params,
      radiusM: 150,
      evenDistanceM: 20,
    }).waypoints;
    let previous: number | null = null;
    let reversals = 0;
    for (const wp of wps) {
      const b = bearing(POI[0], POI[1], wp.latitude, wp.longitude);
      if (previous !== null) {
        const step = ((b - previous + 540) % 360) - 180;
        if (step < 0) reversals++;
      }
      previous = b;
    }
    expect(reversals).toBe(0);
  });
});

describe("snapping the whole orbit onto one distance from the target", () => {
  // Holding a distance across the middle still leaves the two ends out where
  // the radius put them — on the Congress Centre orbit, 155 m against the
  // 118 m the rest of the flight holds, which reads as the ends sticking out
  // of the shape. This puts every waypoint, ends included, at one distance.
  const POI: [number, number] = [50.06152, 14.429187];
  const params: OrbitParams = {
    ...DEFAULT_ORBIT_PARAMS,
    center: destinationPoint(POI[0], POI[1], 47, 150.75),
    radiusM: 155,
    numPoints: 24,
    altitude: 37,
    poiHeight: 30,
    aimHeight: 15,
    poiCenter: POI,
    startAngleDeg: 11.7,
    endAngleDeg: 281.7,
    captureMode: "video",
  };

  it("puts every waypoint at the requested distance, ends included", () => {
    const snapped = alignOrbitToDistance(params, 118);
    const flown = generateOrbit(snapped).waypoints.map((wp) =>
      haversineDistance(wp.latitude, wp.longitude, POI[0], POI[1]),
    );
    for (const d of flown) expect(d).toBeCloseTo(118, 0);
  });

  it("keeps the flight starting and ending in the same direction as before", () => {
    const before = generateOrbit(params).waypoints;
    const after = generateOrbit(alignOrbitToDistance(params, 118)).waypoints;
    const dirFromPoi = (wp: { latitude: number; longitude: number }) =>
      bearing(POI[0], POI[1], wp.latitude, wp.longitude);
    const gap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

    expect(gap(dirFromPoi(after[0]), dirFromPoi(before[0]))).toBeLessThan(1);
    expect(
      gap(
        dirFromPoi(after[after.length - 1]),
        dirFromPoi(before[before.length - 1]),
      ),
    ).toBeLessThan(6);
  });

  it("keeps flying the same way round, over an arc that still covers the building", () => {
    // The extent measured from the target is not the extent measured from the
    // old off-centre hub — the same two end directions simply subtend a
    // different angle from a different vantage point. Direction of travel and
    // a still-substantial sweep are what have to survive.
    const snapped = alignOrbitToDistance(params, 118);
    const sweep = signedArcSweepDeg(
      snapped.startAngleDeg,
      snapped.endAngleDeg,
      snapped.clockwise,
    );
    expect(snapped.clockwise).toBe(params.clockwise);
    expect(sweep).toBeGreaterThan(180);
    expect(sweep).toBeLessThan(360);
  });

  it("leaves it a plain circle around the target, with nothing left to hold", () => {
    // Once every point is the same distance out, the oval has nothing left to
    // do — carrying a hold distance as well would just be a second, competing
    // description of the same shape.
    const snapped = alignOrbitToDistance(params, 118);
    expect(snapped.evenDistanceM).toBeUndefined();
    expect(snapped.radiusM).toBe(118);
    expect(snapped.center).toEqual(POI);
  });

  it("keeps every other setting untouched", () => {
    const snapped = alignOrbitToDistance(params, 118);
    expect(snapped.numPoints).toBe(params.numPoints);
    expect(snapped.altitude).toBe(params.altitude);
    expect(snapped.poiHeight).toBe(params.poiHeight);
    expect(snapped.aimHeight).toBe(params.aimHeight);
    expect(snapped.captureMode).toBe(params.captureMode);
    expect(snapped.poiCenter).toEqual(params.poiCenter);
  });

  it("does nothing without a locked target to measure from", () => {
    const noTarget = { ...params, poiCenter: undefined };
    expect(alignOrbitToDistance(noTarget, 118)).toEqual(noTarget);
  });
});
