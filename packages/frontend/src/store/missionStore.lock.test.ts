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

function square(lat: number, lng: number, sideM: number): [number, number][] {
  const north = destinationPoint(lat, lng, sideM / 2, 0)[0];
  const south = destinationPoint(lat, lng, -sideM / 2, 0)[0];
  const east = destinationPoint(lat, lng, sideM / 2, 90)[1];
  const west = destinationPoint(lat, lng, sideM / 2, 270)[1];
  return [
    [north, west],
    [north, east],
    [south, east],
    [south, west],
  ];
}

describe("missionStore — waypoint locks", () => {
  beforeEach(() => {
    useMissionStore.getState().clearMission();
  });

  it("toggleWaypointLock flips a single waypoint's lock", () => {
    useMissionStore
      .getState()
      .appendWaypoints([baseWaypoint(50, 14), baseWaypoint(50.001, 14)]);

    useMissionStore.getState().toggleWaypointLock(0);
    expect(useMissionStore.getState().waypoints[0].locked).toBe(true);
    expect(useMissionStore.getState().waypoints[1].locked).toBeFalsy();

    useMissionStore.getState().toggleWaypointLock(0);
    expect(useMissionStore.getState().waypoints[0].locked).toBe(false);
  });

  it("setWaypointsLocked locks a whole selected range at once", () => {
    useMissionStore
      .getState()
      .appendWaypoints([
        baseWaypoint(50, 14),
        baseWaypoint(50.001, 14),
        baseWaypoint(50.002, 14),
      ]);

    useMissionStore.getState().setWaypointsLocked([0, 1], true);
    const { waypoints } = useMissionStore.getState();
    expect(waypoints.map((wp) => Boolean(wp.locked))).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("offsetMission leaves locked waypoints where they are", () => {
    useMissionStore
      .getState()
      .appendWaypoints([baseWaypoint(50, 14), baseWaypoint(50.001, 14)]);
    useMissionStore.getState().setWaypointsLocked([0], true);

    useMissionStore.getState().offsetMission(100, 0);
    const { waypoints } = useMissionStore.getState();
    expect(waypoints[0].latitude).toBe(50);
    expect(waypoints[1].latitude).toBeGreaterThan(50.001);
  });

  it("rotateMission leaves locked waypoints where they are", () => {
    useMissionStore
      .getState()
      .appendWaypoints([
        baseWaypoint(50, 14),
        baseWaypoint(50.002, 14),
        baseWaypoint(50.001, 14.002),
      ]);
    useMissionStore.getState().setWaypointsLocked([0], true);
    const before = { ...useMissionStore.getState().waypoints[0] };

    useMissionStore.getState().rotateMission(90);
    const after = useMissionStore.getState().waypoints[0];
    expect(after.latitude).toBe(before.latitude);
    expect(after.longitude).toBe(before.longitude);
  });

  it("replaceTemplateGroup keeps locked waypoints at their old position, by order", () => {
    const params: OrbitParams = {
      ...DEFAULT_ORBIT_PARAMS,
      center: [50, 14],
      radiusM: 70,
    };
    useMissionStore
      .getState()
      .appendWaypoints(
        [
          baseWaypoint(50, 14),
          baseWaypoint(50.001, 14),
          baseWaypoint(50.002, 14),
        ],
        [],
        { type: "orbit", params },
      );
    const groupId = Object.keys(useMissionStore.getState().templateGroups)[0];
    useMissionStore.getState().setWaypointsLocked([0, 1], true);
    const locked = useMissionStore
      .getState()
      .waypoints.slice(0, 2)
      .map((wp) => ({ lat: wp.latitude, lng: wp.longitude }));

    useMissionStore
      .getState()
      .replaceTemplateGroup(
        groupId,
        [
          baseWaypoint(51, 15),
          baseWaypoint(51.001, 15),
          baseWaypoint(51.002, 15),
        ],
        [],
        params,
      );

    const { waypoints } = useMissionStore.getState();
    expect(waypoints).toHaveLength(3);
    expect(waypoints[0].latitude).toBe(locked[0].lat);
    expect(waypoints[1].latitude).toBe(locked[1].lat);
    expect(waypoints[0].locked).toBe(true);
    // The third, unlocked slot took the regenerated position.
    expect(waypoints[2].latitude).toBeCloseTo(51.002, 6);
    expect(waypoints.map((wp) => wp.index)).toEqual([0, 1, 2]);
  });

  it("replaceTemplateGroup keeps every locked waypoint even when the new group is shorter", () => {
    const params: OrbitParams = {
      ...DEFAULT_ORBIT_PARAMS,
      center: [50, 14],
      radiusM: 70,
    };
    useMissionStore
      .getState()
      .appendWaypoints(
        [
          baseWaypoint(50, 14),
          baseWaypoint(50.001, 14),
          baseWaypoint(50.002, 14),
        ],
        [],
        { type: "orbit", params },
      );
    const groupId = Object.keys(useMissionStore.getState().templateGroups)[0];
    useMissionStore.getState().setWaypointsLocked([0, 1, 2], true);

    useMissionStore
      .getState()
      .replaceTemplateGroup(groupId, [baseWaypoint(51, 15)], [], params);

    expect(useMissionStore.getState().waypoints).toHaveLength(3);
    expect(useMissionStore.getState().waypoints.every((wp) => wp.locked)).toBe(
      true,
    );
  });
});

describe("missionStore — building reflow", () => {
  beforeEach(() => {
    useMissionStore.getState().clearMission();
  });

  function seedBuildingMission() {
    useMissionStore.getState().addBuilding(square(50.06, 14.43, 40), 30);
    const buildingId = useMissionStore.getState().buildings[0].id;
    useMissionStore
      .getState()
      .appendWaypoints([
        baseWaypoint(50.0605, 14.4305),
        baseWaypoint(50.0595, 14.4295),
      ]);
    return buildingId;
  }

  it("captures a baseline the first time a building's geometry changes", () => {
    const id = seedBuildingMission();
    expect(useMissionStore.getState().pendingBuildingEdit).toBeNull();

    useMissionStore.getState().moveBuildingVertex(id, 0, 50.0612, 14.4292);
    const pending = useMissionStore.getState().pendingBuildingEdit;
    expect(pending?.buildingId).toBe(id);
    expect(pending?.vertices).toEqual(square(50.06, 14.43, 40));
    expect(pending?.height).toBe(30);
  });

  it("keeps the original baseline across a whole drag", () => {
    const id = seedBuildingMission();
    const original = square(50.06, 14.43, 40);

    useMissionStore.getState().moveBuildingVertex(id, 0, 50.0612, 14.4292);
    useMissionStore.getState().moveBuildingVertex(id, 0, 50.0615, 14.429);
    useMissionStore.getState().moveBuildingVertex(id, 0, 50.062, 14.4285);

    expect(useMissionStore.getState().pendingBuildingEdit?.vertices).toEqual(
      original,
    );
  });

  it("ignores edits that do not touch the footprint or height", () => {
    const id = seedBuildingMission();
    useMissionStore.getState().updateBuilding(id, { name: "Hala A" });
    expect(useMissionStore.getState().pendingBuildingEdit).toBeNull();
  });

  it("does not arm a reflow when the mission has no waypoints", () => {
    useMissionStore.getState().addBuilding(square(50.06, 14.43, 40), 30);
    const id = useMissionStore.getState().buildings[0].id;
    useMissionStore.getState().moveBuildingVertex(id, 0, 50.0612, 14.4292);
    expect(useMissionStore.getState().pendingBuildingEdit).toBeNull();
  });

  it("applyBuildingReflow moves the given waypoints and clears the pending edit", () => {
    const id = seedBuildingMission();
    useMissionStore.getState().moveBuildingVertex(id, 0, 50.0612, 14.4292);

    useMissionStore
      .getState()
      .applyBuildingReflow([{ index: 1, latitude: 50.05, longitude: 14.42 }]);

    const { waypoints, pendingBuildingEdit } = useMissionStore.getState();
    expect(waypoints[0].latitude).toBe(50.0605);
    expect(waypoints[1].latitude).toBe(50.05);
    expect(waypoints[1].longitude).toBe(14.42);
    expect(pendingBuildingEdit).toBeNull();
  });

  it("applyBuildingReflow refuses to move a locked waypoint", () => {
    const id = seedBuildingMission();
    useMissionStore.getState().setWaypointsLocked([1], true);
    useMissionStore.getState().moveBuildingVertex(id, 0, 50.0612, 14.4292);

    useMissionStore
      .getState()
      .applyBuildingReflow([{ index: 1, latitude: 50.05, longitude: 14.42 }]);

    expect(useMissionStore.getState().waypoints[1].latitude).toBe(50.0595);
  });

  it("dismissBuildingReflow keeps the new footprint and leaves waypoints alone", () => {
    const id = seedBuildingMission();
    useMissionStore.getState().moveBuildingVertex(id, 0, 50.0612, 14.4292);

    useMissionStore.getState().dismissBuildingReflow();

    expect(useMissionStore.getState().pendingBuildingEdit).toBeNull();
    expect(useMissionStore.getState().waypoints[1].latitude).toBe(50.0595);
    expect(useMissionStore.getState().buildings[0].vertices[0]).toEqual([
      50.0612, 14.4292,
    ]);
  });

  it("re-arms after a dismissal when the building is edited again", () => {
    const id = seedBuildingMission();
    useMissionStore.getState().moveBuildingVertex(id, 0, 50.0612, 14.4292);
    useMissionStore.getState().dismissBuildingReflow();

    useMissionStore.getState().moveBuildingVertex(id, 1, 50.0613, 14.4312);
    expect(useMissionStore.getState().pendingBuildingEdit?.vertices[0]).toEqual(
      [50.0612, 14.4292],
    );
  });

  it("switching to a different building starts a fresh baseline", () => {
    const first = seedBuildingMission();
    useMissionStore.getState().addBuilding(square(50.07, 14.44, 40), 20);
    const second = useMissionStore.getState().buildings[1].id;

    useMissionStore.getState().moveBuildingVertex(first, 0, 50.0612, 14.4292);
    useMissionStore.getState().moveBuildingVertex(second, 0, 50.0712, 14.4392);

    const pending = useMissionStore.getState().pendingBuildingEdit;
    expect(pending?.buildingId).toBe(second);
    expect(pending?.height).toBe(20);
  });

  it("removing the building drops its pending reflow", () => {
    const id = seedBuildingMission();
    useMissionStore.getState().moveBuildingVertex(id, 0, 50.0612, 14.4292);
    useMissionStore.getState().removeBuilding(id);
    expect(useMissionStore.getState().pendingBuildingEdit).toBeNull();
  });
});
