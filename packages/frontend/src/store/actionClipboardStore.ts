import { create } from "zustand";
import type { WaypointAction } from "@droneroute/shared";

interface ActionClipboardState {
  actions: WaypointAction[] | null;
  copy: (actions: WaypointAction[]) => void;
  clear: () => void;
}

/**
 * Holds a copied waypoint's actions so they can be pasted onto another
 * waypoint (or a bulk selection) — deliberately outside `missionStore`
 * since a clipboard is session UI state, not mission content.
 */
export const useActionClipboardStore = create<ActionClipboardState>((set) => ({
  actions: null,
  copy: (actions) => set({ actions: actions.map((a) => ({ ...a })) }),
  clear: () => set({ actions: null }),
}));

/** Deep-clones clipboard actions with a fresh, gap-free actionId sequence
 * starting at 0 — pasting the same clipboard onto multiple waypoints must
 * never let two waypoints share action-object identity, and DJI's WPML
 * export expects sequential ids per waypoint, not whatever ids happened to
 * exist on the original. */
export function cloneActionsForPaste(
  actions: WaypointAction[],
): WaypointAction[] {
  return actions.map((action, i) => ({
    ...action,
    actionId: i,
    params: { ...action.params },
  }));
}
