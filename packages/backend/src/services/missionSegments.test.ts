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

  it("keeps non-recording actions (gimbal, hover, zoom, ...) alongside the re-derived recording pair", () => {
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
    const gimbalRotate = {
      actionId: 0,
      actionType: "gimbalRotate" as const,
      params: { gimbalPitchRotateAngle: -45 },
    };
    const hover = {
      actionId: 0,
      actionType: "hover" as const,
      params: { hoverTime: 3 },
    };
    // Middle waypoint carries a gimbal move and a hover on top of the whole
    // mission's start/stop record pair — splitting into segments must not
    // drop them, only add/replace the record actions on each leg's own ends.
    const mission = makeMission([
      makeWaypoint(0, { actions: [start] }),
      makeWaypoint(1, { actions: [gimbalRotate] }),
      makeWaypoint(2, { actions: [hover, stop] }),
    ]);

    const segments = buildMissionSegments(mission);
    const types = (actions: { actionType: string }[]) =>
      actions.map((a) => a.actionType);

    expect(segments).toHaveLength(2);
    // Segment 1: WP0 (start) -> WP1 (gimbalRotate). The gimbal move must
    // survive on the second waypoint, alongside its own re-derived stopRecord.
    expect(types(segments[0].waypoints[0].actions)).toEqual(["startRecord"]);
    expect(types(segments[0].waypoints[1].actions)).toEqual([
      "gimbalRotate",
      "stopRecord",
    ]);
    // Segment 2: WP1 (gimbalRotate) -> WP2 (hover, stop). The gimbal move
    // must survive on the first waypoint, alongside its own startRecord, and
    // the hover must survive on the second waypoint alongside stopRecord.
    // startRecord now comes last on a leg's opening waypoint: whatever sets
    // the camera up (gimbal, settle, focus) has to happen before the
    // recording starts, or the swing and the settle end up in the clip.
    expect(types(segments[1].waypoints[0].actions)).toEqual([
      "gimbalRotate",
      "startRecord",
    ]);
    expect(types(segments[1].waypoints[1].actions)).toEqual([
      "hover",
      "stopRecord",
    ]);
    // actionIds stay unique/sequential within each waypoint's action list.
    for (const segment of segments) {
      for (const wp of segment.waypoints) {
        expect(wp.actions.map((a) => a.actionId)).toEqual(
          wp.actions.map((_, i) => i),
        );
      }
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

describe("every segment aims its own camera", () => {
  // Each segment is flown as its own flight, months apart in a time-lapse
  // series. The parent orbit sets the opening gimbal angle and focuses once,
  // on its first two waypoints — carried through the split unchanged, that
  // leaves segments 2..N taking off with the gimbal wherever the pilot left
  // it and never focusing. Verified against a real 71-segment upload: only
  // 1 of 71 segments had a gimbalRotate and only 2 of 71 had a focus.
  const orbitWaypoint = (index: number, pitch: number, extra = []) =>
    makeWaypoint(index, {
      headingMode: "towardPOI",
      poiId: "poi-1",
      useGlobalHeadingParam: false,
      gimbalPitchAngle: pitch,
      actions: [
        {
          actionId: 0,
          actionType: "gimbalEvenlyRotate",
          params: { gimbalPitchRotateAngle: pitch + 1 },
        },
        ...extra,
      ],
    } as Partial<Waypoint>);

  const orbit = () => {
    const m = makeMission([
      orbitWaypoint(0, -28, [
        { actionId: 1, actionType: "startRecord", params: {} },
        {
          actionId: 2,
          actionType: "gimbalRotate",
          params: { gimbalPitchRotateAngle: -28 },
        },
      ] as never),
      orbitWaypoint(1, -27, [
        { actionId: 1, actionType: "hover", params: { hoverTime: 1 } },
        { actionId: 2, actionType: "focus", params: { isPointFocus: true } },
      ] as never),
      orbitWaypoint(2, -26),
      makeWaypoint(3, {
        headingMode: "towardPOI",
        poiId: "poi-1",
        useGlobalHeadingParam: false,
        gimbalPitchAngle: -25,
        actions: [{ actionId: 0, actionType: "stopRecord", params: {} }],
      } as Partial<Waypoint>),
    ]);
    m.pois = [
      {
        id: "poi-1",
        name: "Cíl",
        latitude: 41.26,
        longitude: 0.94,
        height: 25,
      },
    ];
    return m;
  };

  const typesOf = (wp: Waypoint) => wp.actions.map((a) => a.actionType);

  it("gives every segment an opening gimbal angle matching its own first waypoint", () => {
    const segments = buildMissionSegments(orbit());
    expect(segments).toHaveLength(3);
    for (const seg of segments) {
      const rotate = seg.waypoints[0].actions.find(
        (a) => a.actionType === "gimbalRotate",
      );
      expect(rotate, `${seg.name} must set its opening angle`).toBeDefined();
      expect(
        (rotate!.params as { gimbalPitchRotateAngle: number })
          .gimbalPitchRotateAngle,
      ).toBe(seg.waypoints[0].gimbalPitchAngle);
    }
  });

  it("focuses on every segment, after a settle", () => {
    for (const seg of buildMissionSegments(orbit())) {
      const types = typesOf(seg.waypoints[0]);
      expect(types, `${seg.name} must focus`).toContain("focus");
      expect(types.indexOf("hover")).toBeLessThan(types.indexOf("focus"));
      // Recording starts after the camera is set, so the settle isn't in the
      // clip.
      expect(types.indexOf("focus")).toBeLessThan(types.indexOf("startRecord"));
    }
  });

  it("does not duplicate what a segment already inherited", () => {
    for (const seg of buildMissionSegments(orbit())) {
      for (const wp of seg.waypoints) {
        for (const type of ["gimbalRotate", "focus", "hover"]) {
          expect(
            wp.actions.filter((a) => a.actionType === type).length,
            `${seg.name} ${wp.name} ${type}`,
          ).toBeLessThanOrEqual(1);
        }
      }
      const ids = seg.waypoints[0].actions.map((a) => a.actionId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("keeps the per-leg gimbal walk and the recording pair", () => {
    for (const seg of buildMissionSegments(orbit())) {
      expect(typesOf(seg.waypoints[0])).toContain("gimbalEvenlyRotate");
      expect(typesOf(seg.waypoints[0])).toContain("startRecord");
      expect(typesOf(seg.waypoints[1])).toContain("stopRecord");
    }
  });

  it("leaves a route that doesn't track a target alone", () => {
    // A survey grid or a manually-flown camera: nothing here asked for the
    // gimbal to be aimed, so segments must not start inventing gimbal moves.
    const plain = makeMission([
      makeWaypoint(0, {
        actions: [{ actionId: 0, actionType: "startRecord", params: {} }],
      } as Partial<Waypoint>),
      makeWaypoint(1),
      makeWaypoint(2, {
        actions: [{ actionId: 0, actionType: "stopRecord", params: {} }],
      } as Partial<Waypoint>),
    ]);
    for (const seg of buildMissionSegments(plain)) {
      for (const wp of seg.waypoints) {
        expect(typesOf(wp)).not.toContain("gimbalRotate");
        expect(typesOf(wp)).not.toContain("focus");
      }
    }
  });
});
