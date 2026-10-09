import { describe, it, expect } from "vitest";
import type { Waypoint, WaypointAction } from "@droneroute/shared";
import { CINEMA_SPEED_MPS } from "./templates";
import {
  applyCaptureMode,
  detectCaptureMode,
  findRecordingProblem,
} from "./captureActions";

function wp(index: number, overrides: Partial<Waypoint> = {}): Waypoint {
  return {
    index,
    name: `WP${index + 1}`,
    latitude: 50 + index * 0.001,
    longitude: 14,
    height: 50,
    speed: 5,
    useGlobalSpeed: true,
    useGlobalHeight: true,
    useGlobalHeadingParam: true,
    useGlobalTurnParam: true,
    gimbalPitchAngle: -30,
    actions: [],
    ...overrides,
  };
}

const takePhoto: WaypointAction = {
  actionId: 0,
  actionType: "takePhoto",
  params: { payloadPositionIndex: 0 },
};
const startRecord: WaypointAction = {
  actionId: 0,
  actionType: "startRecord",
  params: { payloadPositionIndex: 0 },
};
const stopRecord: WaypointAction = {
  actionId: 0,
  actionType: "stopRecord",
  params: { payloadPositionIndex: 0 },
};
const gimbalRotate: WaypointAction = {
  actionId: 0,
  actionType: "gimbalRotate",
  params: {
    gimbalRotateMode: "absoluteAngle",
    gimbalPitchRotateAngle: -30,
    gimbalYawRotateAngle: 0,
    payloadPositionIndex: 0,
  },
};
const evenlyRotate: WaypointAction = {
  actionId: 0,
  actionType: "gimbalEvenlyRotate",
  params: { gimbalPitchRotateAngle: -40, payloadPositionIndex: 0 },
};

const types = (w: Waypoint) => w.actions.map((a) => a.actionType);
const all = (ws: Waypoint[]) => new Set(ws.map((w) => w.index));

describe("applyCaptureMode", () => {
  it("photo puts one takePhoto on every selected waypoint and leaves the rest alone", () => {
    const input = [wp(0), wp(1), wp(2)];
    const out = applyCaptureMode(input, new Set([0, 2]), "photo", false);
    expect(types(out[0])).toEqual(["takePhoto"]);
    expect(types(out[1])).toEqual([]);
    expect(types(out[2])).toEqual(["takePhoto"]);
  });

  it("photo replaces old record actions but keeps camera setup actions, before any evenly-rotate", () => {
    const input = [
      wp(0, { actions: [gimbalRotate, startRecord, evenlyRotate] }),
      wp(1, { actions: [stopRecord] }),
    ];
    const out = applyCaptureMode(input, all(input), "photo", false);
    expect(types(out[0])).toEqual([
      "gimbalRotate",
      "takePhoto",
      "gimbalEvenlyRotate",
    ]);
    expect(types(out[1])).toEqual(["takePhoto"]);
  });

  it("video records from the first selected waypoint to the last, in flight order", () => {
    const input = [wp(0), wp(1), wp(2), wp(3)];
    const out = applyCaptureMode(input, new Set([3, 1, 2]), "video", false);
    expect(types(out[0])).toEqual([]);
    expect(types(out[1])).toEqual(["startRecord"]);
    expect(types(out[2])).toEqual([]);
    expect(types(out[3])).toEqual(["stopRecord"]);
  });

  it("video strips photo actions from the middle of the selection", () => {
    const input = [
      wp(0, { actions: [takePhoto] }),
      wp(1, { actions: [gimbalRotate, takePhoto] }),
      wp(2, { actions: [takePhoto] }),
    ];
    const out = applyCaptureMode(input, all(input), "video", false);
    expect(types(out[0])).toEqual(["startRecord"]);
    expect(types(out[1])).toEqual(["gimbalRotate"]);
    expect(types(out[2])).toEqual(["stopRecord"]);
  });

  it("video on a single waypoint both starts and stops there", () => {
    const out = applyCaptureMode([wp(0), wp(1)], new Set([1]), "video", false);
    expect(types(out[1])).toEqual(["startRecord", "stopRecord"]);
  });

  it("renumbers actionIds sequentially per waypoint", () => {
    const input = [wp(0, { actions: [gimbalRotate, evenlyRotate] })];
    const out = applyCaptureMode(input, all(input), "photo", false);
    expect(out[0].actions.map((a) => a.actionId)).toEqual([0, 1, 2]);
  });

  it("cinema caps the selected waypoints' speed; plain video leaves speed untouched", () => {
    const input = [wp(0), wp(1)];
    const cinema = applyCaptureMode(input, all(input), "video", true);
    expect(cinema.map((w) => w.speed)).toEqual([
      CINEMA_SPEED_MPS,
      CINEMA_SPEED_MPS,
    ]);
    expect(cinema.every((w) => w.useGlobalSpeed === false)).toBe(true);

    const plain = applyCaptureMode(input, all(input), "video", false);
    expect(plain.map((w) => w.speed)).toEqual([5, 5]);
    expect(plain.every((w) => w.useGlobalSpeed === true)).toBe(true);
  });

  it("does not mutate the input waypoints", () => {
    const input = [wp(0, { actions: [takePhoto] }), wp(1)];
    const snapshot = JSON.stringify(input);
    applyCaptureMode(input, all(input), "video", true);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("returns the input unchanged for an empty selection", () => {
    const input = [wp(0)];
    expect(applyCaptureMode(input, new Set(), "video", false)).toBe(input);
  });
});

describe("detectCaptureMode", () => {
  it("reports photo when every selected waypoint takes a photo", () => {
    const ws = [
      wp(0, { actions: [takePhoto] }),
      wp(1, { actions: [takePhoto] }),
    ];
    expect(detectCaptureMode(ws, all(ws))).toEqual({
      mode: "photo",
      cinema: false,
    });
  });

  it("reports video when recording starts on the first and stops on the last selected", () => {
    const ws = [
      wp(0, { actions: [gimbalRotate, startRecord] }),
      wp(1),
      wp(2, { actions: [stopRecord] }),
    ];
    expect(detectCaptureMode(ws, all(ws))).toEqual({
      mode: "video",
      cinema: false,
    });
  });

  it("reports cinema when the video selection is paced at the cinema speed", () => {
    const slow = { speed: CINEMA_SPEED_MPS, useGlobalSpeed: false };
    const ws = [
      wp(0, { actions: [startRecord], ...slow }),
      wp(1, { actions: [stopRecord], ...slow }),
    ];
    expect(detectCaptureMode(ws, all(ws))).toEqual({
      mode: "video",
      cinema: true,
    });
  });

  it("reports no mode for a mixed or empty selection", () => {
    const mixed = [wp(0, { actions: [takePhoto] }), wp(1)];
    expect(detectCaptureMode(mixed, all(mixed)).mode).toBeUndefined();
    const none = [wp(0), wp(1)];
    expect(detectCaptureMode(none, all(none)).mode).toBeUndefined();
    expect(detectCaptureMode(none, new Set()).mode).toBeUndefined();
  });
});

describe("findRecordingProblem", () => {
  it("accepts a mission with no recording, or one clean start/stop pair", () => {
    expect(findRecordingProblem([wp(0), wp(1)])).toBeNull();
    expect(
      findRecordingProblem([
        wp(0, { actions: [startRecord] }),
        wp(1),
        wp(2, { actions: [stopRecord] }),
      ]),
    ).toBeNull();
  });

  it("accepts a start and stop on the same waypoint, and two separate clips", () => {
    expect(
      findRecordingProblem([wp(0, { actions: [startRecord, stopRecord] })]),
    ).toBeNull();
    expect(
      findRecordingProblem([
        wp(0, { actions: [startRecord] }),
        wp(1, { actions: [stopRecord] }),
        wp(2, { actions: [startRecord] }),
        wp(3, { actions: [stopRecord] }),
      ]),
    ).toBeNull();
  });

  it("flags a second start while already recording, naming the waypoint", () => {
    // Video applied to WP3-WP4 of an imported clip that runs WP1-WP5.
    const ws = [
      wp(0, { actions: [startRecord] }),
      wp(1),
      wp(2, { actions: [startRecord] }),
      wp(3, { actions: [stopRecord] }),
      wp(4, { actions: [stopRecord] }),
    ];
    expect(findRecordingProblem(ws)).toMatch(/WP3/);
  });

  it("flags a stop without a running recording", () => {
    const ws = [wp(0), wp(1, { actions: [stopRecord] })];
    expect(findRecordingProblem(ws)).toMatch(/WP2/);
  });

  it("flags a recording that is never stopped", () => {
    // Foto applied to the tail of a video mission removes its stopRecord.
    const ws = [
      wp(0, { actions: [startRecord] }),
      wp(1, { actions: [takePhoto] }),
    ];
    expect(findRecordingProblem(ws)).toMatch(/nezastaví/);
  });
});
