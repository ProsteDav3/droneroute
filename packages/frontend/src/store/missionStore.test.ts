import { describe, it, expect, beforeEach } from "vitest";
import { useMissionStore } from "./missionStore";
import { DEFAULT_ORBIT_PARAMS, destinationPoint } from "@/lib/templates";
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

describe("missionStore — buildings and POI-triggered orbit pre-fill", () => {
  beforeEach(() => {
    useMissionStore.getState().clearMission();
  });

  const CENTER: [number, number] = [50.06, 14.43];

  function squareFootprint(size: number): [number, number][] {
    const c00 = CENTER;
    const c10 = destinationPoint(c00[0], c00[1], size, 90);
    const c01 = destinationPoint(c00[0], c00[1], size, 0);
    const c11 = destinationPoint(c01[0], c01[1], size, 90);
    return [c00, c10, c11, c01];
  }

  it("addBuilding records height and vertices, and selects it", () => {
    const store = useMissionStore.getState();
    store.addBuilding(squareFootprint(40), 25);

    const { buildings, selectedBuildingId, isDrawingBuilding } =
      useMissionStore.getState();
    expect(buildings).toHaveLength(1);
    expect(buildings[0].height).toBe(25);
    expect(buildings[0].vertices).toHaveLength(4);
    expect(selectedBuildingId).toBe(buildings[0].id);
    expect(isDrawingBuilding).toBe(false);
  });

  it("placing a POI inside a building sets its height and pre-fills pendingOrbitParams, without generating any waypoints", () => {
    const store = useMissionStore.getState();
    store.addBuilding(squareFootprint(40), 25);

    // A point well inside the 40x40 footprint (~20m in from the corner).
    const inside = destinationPoint(CENTER[0], CENTER[1], 15, 45);
    store.addPoi(inside[0], inside[1]);

    const { pois, pendingOrbitParams, waypoints, buildings } =
      useMissionStore.getState();
    expect(pois).toHaveLength(1);
    expect(pois[0].height).toBe(25);
    expect(waypoints).toHaveLength(0);

    expect(pendingOrbitParams).not.toBeNull();
    expect(pendingOrbitParams!.poiHeight).toBe(25);
    expect(pendingOrbitParams!.radiusM).toBeGreaterThan(0);
    expect(pendingOrbitParams!.altitude).toBeGreaterThan(25);
    // Center should be near the building, not at the POI's own coordinates.
    const seedCenterDist = Math.abs(
      pendingOrbitParams!.center[0] - buildings[0].vertices[0][0],
    );
    expect(seedCenterDist).toBeLessThan(0.01);
  });

  it("placing a POI far from any building leaves height at 0 and pendingOrbitParams untouched", () => {
    const store = useMissionStore.getState();
    store.addBuilding(squareFootprint(40), 25);

    const farAway = destinationPoint(CENTER[0], CENTER[1], 5000, 180);
    store.addPoi(farAway[0], farAway[1]);

    const { pois, pendingOrbitParams } = useMissionStore.getState();
    expect(pois[0].height).toBe(0);
    expect(pendingOrbitParams).toBeNull();
  });

  it("clearMission resets pendingOrbitParams (regression: a stale seed must not leak into the next mission)", () => {
    const store = useMissionStore.getState();
    store.addBuilding(squareFootprint(40), 25);
    const inside = destinationPoint(CENTER[0], CENTER[1], 15, 45);
    store.addPoi(inside[0], inside[1]);
    expect(useMissionStore.getState().pendingOrbitParams).not.toBeNull();

    useMissionStore.getState().clearMission();

    expect(useMissionStore.getState().pendingOrbitParams).toBeNull();
  });
});

describe("missionStore — pendingPresetLoad", () => {
  beforeEach(() => {
    useMissionStore.getState().clearMission();
  });

  it("setPendingPresetLoad stores the type/params pair as-is", () => {
    const load = {
      type: "orbit" as const,
      params: {
        ...DEFAULT_ORBIT_PARAMS,
        center: [50, 14] as [number, number],
        radiusM: 60,
      },
    };
    useMissionStore.getState().setPendingPresetLoad(load);
    expect(useMissionStore.getState().pendingPresetLoad).toEqual(load);
  });

  it("clearMission resets pendingPresetLoad (same regression class as pendingOrbitParams)", () => {
    useMissionStore.getState().setPendingPresetLoad({
      type: "orbit",
      params: { ...DEFAULT_ORBIT_PARAMS, center: [50, 14], radiusM: 60 },
    });
    expect(useMissionStore.getState().pendingPresetLoad).not.toBeNull();

    useMissionStore.getState().clearMission();

    expect(useMissionStore.getState().pendingPresetLoad).toBeNull();
  });

  it("loadMission resets pendingPresetLoad", () => {
    useMissionStore.getState().setPendingPresetLoad({
      type: "orbit",
      params: { ...DEFAULT_ORBIT_PARAMS, center: [50, 14], radiusM: 60 },
    });

    useMissionStore.getState().loadMission({
      name: "Loaded mission",
      config: useMissionStore.getState().config,
      waypoints: [],
    });

    expect(useMissionStore.getState().pendingPresetLoad).toBeNull();
  });

  it("setPendingPresetLoad clears editingTemplateGroupId (regression: loading a preset must not silently overwrite the template currently open for editing)", () => {
    const store = useMissionStore.getState();
    store.appendWaypoints(
      [baseWaypoint(50, 14), baseWaypoint(50.001, 14)],
      [{ name: "Orbit center", latitude: 50, longitude: 14, height: 0 }],
      {
        type: "orbit",
        params: { ...DEFAULT_ORBIT_PARAMS, center: [50, 14], radiusM: 70 },
      },
    );
    const groupId = useMissionStore.getState().waypoints[0].templateGroupId!;
    store.setEditingTemplateGroupId(groupId);
    expect(useMissionStore.getState().editingTemplateGroupId).toBe(groupId);

    // Loading a different (or even same-type) saved preset must start a
    // fresh template, not continue replacing the group that was open for
    // editing — otherwise Apply would call replaceTemplateGroup on the
    // wrong content.
    useMissionStore.getState().setPendingPresetLoad({
      type: "orbit",
      params: { ...DEFAULT_ORBIT_PARAMS, center: [51, 15], radiusM: 40 },
    });

    expect(useMissionStore.getState().editingTemplateGroupId).toBeNull();
  });

  it("setPendingPresetLoad(null) does not disturb an unrelated editingTemplateGroupId", () => {
    const store = useMissionStore.getState();
    store.appendWaypoints(
      [baseWaypoint(50, 14), baseWaypoint(50.001, 14)],
      [{ name: "Orbit center", latitude: 50, longitude: 14, height: 0 }],
      {
        type: "orbit",
        params: { ...DEFAULT_ORBIT_PARAMS, center: [50, 14], radiusM: 70 },
      },
    );
    const groupId = useMissionStore.getState().waypoints[0].templateGroupId!;
    store.setEditingTemplateGroupId(groupId);

    useMissionStore.getState().setPendingPresetLoad(null);

    expect(useMissionStore.getState().editingTemplateGroupId).toBe(groupId);
  });
});
