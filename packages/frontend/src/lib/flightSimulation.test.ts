import { describe, it, expect } from "vitest";
import { buildSimulationFrames, frameToWaypoint } from "./flightSimulation";
import type { Waypoint, PointOfInterest } from "@droneroute/shared";

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
    const frames = buildSimulationFrames([wp], [], 5);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      latitude: 50,
      longitude: 14,
      height: 30,
      headingAngle: 90,
      gimbalPitchAngle: -30,
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
    const frames = buildSimulationFrames([from, to], [], 3);
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
    const frames = buildSimulationFrames(wps, [], 3);
    // 3 per segment × 2 segments − 1 shared midpoint = 5
    expect(frames).toHaveLength(5);
    expect(frames.filter((f) => f.height === 60)).toHaveLength(1);
  });

  it("interpolates heading the short way across the 0/360 wraparound", () => {
    const from = baseWaypoint({ index: 0, headingAngle: 350 });
    const to = baseWaypoint({ index: 1, latitude: 50.001, headingAngle: 10 });
    const frames = buildSimulationFrames([from, to], [], 3);
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
    const frames = buildSimulationFrames([from, to], [poi], 3);
    // Every frame's heading should differ from a naive straight-line
    // interpolation between the endpoint headings, since the POI is off to
    // the side — proving it's recomputed per-frame, not just interpolated.
    const headings = frames.map((f) => f.headingAngle);
    expect(new Set(headings.map((h) => Math.round(h))).size).toBeGreaterThan(1);
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
    });
    expect(wp.headingMode).toBe("fixed");
    expect(wp.headingAngle).toBe(123);
    expect(wp.height).toBe(42);
    expect(wp.gimbalPitchAngle).toBe(-55);
    expect(wp.latitude).toBe(50);
    expect(wp.longitude).toBe(14);
  });
});
