import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  useMissionStore,
  DEFAULT_MISSION_NAME,
  peekMissionDraft,
  restoreMissionDraft,
  clearMissionDraft,
  type TemplateGroup,
  type MissionDraft,
} from "./missionStore";
import { useConfigStore } from "./configStore";
import { DEFAULT_ORBIT_PARAMS, destinationPoint } from "@/lib/templates";
import type { OrbitParams } from "@/lib/templates";

function mockGeocodeResponse(placeName: string) {
  return {
    ok: true,
    json: async () => ({ features: [{ place_name: placeName }] }),
  };
}

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

  it("loadMission restores templateGroups from the saved mission, so 'Edit template' keeps working after a save/reload round-trip", () => {
    const savedGroups: Record<string, TemplateGroup> = {
      "group-1": {
        type: "orbit",
        params: {
          ...DEFAULT_ORBIT_PARAMS,
          center: [50, 14],
          radiusM: 90,
        },
      },
    };

    useMissionStore.getState().loadMission({
      name: "Reloaded mission",
      config: useMissionStore.getState().config,
      waypoints: [
        {
          ...baseWaypoint(50, 14),
          index: 0,
          name: "Waypoint 1",
          templateGroupId: "group-1",
        },
      ],
      templateGroups: savedGroups,
    });

    expect(useMissionStore.getState().templateGroups).toEqual(savedGroups);
  });

  it("loadMission defaults templateGroups to an empty object when omitted (e.g. a KMZ import)", () => {
    useMissionStore.getState().loadMission({
      name: "Imported mission",
      config: useMissionStore.getState().config,
      waypoints: [],
    });

    expect(useMissionStore.getState().templateGroups).toEqual({});
  });

  it("loadMission sets missionClient from the saved mission's client field", () => {
    useMissionStore.getState().loadMission({
      name: "Client mission",
      client: "Acme s.r.o.",
      config: useMissionStore.getState().config,
      waypoints: [],
    });

    expect(useMissionStore.getState().missionClient).toBe("Acme s.r.o.");
  });

  it("loadMission defaults missionClient to an empty string when the mission has no client (null or omitted)", () => {
    useMissionStore.getState().loadMission({
      name: "No client",
      client: null,
      config: useMissionStore.getState().config,
      waypoints: [],
    });
    expect(useMissionStore.getState().missionClient).toBe("");

    useMissionStore.getState().loadMission({
      name: "Also no client",
      config: useMissionStore.getState().config,
      waypoints: [],
    });
    expect(useMissionStore.getState().missionClient).toBe("");
  });

  it("clearMission resets missionClient to an empty string (regression: a stale client tag must not leak into the next mission)", () => {
    useMissionStore.getState().loadMission({
      name: "Client mission",
      client: "Acme s.r.o.",
      config: useMissionStore.getState().config,
      waypoints: [],
    });
    expect(useMissionStore.getState().missionClient).toBe("Acme s.r.o.");

    useMissionStore.getState().clearMission();

    expect(useMissionStore.getState().missionClient).toBe("");
  });

  it("setMissionClient updates missionClient and marks the mission dirty", () => {
    useMissionStore.getState().clearMission();
    useMissionStore.getState().setDirty(false);

    useMissionStore.getState().setMissionClient("New Client");

    expect(useMissionStore.getState().missionClient).toBe("New Client");
    expect(useMissionStore.getState().dirty).toBe(true);
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

describe("missionStore — mission identity and address auto-naming", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    useMissionStore.getState().clearMission();
    useConfigStore.setState({ mapboxToken: "test-token" });
    vi.unstubAllGlobals();
  });

  it("clearMission and loadMission each bump missionGeneration", () => {
    const before = useMissionStore.getState().missionGeneration;

    useMissionStore.getState().clearMission();
    expect(useMissionStore.getState().missionGeneration).toBe(before + 1);

    useMissionStore.getState().loadMission({
      name: "Loaded mission",
      config: useMissionStore.getState().config,
      waypoints: [],
    });
    expect(useMissionStore.getState().missionGeneration).toBe(before + 2);
  });

  it("names a still-default mission after the address of its first waypoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockGeocodeResponse("Praha 4, Podjavorinské")),
    );

    useMissionStore.getState().addWaypoint(50.06, 14.43);
    await flush();

    expect(useMissionStore.getState().missionName).toBe(
      "Praha 4, Podjavorinské",
    );
  });

  it("does not overwrite a name the user already typed while the geocode request was in flight", async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      ),
    );

    useMissionStore.getState().addWaypoint(50.06, 14.43);
    useMissionStore.getState().setMissionName("Můj vlastní název");
    resolveFetch(mockGeocodeResponse("Praha 4, Podjavorinské"));
    await flush();

    expect(useMissionStore.getState().missionName).toBe("Můj vlastní název");
  });

  it("does not rename a different mission started while the geocode request for the previous one was in flight", async () => {
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      ),
    );

    useMissionStore.getState().addWaypoint(50.06, 14.43);
    // Abandon this mission (still unsaved, missionId stays null on both
    // sides) and start a fresh one before the first request resolves.
    useMissionStore.getState().clearMission();
    resolveFetch(mockGeocodeResponse("Praha 4, Podjavorinské"));
    await flush();

    expect(useMissionStore.getState().missionName).toBe(DEFAULT_MISSION_NAME);
  });

  it("does nothing for a waypoint that isn't the mission's first point", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockGeocodeResponse("Praha 4, Podjavorinské"));
    vi.stubGlobal("fetch", fetchMock);

    useMissionStore.getState().addWaypoint(50.06, 14.43);
    await flush();
    useMissionStore.getState().addWaypoint(50.061, 14.431);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("names a still-default mission from a template's first waypoint too (not just manual addWaypoint/addPoi)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockGeocodeResponse("Praha 4, Podjavorinské")),
    );

    // Mirrors an Orbit/Grid/Facade template applying to a brand-new mission
    // via appendWaypoints, rather than a manual map click.
    useMissionStore
      .getState()
      .appendWaypoints([
        baseWaypoint(50.06, 14.43),
        baseWaypoint(50.061, 14.431),
      ]);
    await flush();

    expect(useMissionStore.getState().missionName).toBe(
      "Praha 4, Podjavorinské",
    );
  });

  it("uses the template's POI (not its first waypoint) as the location when both are created together", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockGeocodeResponse("Praha 4, Podjavorinské"));
    vi.stubGlobal("fetch", fetchMock);

    useMissionStore
      .getState()
      .appendWaypoints(
        [baseWaypoint(50.06, 14.43)],
        [{ name: "Orbit center", latitude: 50.1, longitude: 14.5, height: 0 }],
      );
    await flush();

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("14.5,50.1");
  });
});

describe("missionStore — updateAllWaypoints", () => {
  beforeEach(() => {
    useMissionStore.getState().clearMission();
  });

  it("applies the given updates to every waypoint, regardless of selection", () => {
    useMissionStore.getState().appendWaypoints([
      { ...baseWaypoint(50, 14), useGlobalSpeed: false, speed: 3 },
      { ...baseWaypoint(50.001, 14), useGlobalSpeed: false, speed: 4 },
    ]);
    // Only select the first waypoint — updateAllWaypoints must still touch both.
    useMissionStore.getState().selectWaypoint(0);

    useMissionStore.getState().updateAllWaypoints({ useGlobalSpeed: true });

    const { waypoints } = useMissionStore.getState();
    expect(waypoints.every((wp) => wp.useGlobalSpeed)).toBe(true);
  });

  it("marks the mission dirty", () => {
    useMissionStore.getState().appendWaypoints([baseWaypoint(50, 14)]);
    useMissionStore.setState({ dirty: false });

    useMissionStore.getState().updateAllWaypoints({ useGlobalSpeed: true });

    expect(useMissionStore.getState().dirty).toBe(true);
  });
});

describe("missionStore — setWaypointHeights", () => {
  beforeEach(() => {
    useMissionStore.getState().clearMission();
  });

  it("sets each waypoint's height individually from the given index map", () => {
    useMissionStore.getState().appendWaypoints([
      { ...baseWaypoint(50, 14), height: 30 },
      { ...baseWaypoint(50.001, 14), height: 30 },
      { ...baseWaypoint(50.002, 14), height: 30 },
    ]);

    useMissionStore.getState().setWaypointHeights({ 0: 45, 2: 60 });

    const { waypoints } = useMissionStore.getState();
    expect(waypoints[0].height).toBe(45);
    expect(waypoints[1].height).toBe(30); // untouched — not in the map
    expect(waypoints[2].height).toBe(60);
  });

  it("marks the mission dirty", () => {
    useMissionStore.getState().appendWaypoints([baseWaypoint(50, 14)]);
    useMissionStore.setState({ dirty: false });

    useMissionStore.getState().setWaypointHeights({ 0: 50 });

    expect(useMissionStore.getState().dirty).toBe(true);
  });

  it("is a no-op when the map is empty", () => {
    useMissionStore
      .getState()
      .appendWaypoints([{ ...baseWaypoint(50, 14), height: 30 }]);

    useMissionStore.getState().setWaypointHeights({});

    expect(useMissionStore.getState().waypoints[0].height).toBe(30);
  });
});

describe("missionStore — pasteActionsToSelected", () => {
  beforeEach(() => {
    useMissionStore.getState().clearMission();
  });

  it("replaces every selected waypoint's actions with an independent clone of the given list", () => {
    useMissionStore
      .getState()
      .appendWaypoints([
        baseWaypoint(50, 14),
        baseWaypoint(50.001, 14),
        baseWaypoint(50.002, 14),
      ]);
    useMissionStore.getState().selectWaypoint(0);
    useMissionStore.getState().selectWaypoint(2, "toggle");

    const clipboard = [
      { actionId: 5, actionType: "hover" as const, params: { hoverTime: 3 } },
    ];
    useMissionStore.getState().pasteActionsToSelected(clipboard);

    const { waypoints } = useMissionStore.getState();
    expect(waypoints[0].actions).toEqual([
      { actionId: 0, actionType: "hover", params: { hoverTime: 3 } },
    ]);
    expect(waypoints[1].actions).toEqual([]); // not selected — untouched
    expect(waypoints[2].actions).toEqual([
      { actionId: 0, actionType: "hover", params: { hoverTime: 3 } },
    ]);

    // Each waypoint gets its own array/object instances, not a shared
    // reference — mutating one must never affect the other.
    expect(waypoints[0].actions).not.toBe(waypoints[2].actions);
  });

  it("marks the mission dirty", () => {
    useMissionStore.getState().appendWaypoints([baseWaypoint(50, 14)]);
    useMissionStore.getState().selectWaypoint(0);
    useMissionStore.setState({ dirty: false });

    useMissionStore
      .getState()
      .pasteActionsToSelected([
        { actionId: 0, actionType: "hover", params: { hoverTime: 1 } },
      ]);

    expect(useMissionStore.getState().dirty).toBe(true);
  });
});

describe("missionStore — interpolateBetween", () => {
  beforeEach(() => {
    useMissionStore.getState().clearMission();
  });

  it("inserts N evenly-spaced waypoints between two adjacent ones, interpolating position and height", () => {
    useMissionStore.getState().appendWaypoints([
      { ...baseWaypoint(50, 14), height: 20 },
      { ...baseWaypoint(50.004, 14), height: 60 },
    ]);

    useMissionStore.getState().interpolateBetween(0, 1, 3);

    const { waypoints } = useMissionStore.getState();
    expect(waypoints).toHaveLength(5);
    expect(waypoints.map((wp) => wp.index)).toEqual([0, 1, 2, 3, 4]);

    // Original endpoints preserved at the ends.
    expect(waypoints[0].latitude).toBe(50);
    expect(waypoints[4].latitude).toBeCloseTo(50.004, 6);

    // 3 inserted points at t = 0.25, 0.5, 0.75 of the way from 20 to 60.
    expect(waypoints[1].height).toBeCloseTo(30, 5);
    expect(waypoints[2].height).toBeCloseTo(40, 5);
    expect(waypoints[3].height).toBeCloseTo(50, 5);

    // Latitude increases monotonically along the interpolated points too.
    expect(waypoints[1].latitude).toBeLessThan(waypoints[2].latitude);
    expect(waypoints[2].latitude).toBeLessThan(waypoints[3].latitude);
  });

  it("accepts indices in either order", () => {
    useMissionStore
      .getState()
      .appendWaypoints([baseWaypoint(50, 14), baseWaypoint(50.001, 14)]);

    useMissionStore.getState().interpolateBetween(1, 0, 1);

    expect(useMissionStore.getState().waypoints).toHaveLength(3);
  });

  it("is a no-op when the two indices aren't adjacent", () => {
    useMissionStore
      .getState()
      .appendWaypoints([
        baseWaypoint(50, 14),
        baseWaypoint(50.001, 14),
        baseWaypoint(50.002, 14),
      ]);

    useMissionStore.getState().interpolateBetween(0, 2, 1);

    expect(useMissionStore.getState().waypoints).toHaveLength(3);
  });

  it("selects the newly inserted waypoints", () => {
    useMissionStore
      .getState()
      .appendWaypoints([baseWaypoint(50, 14), baseWaypoint(50.001, 14)]);

    useMissionStore.getState().interpolateBetween(0, 1, 2);

    const { selectedWaypointIndices } = useMissionStore.getState();
    expect(selectedWaypointIndices).toEqual(new Set([1, 2]));
  });

  it("new waypoints carry no actions and no template-group tag", () => {
    useMissionStore
      .getState()
      .appendWaypoints([baseWaypoint(50, 14), baseWaypoint(50.001, 14)]);
    useMissionStore.getState().addAction(0, {
      actionId: 0,
      actionType: "hover",
      params: { hoverTime: 5 },
    });

    useMissionStore.getState().interpolateBetween(0, 1, 1);

    expect(useMissionStore.getState().waypoints[1].actions).toEqual([]);
    expect(
      useMissionStore.getState().waypoints[1].templateGroupId,
    ).toBeUndefined();
  });
});

describe("missionStore — reverseWaypoints", () => {
  beforeEach(() => {
    useMissionStore.getState().clearMission();
  });

  it("flips the flying order and re-indexes sequentially", () => {
    useMissionStore.getState().appendWaypoints([
      { ...baseWaypoint(50, 14), height: 10 },
      { ...baseWaypoint(50.001, 14), height: 20 },
      { ...baseWaypoint(50.002, 14), height: 30 },
    ]);

    useMissionStore.getState().reverseWaypoints();

    const { waypoints } = useMissionStore.getState();
    expect(waypoints.map((wp) => wp.height)).toEqual([30, 20, 10]);
    expect(waypoints.map((wp) => wp.index)).toEqual([0, 1, 2]);
  });

  it("clears the waypoint selection", () => {
    useMissionStore
      .getState()
      .appendWaypoints([
        { ...baseWaypoint(50, 14) },
        { ...baseWaypoint(50.001, 14) },
      ]);
    useMissionStore.getState().selectWaypoint(0);

    useMissionStore.getState().reverseWaypoints();

    expect(useMissionStore.getState().selectedWaypointIndices.size).toBe(0);
  });

  it("marks the mission dirty", () => {
    useMissionStore
      .getState()
      .appendWaypoints([baseWaypoint(50, 14), baseWaypoint(50.001, 14)]);
    useMissionStore.setState({ dirty: false });

    useMissionStore.getState().reverseWaypoints();

    expect(useMissionStore.getState().dirty).toBe(true);
  });

  it("is a no-op for fewer than 2 waypoints", () => {
    useMissionStore.getState().appendWaypoints([baseWaypoint(50, 14)]);

    useMissionStore.getState().reverseWaypoints();

    expect(useMissionStore.getState().waypoints).toHaveLength(1);
  });
});

describe("missionStore — offsetMission", () => {
  beforeEach(() => {
    useMissionStore.getState().clearMission();
  });

  it("shifts every waypoint, POI, obstacle, and building by the same offset", () => {
    useMissionStore.getState().appendWaypoints([baseWaypoint(50, 14)]);
    useMissionStore.getState().addPoi(50, 14);
    useMissionStore.getState().addObstacle([
      [50, 14],
      [50.001, 14],
      [50.001, 14.001],
    ]);
    useMissionStore.getState().addBuilding(
      [
        [50, 14],
        [50.001, 14],
        [50.001, 14.001],
      ],
      10,
    );

    useMissionStore.getState().offsetMission(100, 0);

    const state = useMissionStore.getState();
    expect(state.waypoints[0].latitude).toBeGreaterThan(50);
    expect(state.pois[0].latitude).toBeGreaterThan(50);
    expect(state.obstacles[0].vertices[0][0]).toBeGreaterThan(50);
    expect(state.buildings[0].vertices[0][0]).toBeGreaterThan(50);
  });

  it("does not change height", () => {
    useMissionStore
      .getState()
      .appendWaypoints([{ ...baseWaypoint(50, 14), height: 42 }]);

    useMissionStore.getState().offsetMission(100, 50);

    expect(useMissionStore.getState().waypoints[0].height).toBe(42);
  });

  it("marks the mission dirty", () => {
    useMissionStore.getState().appendWaypoints([baseWaypoint(50, 14)]);
    useMissionStore.setState({ dirty: false });

    useMissionStore.getState().offsetMission(10, 10);

    expect(useMissionStore.getState().dirty).toBe(true);
  });

  it("is a no-op on a completely empty mission", () => {
    useMissionStore.getState().offsetMission(100, 100);

    expect(useMissionStore.getState().waypoints).toHaveLength(0);
  });
});

describe("missionStore — rotateMission", () => {
  beforeEach(() => {
    useMissionStore.getState().clearMission();
  });

  it("rotates waypoints, POIs, obstacles, and buildings around the waypoint centroid", () => {
    useMissionStore
      .getState()
      .appendWaypoints([baseWaypoint(50, 14), baseWaypoint(50.002, 14)]);
    useMissionStore.getState().addPoi(50, 14);
    useMissionStore.getState().addObstacle([
      [50, 14],
      [50.001, 14],
      [50.001, 14.001],
    ]);

    const before = useMissionStore.getState().waypoints[0].longitude;
    useMissionStore.getState().rotateMission(90);
    const after = useMissionStore.getState().waypoints[0].longitude;

    // A 90° rotation around the centroid must move at least one waypoint's
    // longitude — a no-op rotation would leave everything untouched.
    expect(after).not.toBeCloseTo(before, 6);
  });

  it("a 0° rotation leaves everything unchanged", () => {
    useMissionStore
      .getState()
      .appendWaypoints([baseWaypoint(50, 14), baseWaypoint(50.002, 14.001)]);
    const before = useMissionStore
      .getState()
      .waypoints.map((wp) => [wp.latitude, wp.longitude]);

    useMissionStore.getState().rotateMission(0);

    const after = useMissionStore
      .getState()
      .waypoints.map((wp) => [wp.latitude, wp.longitude]);
    expect(after).toEqual(before);
  });

  it("marks the mission dirty", () => {
    useMissionStore
      .getState()
      .appendWaypoints([baseWaypoint(50, 14), baseWaypoint(50.001, 14)]);
    useMissionStore.setState({ dirty: false });

    useMissionStore.getState().rotateMission(45);

    expect(useMissionStore.getState().dirty).toBe(true);
  });

  it("is a no-op when there are no waypoints", () => {
    useMissionStore.getState().rotateMission(45);

    expect(useMissionStore.getState().waypoints).toHaveLength(0);
  });
});

describe("missionStore — undo/redo history", () => {
  beforeEach(() => {
    useMissionStore.getState().clearMission();
  });

  it("undo reverts the last content change and redo re-applies it", () => {
    useMissionStore.getState().appendWaypoints([baseWaypoint(50, 14)]);
    expect(useMissionStore.getState().waypoints).toHaveLength(1);

    useMissionStore.temporal.getState().undo();
    expect(useMissionStore.getState().waypoints).toHaveLength(0);

    useMissionStore.temporal.getState().redo();
    expect(useMissionStore.getState().waypoints).toHaveLength(1);
  });

  it("does not record a history entry for selection-only changes", () => {
    useMissionStore
      .getState()
      .appendWaypoints([baseWaypoint(50, 14), baseWaypoint(50.001, 14)]);
    const pastCountAfterContent =
      useMissionStore.temporal.getState().pastStates.length;

    useMissionStore.getState().selectWaypoint(1);

    expect(useMissionStore.temporal.getState().pastStates.length).toBe(
      pastCountAfterContent,
    );
  });

  it("clears history when a mission is loaded or cleared", () => {
    useMissionStore.getState().appendWaypoints([baseWaypoint(50, 14)]);
    expect(
      useMissionStore.temporal.getState().pastStates.length,
    ).toBeGreaterThan(0);

    useMissionStore.getState().clearMission();

    expect(useMissionStore.temporal.getState().pastStates.length).toBe(0);
    expect(useMissionStore.temporal.getState().futureStates.length).toBe(0);
  });
});

describe("missionStore — autosave draft", () => {
  const memoryStorage = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryStorage.set(key, value);
    },
    removeItem: (key: string) => {
      memoryStorage.delete(key);
    },
  };

  beforeEach(() => {
    useMissionStore.getState().clearMission();
    memoryStorage.clear();
    vi.stubGlobal("localStorage", mockLocalStorage);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not autosave a still-empty mission", () => {
    // setDirty alone leaves every content field's reference unchanged, which
    // the subscriber's own no-op check already short-circuits on — that
    // would make this test pass without ever exercising the *inner*
    // still-empty guard inside the debounced callback. Change missionName
    // instead: it passes the subscriber's reference check and schedules the
    // timer, so the assertion below actually depends on the empty-mission
    // guard, not just on the timer never having been armed.
    useMissionStore.getState().setMissionName("Prázdná mise");
    vi.advanceTimersByTime(3000);

    expect(peekMissionDraft()).toBeNull();
  });

  it("autosaves after the debounce once the mission has content", () => {
    useMissionStore.getState().appendWaypoints([baseWaypoint(50, 14)]);
    vi.advanceTimersByTime(2100);

    const draft = peekMissionDraft();
    expect(draft).not.toBeNull();
    expect(draft?.waypoints).toHaveLength(1);
  });

  it("restoreMissionDraft loads the draft as the active mission and clears it", () => {
    useMissionStore.getState().appendWaypoints([baseWaypoint(50, 14)]);
    vi.advanceTimersByTime(2100);
    const draft = peekMissionDraft() as MissionDraft;
    expect(draft).not.toBeNull();

    useMissionStore.getState().clearMission();
    expect(useMissionStore.getState().waypoints).toHaveLength(0);

    restoreMissionDraft(draft);

    expect(useMissionStore.getState().waypoints).toHaveLength(1);
    expect(useMissionStore.getState().dirty).toBe(true);
    expect(peekMissionDraft()).toBeNull();
  });

  it("clearMissionDraft discards the pending draft", () => {
    useMissionStore.getState().appendWaypoints([baseWaypoint(50, 14)]);
    vi.advanceTimersByTime(2100);
    expect(peekMissionDraft()).not.toBeNull();

    clearMissionDraft();

    expect(peekMissionDraft()).toBeNull();
  });
});
