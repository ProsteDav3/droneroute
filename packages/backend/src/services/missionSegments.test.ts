import { describe, it, expect } from "vitest";
import type { Mission, Waypoint } from "@droneroute/shared";
import { DEFAULT_MISSION_CONFIG, DEFAULT_WAYPOINT } from "@droneroute/shared";
import { buildMissionSegments } from "./missionSegments.js";

function makeWaypoint(
  index: number,
  overrides: Partial<Waypoint> = {},
): Waypoint {
  return {
    ...DEFAULT_WAYPOINT,
    index,
    name: `WP${index}`,
    latitude: 41.25 + index * 0.001,
    longitude: 0.93,
    actions: [],
    ...overrides,
  };
}

function makeMission(waypoints: Waypoint[], name = "Test mise"): Mission {
  return {
    id: "mission-1",
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    config: DEFAULT_MISSION_CONFIG,
    waypoints,
    pois: [],
    obstacles: [],
    buildings: [],
    templateGroups: {},
  };
}

describe("buildMissionSegments", () => {
  it("splits N waypoints into N-1 consecutive one-leg segments", () => {
    const mission = makeMission([
      makeWaypoint(0),
      makeWaypoint(1),
      makeWaypoint(2),
      makeWaypoint(3),
    ]);

    const segments = buildMissionSegments(mission);

    expect(segments).toHaveLength(3);
    expect(segments[0].name).toBe("Test_mise-seg-1-of-3");
    expect(segments[0].waypoints.map((w) => w.latitude)).toEqual([
      mission.waypoints[0].latitude,
      mission.waypoints[1].latitude,
    ]);
    expect(segments[2].waypoints.map((w) => w.latitude)).toEqual([
      mission.waypoints[2].latitude,
      mission.waypoints[3].latitude,
    ]);
    // Re-indexed to 0/1 within each segment, regardless of original position
    for (const segment of segments) {
      expect(segment.waypoints.map((w) => w.index)).toEqual([0, 1]);
    }
  });

  it("carries photo-mode actions through untouched (already one takePhoto per waypoint)", () => {
    const photoAction = {
      actionId: 0,
      actionType: "takePhoto" as const,
      params: { payloadPositionIndex: 0 },
    };
    const mission = makeMission([
      makeWaypoint(0, { actions: [photoAction] }),
      makeWaypoint(1, { actions: [photoAction] }),
      makeWaypoint(2, { actions: [photoAction] }),
    ]);

    const segments = buildMissionSegments(mission);

    for (const segment of segments) {
      for (const wp of segment.waypoints) {
        expect(wp.actions).toEqual([photoAction]);
      }
    }
  });

  it("gives every segment its own startRecord/stopRecord pair in video mode, not just the first and last", () => {
    const start = {
      actionId: 0,
      actionType: "startRecord" as const,
      params: { payloadPositionIndex: 0 },
    };
    const stop = {
      actionId: 0,
      actionType: "stopRecord" as const,
      params: { payloadPositionIndex: 0 },
    };
    // Mirrors templates.ts video mode: startRecord only on the very first
    // waypoint, stopRecord only on the very last — everything between has no
    // actions at all.
    const mission = makeMission([
      makeWaypoint(0, { actions: [start] }),
      makeWaypoint(1, { actions: [] }),
      makeWaypoint(2, { actions: [] }),
      makeWaypoint(3, { actions: [stop] }),
    ]);

    const segments = buildMissionSegments(mission);

    expect(segments).toHaveLength(3);
    for (const segment of segments) {
      expect(segment.waypoints[0].actions).toEqual([start]);
      expect(segment.waypoints[1].actions).toEqual([stop]);
    }
  });

  it("preserves solar IR lens params on the re-derived recording actions", () => {
    const start = {
      actionId: 0,
      actionType: "startRecord" as const,
      params: { payloadPositionIndex: 0, payloadLensIndex: "ir" },
    };
    const stop = {
      actionId: 0,
      actionType: "stopRecord" as const,
      params: { payloadPositionIndex: 0, payloadLensIndex: "ir" },
    };
    const mission = makeMission([
      makeWaypoint(0, { actions: [start] }),
      makeWaypoint(1, { actions: [] }),
      makeWaypoint(2, { actions: [stop] }),
    ]);

    const segments = buildMissionSegments(mission);

    for (const segment of segments) {
      expect(segment.waypoints[0].actions[0].params).toMatchObject({
        payloadLensIndex: "ir",
      });
      expect(segment.waypoints[1].actions[0].params).toMatchObject({
        payloadLensIndex: "ir",
      });
    }
  });

  it("leaves segments actionless when the parent mission has no capture actions at all", () => {
    const mission = makeMission([
      makeWaypoint(0),
      makeWaypoint(1),
      makeWaypoint(2),
    ]);

    const segments = buildMissionSegments(mission);

    for (const segment of segments) {
      for (const wp of segment.waypoints) {
        expect(wp.actions).toEqual([]);
      }
    }
  });
});
