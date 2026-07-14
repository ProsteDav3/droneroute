import { describe, it, expect, beforeEach } from "vitest";
import { useMissionStore } from "./missionStore";
import { DEFAULT_ORBIT_PARAMS } from "@/lib/templates";
import type { OrbitParams } from "@/lib/templates";

function baseWaypoint(lat: number, lng: number) {
  return {
    latitude: lat,
    longitude: lng,
    height: 30,
    speed: 5,
    useGlobalSpeed: true,
    useGlobalHeight: true,
    useGlobalHeadingParam: true,
    useGlobalTurnParam: true,
    gimbalPitchAngle: 0,
    actions: [],
  };
}

describe("missionStore — template groups (edit-after-apply)", () => {
  beforeEach(() => {
    useMissionStore.getState().clearMission();
  });

  it("appendWaypoints without a templateGroup leaves waypoints untagged", () => {
    useMissionStore
      .getState()
      .appendWaypoints([baseWaypoint(50, 14), baseWaypoint(50.001, 14)]);
    const { waypoints, templateGroups } = useMissionStore.getState();
    expect(waypoints).toHaveLength(2);
    expect(waypoints.every((wp) => wp.templateGroupId === undefined)).toBe(
      true,
    );
    expect(Object.keys(templateGroups)).toHaveLength(0);
  });

  it("appendWaypoints with a templateGroup tags every waypoint/POI and records the group", () => {
    const params: OrbitParams = {
      ...DEFAULT_ORBIT_PARAMS,
      center: [50, 14],
      radiusM: 70,
    };
    useMissionStore
      .getState()
      .appendWaypoints(
        [baseWaypoint(50, 14), baseWaypoint(50.001, 14)],
        [{ name: "Orbit center", latitude: 50, longitude: 14, height: 0 }],
        { type: "orbit", params },
      );

    const { waypoints, pois, templateGroups } = useMissionStore.getState();
    const groupId = waypoints[0].templateGroupId;
    expect(groupId).toBeTruthy();
    expect(waypoints.every((wp) => wp.templateGroupId === groupId)).toBe(true);
    expect(pois[0].templateGroupId).toBe(groupId);
    expect(templateGroups[groupId!]).toEqual({ type: "orbit", params });
  });

  it("replaceTemplateGroup swaps out only that group's waypoints/POIs, leaving unrelated ones untouched", () => {
    const store = useMissionStore.getState();

    // Manually placed waypoint, unrelated to any template.
    store.appendWaypoints([baseWaypoint(51, 15)]);

    // An orbit template application.
    const originalParams: OrbitParams = {
      ...DEFAULT_ORBIT_PARAMS,
      center: [50, 14],
      radiusM: 70,
    };
    store.appendWaypoints(
      [baseWaypoint(50, 14), baseWaypoint(50.001, 14)],
      [{ name: "Orbit center", latitude: 50, longitude: 14, height: 0 }],
      { type: "orbit", params: originalParams },
    );

    const groupId = useMissionStore
      .getState()
      .waypoints.find((wp) => wp.templateGroupId)!.templateGroupId!;

    const updatedParams: OrbitParams = { ...originalParams, radiusM: 120 };
    useMissionStore
      .getState()
      .replaceTemplateGroup(
        groupId,
        [
          baseWaypoint(50, 14.002),
          baseWaypoint(50.002, 14.002),
          baseWaypoint(50.002, 14),
        ],
        [{ name: "Orbit center", latitude: 50, longitude: 14, height: 0 }],
        updatedParams,
      );

    const { waypoints, pois, templateGroups } = useMissionStore.getState();

    // The unrelated manually-placed waypoint survives untouched.
    expect(
      waypoints.some(
        (wp) =>
          wp.latitude === 51 &&
          wp.longitude === 15 &&
          wp.templateGroupId === undefined,
      ),
    ).toBe(true);

    // The old 2-waypoint orbit is gone, replaced by the new 3-waypoint one,
    // all still tagged with the *same* group id.
    const groupWaypoints = waypoints.filter(
      (wp) => wp.templateGroupId === groupId,
    );
    expect(groupWaypoints).toHaveLength(3);

    // Only one POI remains for this group (old one removed, not duplicated).
    const groupPois = pois.filter((p) => p.templateGroupId === groupId);
    expect(groupPois).toHaveLength(1);

    // The stored params reflect the edit.
    expect(templateGroups[groupId].params).toEqual(updatedParams);

    // Total waypoint count: 1 unrelated + 3 from the edited group.
    expect(waypoints).toHaveLength(4);
  });

  it("replaceTemplateGroup renumbers waypoints with no duplicate/gapped indices when unrelated waypoints exist both before and after the group", () => {
    const store = useMissionStore.getState();

    // Waypoint A, placed before the template.
    store.appendWaypoints([baseWaypoint(51, 15)]);

    // An orbit template application (waypoints B, C).
    const originalParams: OrbitParams = {
      ...DEFAULT_ORBIT_PARAMS,
      center: [50, 14],
      radiusM: 70,
    };
    store.appendWaypoints(
      [baseWaypoint(50, 14), baseWaypoint(50.001, 14)],
      [{ name: "Orbit center", latitude: 50, longitude: 14, height: 0 }],
      { type: "orbit", params: originalParams },
    );

    // Waypoint D, placed after the template.
    store.appendWaypoints([baseWaypoint(52, 16)]);

    const groupId = useMissionStore
      .getState()
      .waypoints.find((wp) => wp.templateGroupId)!.templateGroupId!;

    const updatedParams: OrbitParams = { ...originalParams, radiusM: 120 };
    useMissionStore
      .getState()
      .replaceTemplateGroup(
        groupId,
        [
          baseWaypoint(50, 14.002),
          baseWaypoint(50.002, 14.002),
          baseWaypoint(50.002, 14),
        ],
        [{ name: "Orbit center", latitude: 50, longitude: 14, height: 0 }],
        updatedParams,
      );

    const { waypoints } = useMissionStore.getState();
    const indices = waypoints.map((wp) => wp.index).sort((a, b) => a - b);

    // 1 (A) + 1 (D) + 3 (regenerated group) = 5 waypoints, indices must be
    // a contiguous 0..4 run with no duplicates or gaps.
    expect(indices).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("clearMission resets templateGroups and editingTemplateGroupId", () => {
    const store = useMissionStore.getState();
    store.appendWaypoints(
      [baseWaypoint(50, 14), baseWaypoint(50.001, 14)],
      [{ name: "Orbit center", latitude: 50, longitude: 14, height: 0 }],
      {
        type: "orbit",
        params: { ...DEFAULT_ORBIT_PARAMS, center: [50, 14], radiusM: 70 },
      },
    );
    store.setEditingTemplateGroupId(
      useMissionStore.getState().waypoints[0].templateGroupId!,
    );

    useMissionStore.getState().clearMission();

    const { templateGroups, editingTemplateGroupId, waypoints } =
      useMissionStore.getState();
    expect(Object.keys(templateGroups)).toHaveLength(0);
    expect(editingTemplateGroupId).toBeNull();
    expect(waypoints).toHaveLength(0);
  });
});
