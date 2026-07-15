import { create } from "zustand";
import type {
  Waypoint,
  MissionConfig,
  WaypointAction,
  PointOfInterest,
  Obstacle,
  Building,
} from "@droneroute/shared";
import { DEFAULT_MISSION_CONFIG, DEFAULT_WAYPOINT } from "@droneroute/shared";
import { usePreferencesStore } from "@/store/preferencesStore";
import { useConfigStore } from "@/store/configStore";
import type {
  TemplateType,
  TemplateParams,
  OrbitParams,
} from "@/lib/templates";
import { orbitParamsForBuilding } from "@/lib/templates";
import { WIDE_CAMERA_FOV } from "@/lib/solarCamera";
import { pointInPolygon } from "@/lib/geo";

export type SelectionMode = "replace" | "toggle" | "range";

/** Name given to every new mission until it's renamed or auto-named from an address. */
export const DEFAULT_MISSION_NAME = "Nová mise";

export interface TemplateGroup {
  type: TemplateType;
  params: TemplateParams;
}

interface MissionState {
  // Mission metadata
  missionId: string | null;
  missionName: string;
  dirty: boolean;
  /** Bumped whenever the current mission is replaced wholesale (new/clear/load) — lets an in-flight async task (e.g. auto-naming) detect it's now stale even when missionId itself is null on both sides. */
  missionGeneration: number;

  // Config
  config: MissionConfig;

  // Waypoints
  waypoints: Waypoint[];
  selectedWaypointIndices: Set<number>;
  lastSelectedWaypointIndex: number | null;

  // POIs
  pois: PointOfInterest[];
  selectedPoiId: string | null;

  // Obstacles
  obstacles: Obstacle[];
  selectedObstacleId: string | null;
  isDrawingObstacle: boolean;
  drawingVertices: [number, number][];

  // Buildings
  buildings: Building[];
  selectedBuildingId: string | null;
  isDrawingBuilding: boolean;
  buildingDrawMode: "rectangle" | "polygon";
  drawingBuildingVertices: [number, number][];

  // UI state
  isAddingWaypoint: boolean;
  isAddingPoi: boolean;
  templateMode: TemplateType | null;
  /** Set to pan/zoom the map to a [lat, lng], e.g. after a location search. */
  flyToTarget: [number, number] | null;
  setFlyToTarget: (target: [number, number] | null) => void;
  /** Seeded when a POI is placed on a building — TemplateDrawHandler opens the Orbit panel pre-filled with these values instead of an empty drag gesture. */
  pendingOrbitParams: OrbitParams | null;
  setPendingOrbitParams: (params: OrbitParams | null) => void;
  /** Set to load a saved template preset directly into its config panel (confirmed, skipping the draw gesture) — works for any of the 5 template types. */
  pendingPresetLoad: { type: TemplateType; params: TemplateParams } | null;
  setPendingPresetLoad: (
    load: { type: TemplateType; params: TemplateParams } | null,
  ) => void;
  /** Params of every applied template, keyed by the id tagged onto its waypoints/POIs — lets a template be reopened and edited after Apply instead of only being addable once. */
  templateGroups: Record<string, TemplateGroup>;
  /** Set to reopen a template's config panel for editing (see BulkActionToolbar's "Edit template"). */
  editingTemplateGroupId: string | null;
  setEditingTemplateGroupId: (id: string | null) => void;
  currentPage: "editor" | "routes" | "shared" | "admin";
  shareToken: string | null;
  setCurrentPage: (page: "editor" | "routes" | "shared" | "admin") => void;
  setShareToken: (token: string | null) => void;

  // Waypoint actions
  setMissionName: (name: string) => void;
  setMissionId: (id: string | null) => void;
  setConfig: (config: Partial<MissionConfig>) => void;
  addWaypoint: (lat: number, lng: number) => void;
  updateWaypoint: (index: number, updates: Partial<Waypoint>) => void;
  removeWaypoint: (index: number) => void;
  moveWaypoint: (index: number, lat: number, lng: number) => void;
  selectWaypoint: (index: number | null, mode?: SelectionMode) => void;
  selectAllWaypoints: () => void;
  clearWaypointSelection: () => void;
  removeSelectedWaypoints: () => void;
  updateSelectedWaypoints: (updates: Partial<Waypoint>) => void;
  reorderWaypoints: (fromIndex: number, toIndex: number) => void;
  setIsAddingWaypoint: (adding: boolean) => void;
  addAction: (waypointIndex: number, action: WaypointAction) => void;
  updateAction: (
    waypointIndex: number,
    actionId: number,
    updates: Partial<WaypointAction>,
  ) => void;
  removeAction: (waypointIndex: number, actionId: number) => void;

  // POI actions
  addPoi: (lat: number, lng: number) => void;
  updatePoi: (id: string, updates: Partial<PointOfInterest>) => void;
  removePoi: (id: string) => void;
  movePoi: (id: string, lat: number, lng: number) => void;
  selectPoi: (id: string | null) => void;
  setIsAddingPoi: (adding: boolean) => void;
  setTemplateMode: (mode: TemplateType | null) => void;
  appendWaypoints: (
    waypoints: Omit<Waypoint, "index" | "name">[],
    pois?: Omit<PointOfInterest, "id">[],
    templateGroup?: TemplateGroup,
  ) => void;
  /** Removes a previously-applied template's waypoints/POIs and replaces them with a freshly regenerated set — used when editing an already-applied template instead of appending a duplicate. */
  replaceTemplateGroup: (
    groupId: string,
    waypoints: Omit<Waypoint, "index" | "name">[],
    pois: Omit<PointOfInterest, "id">[],
    params: TemplateParams,
  ) => void;

  // Obstacle actions
  addObstacle: (vertices: [number, number][]) => void;
  updateObstacle: (id: string, updates: Partial<Obstacle>) => void;
  removeObstacle: (id: string) => void;
  moveObstacleVertex: (
    id: string,
    vertexIndex: number,
    lat: number,
    lng: number,
  ) => void;
  addObstacleVertex: (
    id: string,
    afterIndex: number,
    lat: number,
    lng: number,
  ) => void;
  removeObstacleVertex: (id: string, vertexIndex: number) => void;
  selectObstacle: (id: string | null) => void;
  setIsDrawingObstacle: (drawing: boolean) => void;
  setDrawingVertices: (vertices: [number, number][]) => void;

  // Building actions
  addBuilding: (vertices: [number, number][], height: number) => void;
  updateBuilding: (id: string, updates: Partial<Building>) => void;
  removeBuilding: (id: string) => void;
  moveBuildingVertex: (
    id: string,
    vertexIndex: number,
    lat: number,
    lng: number,
  ) => void;
  addBuildingVertex: (
    id: string,
    afterIndex: number,
    lat: number,
    lng: number,
  ) => void;
  removeBuildingVertex: (id: string, vertexIndex: number) => void;
  selectBuilding: (id: string | null) => void;
  setIsDrawingBuilding: (drawing: boolean) => void;
  setBuildingDrawMode: (mode: "rectangle" | "polygon") => void;
  setDrawingBuildingVertices: (vertices: [number, number][]) => void;

  // Mission actions
  loadMission: (data: {
    id?: string;
    name: string;
    config: MissionConfig;
    waypoints: Waypoint[];
    pois?: PointOfInterest[];
    obstacles?: Obstacle[];
    buildings?: Building[];
    templateGroups?: Record<string, TemplateGroup>;
  }) => void;
  clearMission: () => void;
  setDirty: (dirty: boolean) => void;
}

export const useMissionStore = create<MissionState>((set, get) => ({
  missionId: null,
  missionGeneration: 0,
  missionName: DEFAULT_MISSION_NAME,
  dirty: false,
  config: { ...DEFAULT_MISSION_CONFIG },
  waypoints: [],
  selectedWaypointIndices: new Set<number>(),
  lastSelectedWaypointIndex: null,
  pois: [],
  selectedPoiId: null,
  obstacles: [],
  selectedObstacleId: null,
  isDrawingObstacle: false,
  drawingVertices: [],
  buildings: [],
  selectedBuildingId: null,
  isDrawingBuilding: false,
  buildingDrawMode: "rectangle",
  drawingBuildingVertices: [],
  isAddingWaypoint: true,
  isAddingPoi: false,
  templateMode: null,
  flyToTarget: null,
  setFlyToTarget: (target) => set({ flyToTarget: target }),
  pendingOrbitParams: null,
  setPendingOrbitParams: (params) => set({ pendingOrbitParams: params }),
  pendingPresetLoad: null,
  setPendingPresetLoad: (load) =>
    set((state) => ({
      pendingPresetLoad: load,
      // Loading a preset always means "start a fresh template," never
      // "continue editing the one currently open" — without this, loading
      // a same-type preset while "Edit template" is active would silently
      // overwrite the group being edited on Apply (handleApply branches on
      // editingTemplateGroupId to call replaceTemplateGroup instead of
      // appendWaypoints). Centralized here so every caller gets this for
      // free instead of having to remember to clear it themselves.
      editingTemplateGroupId: load ? null : state.editingTemplateGroupId,
    })),
  templateGroups: {},
  editingTemplateGroupId: null,
  setEditingTemplateGroupId: (id) => set({ editingTemplateGroupId: id }),
  currentPage: "editor",
  shareToken: null,
  setCurrentPage: (page) => set({ currentPage: page }),
  setShareToken: (token) => set({ shareToken: token }),

  setMissionName: (name) => set({ missionName: name, dirty: true }),
  setMissionId: (id) => set({ missionId: id }),

  setConfig: (updates) =>
    set((state) => ({
      config: { ...state.config, ...updates },
      dirty: true,
    })),

  addWaypoint: (lat, lng) => {
    const isFirstPointOfMission =
      get().waypoints.length === 0 && get().pois.length === 0;
    const generation = get().missionGeneration;
    set((state) => {
      const index = state.waypoints.length;
      const newWaypoint: Waypoint = {
        ...DEFAULT_WAYPOINT,
        index,
        name: `Bod trasy ${index + 1}`,
        latitude: lat,
        longitude: lng,
        actions: [],
      };
      return {
        waypoints: [...state.waypoints, newWaypoint],
        selectedWaypointIndices: new Set([index]),
        lastSelectedWaypointIndex: index,
        dirty: true,
      };
    });
    if (isFirstPointOfMission) {
      void autoNameFromLocation(lat, lng, generation);
    }
  },

  updateWaypoint: (index, updates) =>
    set((state) => ({
      waypoints: state.waypoints.map((wp) =>
        wp.index === index ? { ...wp, ...updates } : wp,
      ),
      dirty: true,
    })),

  removeWaypoint: (index) =>
    set((state) => {
      const filtered = state.waypoints
        .filter((wp) => wp.index !== index)
        .map((wp, i) => ({ ...wp, index: i }));

      // Rebuild selection: remove the deleted index, adjust indices above it
      const newSelection = new Set<number>();
      for (const idx of state.selectedWaypointIndices) {
        if (idx === index) continue;
        newSelection.add(idx > index ? idx - 1 : idx);
      }

      return {
        waypoints: filtered,
        selectedWaypointIndices: newSelection,
        lastSelectedWaypointIndex:
          state.lastSelectedWaypointIndex === index
            ? null
            : state.lastSelectedWaypointIndex !== null &&
                state.lastSelectedWaypointIndex > index
              ? state.lastSelectedWaypointIndex - 1
              : state.lastSelectedWaypointIndex,
        dirty: true,
      };
    }),

  moveWaypoint: (index, lat, lng) =>
    set((state) => ({
      waypoints: state.waypoints.map((wp) =>
        wp.index === index ? { ...wp, latitude: lat, longitude: lng } : wp,
      ),
      dirty: true,
    })),

  selectWaypoint: (index, mode = "replace") =>
    set((state) => {
      if (index === null) {
        return {
          selectedWaypointIndices: new Set<number>(),
          lastSelectedWaypointIndex: null,
        };
      }

      switch (mode) {
        case "replace":
          return {
            selectedWaypointIndices: new Set([index]),
            lastSelectedWaypointIndex: index,
          };

        case "toggle": {
          const next = new Set(state.selectedWaypointIndices);
          if (next.has(index)) {
            next.delete(index);
          } else {
            next.add(index);
          }
          return {
            selectedWaypointIndices: next,
            lastSelectedWaypointIndex: next.size > 0 ? index : null,
          };
        }

        case "range": {
          const anchor = state.lastSelectedWaypointIndex;
          if (anchor === null) {
            return {
              selectedWaypointIndices: new Set([index]),
              lastSelectedWaypointIndex: index,
            };
          }
          const start = Math.min(anchor, index);
          const end = Math.max(anchor, index);
          const rangeSet = new Set(state.selectedWaypointIndices);
          for (let i = start; i <= end; i++) {
            rangeSet.add(i);
          }
          return {
            selectedWaypointIndices: rangeSet,
            // Keep the anchor so subsequent Shift+clicks extend from the same origin
            lastSelectedWaypointIndex: anchor,
          };
        }
      }
    }),

  selectAllWaypoints: () =>
    set((state) => ({
      selectedWaypointIndices: new Set(state.waypoints.map((wp) => wp.index)),
      lastSelectedWaypointIndex: state.waypoints.length > 0 ? 0 : null,
    })),

  clearWaypointSelection: () =>
    set({
      selectedWaypointIndices: new Set<number>(),
      lastSelectedWaypointIndex: null,
    }),

  removeSelectedWaypoints: () =>
    set((state) => {
      if (state.selectedWaypointIndices.size === 0) return state;
      const filtered = state.waypoints
        .filter((wp) => !state.selectedWaypointIndices.has(wp.index))
        .map((wp, i) => ({ ...wp, index: i }));
      return {
        waypoints: filtered,
        selectedWaypointIndices: new Set<number>(),
        lastSelectedWaypointIndex: null,
        dirty: true,
      };
    }),

  updateSelectedWaypoints: (updates) =>
    set((state) => ({
      waypoints: state.waypoints.map((wp) =>
        state.selectedWaypointIndices.has(wp.index)
          ? { ...wp, ...updates }
          : wp,
      ),
      dirty: true,
    })),

  reorderWaypoints: (fromIndex, toIndex) =>
    set((state) => {
      const items = [...state.waypoints];
      const [moved] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, moved);
      // Re-index after reorder
      const reindexed = items.map((wp, i) => ({ ...wp, index: i }));
      return {
        waypoints: reindexed,
        selectedWaypointIndices: new Set([toIndex]),
        lastSelectedWaypointIndex: toIndex,
        dirty: true,
      };
    }),

  setIsAddingWaypoint: (adding) =>
    set((state) => ({
      isAddingWaypoint: adding,
      isAddingPoi: adding ? false : state.isAddingPoi,
      isDrawingObstacle: adding ? false : state.isDrawingObstacle,
      isDrawingBuilding: adding ? false : state.isDrawingBuilding,
      templateMode: adding ? null : state.templateMode,
    })),

  addAction: (waypointIndex, action) =>
    set((state) => ({
      waypoints: state.waypoints.map((wp) =>
        wp.index === waypointIndex
          ? { ...wp, actions: [...wp.actions, action] }
          : wp,
      ),
      dirty: true,
    })),

  updateAction: (waypointIndex, actionId, updates) =>
    set((state) => ({
      waypoints: state.waypoints.map((wp) =>
        wp.index === waypointIndex
          ? {
              ...wp,
              actions: wp.actions.map((a) =>
                a.actionId === actionId ? { ...a, ...updates } : a,
              ),
            }
          : wp,
      ),
      dirty: true,
    })),

  removeAction: (waypointIndex, actionId) =>
    set((state) => ({
      waypoints: state.waypoints.map((wp) =>
        wp.index === waypointIndex
          ? {
              ...wp,
              actions: wp.actions.filter((a) => a.actionId !== actionId),
            }
          : wp,
      ),
      dirty: true,
    })),

  // POI actions
  addPoi: (lat, lng) => {
    const isFirstPointOfMission =
      get().waypoints.length === 0 && get().pois.length === 0;
    const generation = get().missionGeneration;
    set((state) => {
      const building = state.buildings.find(
        (b) => b.vertices.length >= 3 && pointInPolygon([lat, lng], b.vertices),
      );

      const poi: PointOfInterest = {
        id: crypto.randomUUID(),
        name: `POI ${state.pois.length + 1}`,
        latitude: lat,
        longitude: lng,
        height: building ? building.height : 0,
      };

      // A POI dropped on a building: pre-fill the Orbit panel with a
      // recommended altitude/radius/gimbal pitch for orbiting it, instead
      // of generating a route automatically.
      const pendingOrbitParams = building
        ? orbitParamsForBuilding(
            building,
            WIDE_CAMERA_FOV[state.config.payloadEnumValue]?.vfovDeg,
          )
        : state.pendingOrbitParams;

      return {
        pois: [...state.pois, poi],
        selectedPoiId: poi.id,
        pendingOrbitParams,
        dirty: true,
      };
    });
    if (isFirstPointOfMission) {
      void autoNameFromLocation(lat, lng, generation);
    }
  },

  updatePoi: (id, updates) =>
    set((state) => ({
      pois: state.pois.map((p) => (p.id === id ? { ...p, ...updates } : p)),
      dirty: true,
    })),

  removePoi: (id) =>
    set((state) => ({
      pois: state.pois.filter((p) => p.id !== id),
      selectedPoiId: state.selectedPoiId === id ? null : state.selectedPoiId,
      // Clear poiId references on waypoints
      waypoints: state.waypoints.map((wp) =>
        wp.poiId === id ? { ...wp, poiId: undefined } : wp,
      ),
      dirty: true,
    })),

  movePoi: (id, lat, lng) =>
    set((state) => ({
      pois: state.pois.map((p) =>
        p.id === id ? { ...p, latitude: lat, longitude: lng } : p,
      ),
      dirty: true,
    })),

  selectPoi: (id) => set({ selectedPoiId: id }),

  setIsAddingPoi: (adding) =>
    set((state) => ({
      isAddingPoi: adding,
      isAddingWaypoint: adding ? false : state.isAddingWaypoint,
      isDrawingObstacle: adding ? false : state.isDrawingObstacle,
      isDrawingBuilding: adding ? false : state.isDrawingBuilding,
      templateMode: adding ? null : state.templateMode,
    })),

  // Obstacle actions
  addObstacle: (vertices) =>
    set((state) => {
      const obstacle: Obstacle = {
        id: crypto.randomUUID(),
        name: `Obstacle ${state.obstacles.length + 1}`,
        description: "",
        vertices,
      };
      return {
        obstacles: [...state.obstacles, obstacle],
        selectedObstacleId: obstacle.id,
        isDrawingObstacle: false,
        drawingVertices: [],
        dirty: true,
      };
    }),

  updateObstacle: (id, updates) =>
    set((state) => ({
      obstacles: state.obstacles.map((o) =>
        o.id === id ? { ...o, ...updates } : o,
      ),
      dirty: true,
    })),

  removeObstacle: (id) =>
    set((state) => ({
      obstacles: state.obstacles.filter((o) => o.id !== id),
      selectedObstacleId:
        state.selectedObstacleId === id ? null : state.selectedObstacleId,
      dirty: true,
    })),

  moveObstacleVertex: (id, vertexIndex, lat, lng) =>
    set((state) => ({
      obstacles: state.obstacles.map((o) => {
        if (o.id !== id) return o;
        const vertices = [...o.vertices] as [number, number][];
        vertices[vertexIndex] = [lat, lng];
        return { ...o, vertices };
      }),
      dirty: true,
    })),

  addObstacleVertex: (id, afterIndex, lat, lng) =>
    set((state) => ({
      obstacles: state.obstacles.map((o) => {
        if (o.id !== id) return o;
        const vertices = [...o.vertices] as [number, number][];
        vertices.splice(afterIndex + 1, 0, [lat, lng]);
        return { ...o, vertices };
      }),
      dirty: true,
    })),

  removeObstacleVertex: (id, vertexIndex) =>
    set((state) => ({
      obstacles: state.obstacles.map((o) => {
        if (o.id !== id || o.vertices.length <= 3) return o;
        const vertices = o.vertices.filter(
          (_: [number, number], i: number) => i !== vertexIndex,
        );
        return { ...o, vertices };
      }),
      dirty: true,
    })),

  selectObstacle: (id) => set({ selectedObstacleId: id }),

  setIsDrawingObstacle: (drawing) =>
    set((state) => ({
      isDrawingObstacle: drawing,
      isAddingWaypoint: drawing ? false : state.isAddingWaypoint,
      isAddingPoi: drawing ? false : state.isAddingPoi,
      isDrawingBuilding: drawing ? false : state.isDrawingBuilding,
      templateMode: drawing ? null : state.templateMode,
      selectedWaypointIndices: drawing
        ? new Set<number>()
        : state.selectedWaypointIndices,
      selectedPoiId: drawing ? null : state.selectedPoiId,
      drawingVertices: drawing ? [] : state.drawingVertices,
    })),

  setDrawingVertices: (vertices) => set({ drawingVertices: vertices }),

  // Building actions
  addBuilding: (vertices, height) =>
    set((state) => {
      const building: Building = {
        id: crypto.randomUUID(),
        name: `Building ${state.buildings.length + 1}`,
        height,
        vertices,
      };
      return {
        buildings: [...state.buildings, building],
        selectedBuildingId: building.id,
        isDrawingBuilding: false,
        drawingBuildingVertices: [],
        dirty: true,
      };
    }),

  updateBuilding: (id, updates) =>
    set((state) => ({
      buildings: state.buildings.map((b) =>
        b.id === id ? { ...b, ...updates } : b,
      ),
      dirty: true,
    })),

  removeBuilding: (id) =>
    set((state) => ({
      buildings: state.buildings.filter((b) => b.id !== id),
      selectedBuildingId:
        state.selectedBuildingId === id ? null : state.selectedBuildingId,
      dirty: true,
    })),

  moveBuildingVertex: (id, vertexIndex, lat, lng) =>
    set((state) => ({
      buildings: state.buildings.map((b) => {
        if (b.id !== id) return b;
        const vertices = [...b.vertices] as [number, number][];
        vertices[vertexIndex] = [lat, lng];
        return { ...b, vertices };
      }),
      dirty: true,
    })),

  addBuildingVertex: (id, afterIndex, lat, lng) =>
    set((state) => ({
      buildings: state.buildings.map((b) => {
        if (b.id !== id) return b;
        const vertices = [...b.vertices] as [number, number][];
        vertices.splice(afterIndex + 1, 0, [lat, lng]);
        return { ...b, vertices };
      }),
      dirty: true,
    })),

  removeBuildingVertex: (id, vertexIndex) =>
    set((state) => ({
      buildings: state.buildings.map((b) => {
        if (b.id !== id || b.vertices.length <= 3) return b;
        const vertices = b.vertices.filter(
          (_: [number, number], i: number) => i !== vertexIndex,
        );
        return { ...b, vertices };
      }),
      dirty: true,
    })),

  selectBuilding: (id) => set({ selectedBuildingId: id }),

  setIsDrawingBuilding: (drawing) =>
    set((state) => ({
      isDrawingBuilding: drawing,
      isAddingWaypoint: drawing ? false : state.isAddingWaypoint,
      isAddingPoi: drawing ? false : state.isAddingPoi,
      isDrawingObstacle: drawing ? false : state.isDrawingObstacle,
      templateMode: drawing ? null : state.templateMode,
      selectedWaypointIndices: drawing
        ? new Set<number>()
        : state.selectedWaypointIndices,
      selectedPoiId: drawing ? null : state.selectedPoiId,
      drawingBuildingVertices: drawing ? [] : state.drawingBuildingVertices,
    })),

  setBuildingDrawMode: (mode) =>
    set({ buildingDrawMode: mode, drawingBuildingVertices: [] }),

  setDrawingBuildingVertices: (vertices) =>
    set({ drawingBuildingVertices: vertices }),

  setTemplateMode: (mode) =>
    set({
      templateMode: mode,
      isAddingWaypoint: false,
      isAddingPoi: false,
      isDrawingObstacle: false,
      isDrawingBuilding: false,
      selectedWaypointIndices: new Set(),
      selectedPoiId: null,
    }),

  appendWaypoints: (newWps, newPois, templateGroup) => {
    // Templates (Orbit/Grid/Facade/Solar/Pencil/Corridor) are the other way a brand
    // new mission gets its first content, alongside the manual
    // addWaypoint/addPoi clicks — auto-naming only wired up for those two
    // missed every template-created mission entirely.
    const wasEmptyMission =
      get().waypoints.length === 0 && get().pois.length === 0;
    const generation = get().missionGeneration;
    const firstLocation = newPois?.[0]
      ? { lat: newPois[0].latitude, lng: newPois[0].longitude }
      : newWps[0]
        ? { lat: newWps[0].latitude, lng: newWps[0].longitude }
        : null;

    set((state) => {
      const startIndex = state.waypoints.length;
      const groupId = templateGroup ? crypto.randomUUID() : undefined;

      const fullWaypoints: Waypoint[] = newWps.map((wp, i) => ({
        ...wp,
        index: startIndex + i,
        name: `Bod trasy ${startIndex + i + 1}`,
        ...(groupId ? { templateGroupId: groupId } : {}),
      }));

      const fullPois: PointOfInterest[] = (newPois || []).map((p) => ({
        ...p,
        id: crypto.randomUUID(),
        ...(groupId ? { templateGroupId: groupId } : {}),
      }));

      // If orbit template created a POI, link the waypoints to it
      if (fullPois.length === 1) {
        const poiId = fullPois[0].id;
        for (const wp of fullWaypoints) {
          if (wp.headingMode === "fixed") {
            // Convert to towardPOI mode for orbit waypoints
            wp.headingMode = "towardPOI";
            wp.poiId = poiId;
          }
        }
      }

      return {
        waypoints: [...state.waypoints, ...fullWaypoints],
        pois: [...state.pois, ...fullPois],
        templateGroups:
          groupId && templateGroup
            ? { ...state.templateGroups, [groupId]: templateGroup }
            : state.templateGroups,
        selectedWaypointIndices: new Set(fullWaypoints.map((wp) => wp.index)),
        lastSelectedWaypointIndex:
          fullWaypoints.length > 0
            ? fullWaypoints[fullWaypoints.length - 1].index
            : state.lastSelectedWaypointIndex,
        templateMode: null,
        dirty: true,
      };
    });

    if (wasEmptyMission && firstLocation) {
      void autoNameFromLocation(
        firstLocation.lat,
        firstLocation.lng,
        generation,
      );
    }
  },

  replaceTemplateGroup: (groupId, newWps, newPois, params) =>
    set((state) => {
      const existingGroup = state.templateGroups[groupId];
      if (!existingGroup) return state;

      const remainingWaypoints = state.waypoints
        .filter((wp) => wp.templateGroupId !== groupId)
        .map((wp, i) => ({ ...wp, index: i }));
      const remainingPois = state.pois.filter(
        (p) => p.templateGroupId !== groupId,
      );
      const startIndex = remainingWaypoints.length;

      const fullWaypoints: Waypoint[] = newWps.map((wp, i) => ({
        ...wp,
        index: startIndex + i,
        name: `Bod trasy ${startIndex + i + 1}`,
        templateGroupId: groupId,
      }));

      const fullPois: PointOfInterest[] = newPois.map((p) => ({
        ...p,
        id: crypto.randomUUID(),
        templateGroupId: groupId,
      }));

      if (fullPois.length === 1) {
        const poiId = fullPois[0].id;
        for (const wp of fullWaypoints) {
          if (wp.headingMode === "fixed") {
            wp.headingMode = "towardPOI";
            wp.poiId = poiId;
          }
        }
      }

      return {
        waypoints: [...remainingWaypoints, ...fullWaypoints],
        pois: [...remainingPois, ...fullPois],
        templateGroups: {
          ...state.templateGroups,
          [groupId]: { type: existingGroup.type, params },
        },
        selectedWaypointIndices: new Set(fullWaypoints.map((wp) => wp.index)),
        lastSelectedWaypointIndex:
          fullWaypoints.length > 0
            ? fullWaypoints[fullWaypoints.length - 1].index
            : state.lastSelectedWaypointIndex,
        templateMode: null,
        editingTemplateGroupId: null,
        dirty: true,
      };
    }),

  loadMission: (data) =>
    set((state) => ({
      missionId: data.id || null,
      missionGeneration: state.missionGeneration + 1,
      missionName: data.name,
      config: data.config,
      waypoints: data.waypoints,
      pois: data.pois || [],
      obstacles: data.obstacles || [],
      buildings: data.buildings || [],
      selectedWaypointIndices: new Set<number>(),
      lastSelectedWaypointIndex: null,
      selectedPoiId: null,
      selectedObstacleId: null,
      selectedBuildingId: null,
      // Template params are now persisted with the saved mission, so a
      // waypoint/POI's templateGroupId from a previous session still
      // resolves to real params after a save/reload round-trip — "Edit
      // template" keeps working instead of degrading to plain waypoints.
      templateGroups: data.templateGroups || {},
      editingTemplateGroupId: null,
      pendingOrbitParams: null,
      pendingPresetLoad: null,
      dirty: false,
    })),

  clearMission: () => {
    const prefs = usePreferencesStore.getState().preferences;
    set((state) => ({
      missionId: null,
      missionGeneration: state.missionGeneration + 1,
      missionName: DEFAULT_MISSION_NAME,
      config: { ...DEFAULT_MISSION_CONFIG, ...prefs.missionDefaults },
      waypoints: [],
      pois: [],
      obstacles: [],
      buildings: [],
      selectedWaypointIndices: new Set<number>(),
      lastSelectedWaypointIndex: null,
      selectedPoiId: null,
      selectedObstacleId: null,
      selectedBuildingId: null,
      isDrawingObstacle: false,
      drawingVertices: [],
      isDrawingBuilding: false,
      drawingBuildingVertices: [],
      templateGroups: {},
      editingTemplateGroupId: null,
      pendingOrbitParams: null,
      pendingPresetLoad: null,
      dirty: false,
    }));
  },

  setDirty: (dirty) => set({ dirty }),
}));

/**
 * Reverse-geocodes the mission's first placed point into a human-readable
 * address and uses it as the mission name — but only if the mission is
 * still unnamed AND still the same mission by the time the request resolves.
 * `generation` is the store's `missionGeneration` at the moment the point was
 * placed; every `loadMission`/`clearMission` bumps it, so this still catches
 * "switched to a different brand-new mission while the request was in
 * flight" even though a not-yet-saved mission's `missionId` is `null` on
 * both sides. Silent on any failure: auto-naming is a nice-to-have, never
 * worth interrupting the user's flow over.
 */
async function autoNameFromLocation(
  lat: number,
  lng: number,
  generation: number,
): Promise<void> {
  const token = useConfigStore.getState().mapboxToken;
  if (!token) return;

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${encodeURIComponent(token)}&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    const placeName = data.features?.[0]?.place_name;
    if (!placeName || typeof placeName !== "string") return;

    const current = useMissionStore.getState();
    if (
      current.missionGeneration === generation &&
      current.missionName === DEFAULT_MISSION_NAME
    ) {
      useMissionStore.setState({ missionName: placeName, dirty: true });
    }
  } catch {
    // Network failure or malformed response — keep the default name.
  }
}
