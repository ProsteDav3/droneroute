import { describe, it, expect } from "vitest";
import { computeMissionProgress } from "./missionProgress";
import type { Waypoint } from "@droneroute/shared";

/** Three waypoints roughly 100m apart along a straight north-south line. */
function makeWaypoints(): Waypoint[] {
  const base = {
    height: 30,
    speed: 5,
    useGlobalSpeed: true,
    useGlobalHeight: true,
    useGlobalHeadingParam: true,
    useGlobalTurnParam: true,
    gimbalPitchAngle: 0,
    actions: [],
  };
  return [
    { ...base, index: 0, name: "WP1", latitude: 50, longitude: 14 },
    { ...base, index: 1, name: "WP2", latitude: 50.0009, longitude: 14 },
    { ...base, index: 2, name: "WP3", latitude: 50.0018, longitude: 14 },
  ];
}

describe("computeMissionProgress", () => {
  it("returns null for a mission with fewer than 2 waypoints", () => {
    const single = [makeWaypoints()[0]];
    expect(computeMissionProgress(single, { lat: 50, lng: 14 }, 5)).toBeNull();
  });

  it("reports ~0% at the first waypoint", () => {
    const progress = computeMissionProgress(
      makeWaypoints(),
      { lat: 50, lng: 14 },
      5,
    );
    expect(progress).not.toBeNull();
    expect(progress!.percentComplete).toBeCloseTo(0, 0);
    expect(progress!.flownWaypointIndex).toBe(0);
  });

  it("reports ~50% at the midpoint waypoint", () => {
    const progress = computeMissionProgress(
      makeWaypoints(),
      { lat: 50.0009, lng: 14 },
      5,
    );
    expect(progress!.percentComplete).toBeCloseTo(50, -1);
  });

  it("reports ~100% at the final waypoint", () => {
    const progress = computeMissionProgress(
      makeWaypoints(),
      { lat: 50.0018, lng: 14 },
      5,
    );
    expect(progress!.percentComplete).toBeCloseTo(100, 0);
    expect(progress!.distanceRemainingM).toBeCloseTo(0, 0);
  });

  it("clamps a position past the last waypoint to 100%, not over", () => {
    const progress = computeMissionProgress(
      makeWaypoints(),
      { lat: 50.003, lng: 14 },
      5,
    );
    expect(progress!.percentComplete).toBe(100);
  });

  it("estimates ETA from remaining distance and current speed", () => {
    const progress = computeMissionProgress(
      makeWaypoints(),
      { lat: 50, lng: 14 },
      10,
    );
    expect(progress!.etaSeconds).not.toBeNull();
    expect(progress!.etaSeconds).toBeCloseTo(
      progress!.distanceRemainingM / 10,
      0,
    );
  });

  it("returns null ETA when speed is too low to be meaningful", () => {
    const progress = computeMissionProgress(
      makeWaypoints(),
      { lat: 50, lng: 14 },
      0.1,
    );
    expect(progress!.etaSeconds).toBeNull();
  });

  it("returns null ETA when speed is undefined", () => {
    const progress = computeMissionProgress(
      makeWaypoints(),
      { lat: 50, lng: 14 },
      undefined,
    );
    expect(progress!.etaSeconds).toBeNull();
  });

  it("picks the nearest segment for a position off the exact line", () => {
    // Slightly east of WP2, still closest to the WP1→WP2 or WP2→WP3 segment.
    const progress = computeMissionProgress(
      makeWaypoints(),
      { lat: 50.0009, lng: 14.0001 },
      5,
    );
    expect(progress!.percentComplete).toBeGreaterThan(30);
    expect(progress!.percentComplete).toBeLessThan(70);
  });
});
