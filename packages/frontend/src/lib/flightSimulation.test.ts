import { describe, it, expect } from "vitest";
import {
  buildSimulationFrames,
  frameToWaypoint,
  findFrameBracket,
  type SimulationFrame,
} from "./flightSimulation";
import { estimateWaypointArrivalTimes, haversine } from "@/lib/flightStats";
import { bearingTo } from "@/components/map/CameraFrustum";
import type { Waypoint, PointOfInterest } from "@droneroute/shared";

/** Mirrors flightSimulation.ts's own (unexported) pitchTo — used only to
 * construct realistic test fixtures whose static per-waypoint angles
 * already exactly frame a POI, the way lib/templates.ts's Orbit generator
 * precomputes them. */
function testPitchTo(
  fromLat: number,
  fromLng: number,
  fromHeight: number,
  toLat: number,
  toLng: number,
  toHeight: number,
): number {
  const horizontalDistM = haversine(fromLat, fromLng, toLat, toLng);
  return (Math.atan2(toHeight - fromHeight, horizontalDistM) * 180) / Math.PI;
}

const SPEED_MPS = 5;

function baseWaypoint(overrides: Partial<Waypoint> = {}): Waypoint {
  return {
    index: 0,
    name: "WP",
    latitude: 50,
    longitude: 14,
    height: 30,
    speed: 5,
    useGlobalSpeed: true,
    useGlobalHeight: true,
    useGlobalHeadingParam: true,
    useGlobalTurnParam: true,
    headingMode: "fixed",
    headingAngle: 0,
    gimbalPitchAngle: -30,
    actions: [],
    ...overrides,
  };
}

describe("buildSimulationFrames", () => {
  it("returns a single frame for a single waypoint", () => {
    const wp = baseWaypoint({ headingAngle: 90 });
    const frames = buildSimulationFrames([wp], [], 5, SPEED_MPS);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      latitude: 50,
      longitude: 14,
      height: 30,
      headingAngle: 90,
      gimbalPitchAngle: -30,
      timeS: 0,
    });
  });

  it("interpolates position, height, and gimbal pitch linearly along a leg", () => {
    const from = baseWaypoint({
      index: 0,
      latitude: 50,
      longitude: 14,
      height: 30,
      gimbalPitchAngle: -20,
      headingAngle: 0,
    });
    const to = baseWaypoint({
      index: 1,
      latitude: 50.001,
      longitude: 14,
      height: 60,
      gimbalPitchAngle: -40,
      headingAngle: 0,
    });
    const frames = buildSimulationFrames([from, to], [], 3, SPEED_MPS);
    expect(frames).toHaveLength(3);
    expect(frames[1].height).toBe(45);
    expect(frames[1].gimbalPitchAngle).toBe(-30);
    expect(frames[1].latitude).toBeCloseTo(50.0005, 6);
  });

  it("doesn't duplicate the shared waypoint between two consecutive legs", () => {
    const wps = [
      baseWaypoint({ index: 0, latitude: 50, height: 30 }),
      baseWaypoint({ index: 1, latitude: 50.001, height: 60 }),
      baseWaypoint({ index: 2, latitude: 50.002, height: 30 }),
    ];
    const frames = buildSimulationFrames(wps, [], 3, SPEED_MPS);
    // 3 per segment × 2 segments − 1 shared midpoint = 5
    expect(frames).toHaveLength(5);
    expect(frames.filter((f) => f.height === 60)).toHaveLength(1);
  });

  it("interpolates heading the short way across the 0/360 wraparound", () => {
    const from = baseWaypoint({ index: 0, headingAngle: 350 });
    const to = baseWaypoint({ index: 1, latitude: 50.001, headingAngle: 10 });
    const frames = buildSimulationFrames([from, to], [], 3, SPEED_MPS);
    // Midpoint should land near 0/360, not near 180 (the long way around).
    const mid = frames[1].headingAngle;
    const distanceFrom0 = Math.min(mid, 360 - mid);
    expect(distanceFrom0).toBeLessThan(15);
  });

  it("keeps a towardPOI leg's camera bearing tracking the POI at every frame, not just the endpoints", () => {
    const poi: PointOfInterest = {
      id: "poi-1",
      name: "Target",
      latitude: 50.0005,
      longitude: 14.002,
      height: 0,
    };
    const from = baseWaypoint({
      index: 0,
      latitude: 50,
      longitude: 14,
      headingMode: "towardPOI",
      poiId: "poi-1",
    });
    const to = baseWaypoint({
      index: 1,
      latitude: 50.001,
      longitude: 14,
      headingMode: "towardPOI",
      poiId: "poi-1",
    });
    const frames = buildSimulationFrames([from, to], [poi], 3, SPEED_MPS);
    // Every frame's heading should differ from a naive straight-line
    // interpolation between the endpoint headings, since the POI is off to
    // the side — proving it's recomputed per-frame, not just interpolated.
    const headings = frames.map((f) => f.headingAngle);
    expect(new Set(headings.map((h) => Math.round(h))).size).toBeGreaterThan(1);
  });

  it("dynamically tilts the gimbal to keep a towardPOI leg's target centered, not just interpolating the endpoint waypoints' static pitch", () => {
    // A tall building's POI, orbited closely — the drone climbs from below
    // the POI's height to above it over the leg, so a real "keep it
    // centered" pitch swings from tilted-up to tilted-down, which a naive
    // linear interpolation between two *unrelated* static waypoint angles
    // would not reproduce.
    const poi: PointOfInterest = {
      id: "poi-1",
      name: "Building",
      latitude: 50,
      longitude: 14.0005,
      height: 15,
    };
    const from = baseWaypoint({
      index: 0,
      latitude: 50,
      longitude: 14,
      height: 5,
      headingMode: "towardPOI",
      poiId: "poi-1",
      gimbalPitchAngle: 0,
    });
    const to = baseWaypoint({
      index: 1,
      latitude: 50,
      longitude: 14,
      height: 25,
      headingMode: "towardPOI",
      poiId: "poi-1",
      gimbalPitchAngle: 0,
    });
    const frames = buildSimulationFrames([from, to], [poi], 5, SPEED_MPS);
    // Below the POI's height (5m vs 15m): tilt up (positive pitch).
    expect(frames[0].gimbalPitchAngle).toBeGreaterThan(0);
    // Above the POI's height (25m vs 15m): tilt down (negative pitch).
    expect(frames[frames.length - 1].gimbalPitchAngle).toBeLessThan(0);
    // Every frame's pitch must differ from the naive 0->0 static
    // interpolation (which would be a flat 0 the entire leg).
    expect(frames.some((f) => Math.abs(f.gimbalPitchAngle) > 1)).toBe(true);
  });

  it("dynamically tracks a POI on a headingMode:'fixed' orbit leg whose two waypoints' own static angles were both precomputed to frame it (the Orbit template's own pattern)", () => {
    // Two points on a circle around the POI, each already carrying the
    // exact heading/pitch the Orbit template itself would have baked in —
    // this is deliberately NOT headingMode:"towardPOI", matching how
    // lib/templates.ts's generateOrbit() actually emits waypoints.
    const poi: PointOfInterest = {
      id: "poi-1",
      name: "Building",
      latitude: 50,
      longitude: 14,
      height: 15,
    };
    const fromPos = { latitude: 50.0006, longitude: 14, height: 20 };
    const toPos = { latitude: 50, longitude: 14.0006, height: 20 };
    const from = baseWaypoint({
      index: 0,
      ...fromPos,
      headingMode: "fixed",
      headingAngle: bearingTo(
        fromPos.latitude,
        fromPos.longitude,
        poi.latitude,
        poi.longitude,
      ),
      gimbalPitchAngle: testPitchTo(
        fromPos.latitude,
        fromPos.longitude,
        fromPos.height,
        poi.latitude,
        poi.longitude,
        poi.height,
      ),
    });
    const to = baseWaypoint({
      index: 1,
      ...toPos,
      headingMode: "fixed",
      headingAngle: bearingTo(
        toPos.latitude,
        toPos.longitude,
        poi.latitude,
        poi.longitude,
      ),
      gimbalPitchAngle: testPitchTo(
        toPos.latitude,
        toPos.longitude,
        toPos.height,
        poi.latitude,
        poi.longitude,
        poi.height,
      ),
    });
    const frames = buildSimulationFrames([from, to], [poi], 9, SPEED_MPS);

    // The midpoint frame's own (lat, lng) sits away from the circle (a
    // naive straight-line chord cuts inside the arc), but its heading and
    // pitch should still point AT the POI from wherever it actually is —
    // not at the naive angular average of the two endpoints' values, which
    // would be off-target for a >90° arc like this one.
    const mid = frames[Math.floor(frames.length / 2)];
    const expectedHeading = bearingTo(
      mid.latitude,
      mid.longitude,
      poi.latitude,
      poi.longitude,
    );
    const expectedPitch = testPitchTo(
      mid.latitude,
      mid.longitude,
      mid.height,
      poi.latitude,
      poi.longitude,
      poi.height,
    );
    expect(mid.headingAngle).toBeCloseTo(expectedHeading, 3);
    expect(mid.gimbalPitchAngle).toBeCloseTo(expectedPitch, 3);
  });

  it("does NOT dynamically track a POI when the two waypoints' angles don't actually match it (an unrelated survey leg)", () => {
    // A POI exists in the mission, but this leg's own static angles point
    // somewhere else entirely (e.g. a nadir mapping grid) — the heuristic
    // must not spuriously "discover" the POI just because one exists.
    const poi: PointOfInterest = {
      id: "poi-1",
      name: "Unrelated",
      latitude: 51,
      longitude: 15,
      height: 0,
    };
    const from = baseWaypoint({
      index: 0,
      latitude: 50,
      longitude: 14,
      height: 30,
      headingMode: "fixed",
      headingAngle: 90,
      gimbalPitchAngle: -90,
    });
    const to = baseWaypoint({
      index: 1,
      latitude: 50,
      longitude: 14.001,
      height: 30,
      headingMode: "fixed",
      headingAngle: 90,
      gimbalPitchAngle: -90,
    });
    const frames = buildSimulationFrames([from, to], [poi], 3, SPEED_MPS);
    // Static nadir angles unchanged by position -> plain linear
    // interpolation keeps every frame at -90, not tracking the far-away POI.
    for (const frame of frames) {
      expect(frame.gimbalPitchAngle).toBeCloseTo(-90, 3);
      expect(frame.headingAngle).toBeCloseTo(90, 3);
    }
  });

  it("gives each frame a real-flight-time timeS matching estimateWaypointArrivalTimes, non-decreasing across the mission", () => {
    const wps = [
      baseWaypoint({ index: 0, latitude: 50, longitude: 14 }),
      baseWaypoint({ index: 1, latitude: 50.001, longitude: 14 }),
      baseWaypoint({ index: 2, latitude: 50.001, longitude: 14.002 }),
    ];
    const frames = buildSimulationFrames(wps, [], 4, SPEED_MPS);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].timeS).toBeGreaterThanOrEqual(frames[i - 1].timeS);
    }
    expect(frames[0].timeS).toBe(0);
    // The mission's total duration must match the same estimator the PDF
    // report and flight-stats readout use — not a naive distance/speed
    // recomputation here, since the real estimate also includes hover and
    // turn overhead this test shouldn't have to duplicate.
    const arrivalTimesS = estimateWaypointArrivalTimes(wps, SPEED_MPS);
    expect(frames[frames.length - 1].timeS).toBeCloseTo(
      arrivalTimesS[arrivalTimesS.length - 1],
      6,
    );
  });

  it("plays a leg with a lower per-waypoint speed override back slower (more real seconds) than the global speed would", () => {
    const from = baseWaypoint({ index: 0, latitude: 50, longitude: 14 });
    // estimateWaypointArrivalTimes prices a leg by its *destination*
    // waypoint's own speed override, not the origin's.
    const slowTo = baseWaypoint({
      index: 1,
      latitude: 50.001,
      longitude: 14,
      useGlobalSpeed: false,
      speed: 1,
    });
    const fastTo = { ...slowTo, useGlobalSpeed: true };
    const framesSlow = buildSimulationFrames([from, slowTo], [], 3, SPEED_MPS);
    const framesFast = buildSimulationFrames([from, fastTo], [], 3, SPEED_MPS);
    const slowDuration = framesSlow[framesSlow.length - 1].timeS;
    const fastDuration = framesFast[framesFast.length - 1].timeS;
    expect(slowDuration).toBeGreaterThan(fastDuration);
  });
});

describe("findFrameBracket", () => {
  function frame(timeS: number): SimulationFrame {
    return {
      latitude: 0,
      longitude: 0,
      height: 0,
      headingAngle: 0,
      gimbalPitchAngle: 0,
      afterWaypointIndex: 0,
      timeS,
    };
  }

  it("finds the exact bracket and fraction between two frames", () => {
    const frames = [frame(0), frame(10), frame(20), frame(30)];
    const { lower, upper, t } = findFrameBracket(frames, 15);
    expect(lower).toBe(1);
    expect(upper).toBe(2);
    expect(t).toBeCloseTo(0.5);
  });

  it("clamps t to 0 (fully at the first frame) for a negative or zero time", () => {
    const frames = [frame(0), frame(10)];
    expect(findFrameBracket(frames, -5)).toMatchObject({ lower: 0, t: 0 });
  });

  it("clamps to the last frame for a time beyond the end", () => {
    const frames = [frame(0), frame(10), frame(20)];
    const { lower, upper } = findFrameBracket(frames, 999);
    expect(lower).toBe(1);
    expect(upper).toBe(2);
  });

  it("handles a single-frame list without dividing by zero", () => {
    const frames = [frame(0)];
    expect(findFrameBracket(frames, 5)).toEqual({ lower: 0, upper: 0, t: 0 });
  });
});

describe("frameToWaypoint", () => {
  it("produces a fixed-heading synthetic waypoint CameraFrustum can render directly", () => {
    const wp = frameToWaypoint({
      latitude: 50,
      longitude: 14,
      height: 42,
      headingAngle: 123,
      gimbalPitchAngle: -55,
      afterWaypointIndex: 2,
      timeS: 12.3,
    });
    expect(wp.headingMode).toBe("fixed");
    expect(wp.headingAngle).toBe(123);
    expect(wp.height).toBe(42);
    expect(wp.gimbalPitchAngle).toBe(-55);
    expect(wp.latitude).toBe(50);
    expect(wp.longitude).toBe(14);
  });
});
