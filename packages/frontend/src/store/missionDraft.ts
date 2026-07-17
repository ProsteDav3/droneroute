import { useStore } from "zustand";
import type {
  MissionConfig,
  Waypoint,
  PointOfInterest,
  Obstacle,
  Building,
} from "@droneroute/shared";
import { useMissionStore, type TemplateGroup } from "./missionStore";

/** Undo/redo controls, backed by zundo's `temporal` store — split out from
 * missionStore.ts since it only ever reads/writes the store from the
 * outside (`.temporal`, `.getState()`), never from inside the state
 * creator. */
export function useMissionHistory() {
  const pastCount = useStore(
    useMissionStore.temporal,
    (s) => s.pastStates.length,
  );
  const futureCount = useStore(
    useMissionStore.temporal,
    (s) => s.futureStates.length,
  );
  const { undo, redo, clear } = useMissionStore.temporal.getState();
  return {
    undo: () => undo(),
    redo: () => redo(),
    clear,
    canUndo: pastCount > 0,
    canRedo: futureCount > 0,
  };
}

const DRAFT_KEY = "droneroute_draft_v1";
const AUTOSAVE_DEBOUNCE_MS = 2000;

export interface MissionDraft {
  savedAt: string;
  missionId: string | null;
  missionName: string;
  missionClient: string;
  config: MissionConfig;
  waypoints: Waypoint[];
  pois: PointOfInterest[];
  obstacles: Obstacle[];
  buildings: Building[];
  templateGroups: Record<string, TemplateGroup>;
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

/** False in non-browser contexts (SSR, Node test environment) — autosave is a no-op there. */
function hasLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

// Debounced localStorage autosave: survives a crashed tab/browser between
// saves. Skipped for a still-empty mission (nothing worth recovering) and
// for selection/UI-only updates (same "did content actually change" check
// used for undo history, just compared by reference instead of JSON.stringify
// since this only needs to decide whether to (re)start the debounce timer,
// not whether to record a full history entry).
useMissionStore.subscribe((state, prevState) => {
  if (!state.dirty || !hasLocalStorage()) return;
  if (
    state.waypoints === prevState.waypoints &&
    state.pois === prevState.pois &&
    state.obstacles === prevState.obstacles &&
    state.buildings === prevState.buildings &&
    state.config === prevState.config &&
    state.missionName === prevState.missionName &&
    state.missionClient === prevState.missionClient &&
    state.templateGroups === prevState.templateGroups
  ) {
    return;
  }

  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    const s = useMissionStore.getState();
    if (s.waypoints.length === 0 && s.pois.length === 0) return;
    const draft: MissionDraft = {
      savedAt: new Date().toISOString(),
      missionId: s.missionId,
      missionName: s.missionName,
      missionClient: s.missionClient,
      config: s.config,
      waypoints: s.waypoints,
      pois: s.pois,
      obstacles: s.obstacles,
      buildings: s.buildings,
      templateGroups: s.templateGroups,
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Storage full/unavailable — autosave is a convenience, never worth
      // throwing over.
    }
  }, AUTOSAVE_DEBOUNCE_MS);
});

/** Reads the pending autosaved draft, if any, without side effects. */
export function peekMissionDraft(): MissionDraft | null {
  if (!hasLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MissionDraft;
  } catch {
    return null;
  }
}

/** Discards the pending autosaved draft without loading it. */
export function clearMissionDraft(): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore — nothing to discard if storage is unavailable
  }
}

/** Loads a previously autosaved draft into the store as the active mission. */
export function restoreMissionDraft(draft: MissionDraft): void {
  useMissionStore.getState().loadMission({
    id: draft.missionId || undefined,
    name: draft.missionName,
    client: draft.missionClient,
    config: draft.config,
    waypoints: draft.waypoints,
    pois: draft.pois,
    obstacles: draft.obstacles,
    buildings: draft.buildings,
    templateGroups: draft.templateGroups,
  });
  // The draft represents unsaved edits — loadMission resets `dirty` to
  // false, but the user still needs to explicitly save this content.
  useMissionStore.setState({ dirty: true });
  clearMissionDraft();
}
