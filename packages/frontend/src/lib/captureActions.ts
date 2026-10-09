import type { ActionType, Waypoint, WaypointAction } from "@droneroute/shared";
import { CINEMA_SPEED_MPS, type CaptureMode } from "./templates";

/**
 * Re-targets a selection of existing waypoints at photo or video capture,
 * the same way a freshly applied template would have — so a route that
 * arrived as an imported KMZ (or was drawn by hand) can be switched between
 * "a shot at every point" and "record start-to-finish" without rebuilding
 * its actions one waypoint at a time.
 *
 * Only the capture actions (`takePhoto`, `startRecord`, `stopRecord`) are
 * touched. Camera setup that a template or the pilot already put on a
 * waypoint — gimbal angle, hover, focus, zoom — stays exactly where it is,
 * because it has to run *before* whatever shoots: the new capture action
 * goes after everything except a trailing `gimbalEvenlyRotate`, which
 * describes the leg to the *next* waypoint and belongs last (mirrors
 * `applyOrbitAimingActions` in templates.ts).
 *
 * "First"/"last" mean flight order (ascending index), not the order the
 * waypoints were clicked.
 */

const CAPTURE_ACTION_TYPES: ReadonlySet<ActionType> = new Set([
  "takePhoto",
  "startRecord",
  "stopRecord",
]);

function isCapture(action: WaypointAction): boolean {
  return CAPTURE_ACTION_TYPES.has(action.actionType);
}

function recordAction(type: "startRecord" | "stopRecord"): WaypointAction {
  return { actionId: 0, actionType: type, params: { payloadPositionIndex: 0 } };
}

/** Drops old capture actions and slots the new ones in ahead of any trailing evenly-rotate. */
function withCaptureActions(
  actions: WaypointAction[],
  capture: WaypointAction[],
): WaypointAction[] {
  const kept = actions.filter((a) => !isCapture(a));
  const tailStart = kept.findIndex(
    (a) => a.actionType === "gimbalEvenlyRotate",
  );
  const head = tailStart === -1 ? kept : kept.slice(0, tailStart);
  const tail = tailStart === -1 ? [] : kept.slice(tailStart);
  return [...head, ...capture, ...tail].map((action, i) => ({
    ...action,
    actionId: i,
    params: { ...action.params },
  }));
}

/**
 * Returns a new waypoint list with the selected waypoints' capture actions
 * rewritten for `mode`. `cinema` (video only) also pins the selection to
 * `CINEMA_SPEED_MPS`, matching the Orbit template's "Cinema video".
 */
export function applyCaptureMode(
  waypoints: Waypoint[],
  selected: ReadonlySet<number>,
  mode: CaptureMode,
  cinema: boolean,
): Waypoint[] {
  if (selected.size === 0) return waypoints;
  const order = waypoints
    .filter((wp) => selected.has(wp.index))
    .map((wp) => wp.index)
    .sort((a, b) => a - b);
  const first = order[0];
  const last = order[order.length - 1];

  return waypoints.map((wp) => {
    if (!selected.has(wp.index)) return wp;
    const capture: WaypointAction[] = [];
    if (mode === "photo") {
      capture.push({
        actionId: 0,
        actionType: "takePhoto",
        params: { payloadPositionIndex: 0 },
      });
    } else {
      if (wp.index === first) capture.push(recordAction("startRecord"));
      if (wp.index === last) capture.push(recordAction("stopRecord"));
    }
    const pacing =
      mode === "video" && cinema
        ? { speed: CINEMA_SPEED_MPS, useGlobalSpeed: false }
        : {};
    return {
      ...wp,
      ...pacing,
      actions: withCaptureActions(wp.actions, capture),
    };
  });
}

export interface DetectedCaptureMode {
  /** Undefined when the selection is empty, mixed, or captures nothing. */
  mode: CaptureMode | undefined;
  cinema: boolean;
}

/** Reads the selection's current capture mode back, so the toggle can show which button is "on". */
export function detectCaptureMode(
  waypoints: Waypoint[],
  selected: ReadonlySet<number>,
): DetectedCaptureMode {
  const chosen = waypoints
    .filter((wp) => selected.has(wp.index))
    .sort((a, b) => a.index - b.index);
  if (chosen.length === 0) return { mode: undefined, cinema: false };

  const has = (wp: Waypoint, type: ActionType) =>
    wp.actions.some((a) => a.actionType === type);

  if (chosen.every((wp) => has(wp, "takePhoto"))) {
    return { mode: "photo", cinema: false };
  }

  const first = chosen[0];
  const last = chosen[chosen.length - 1];
  const middle = chosen.slice(1, -1);
  const isVideo =
    has(first, "startRecord") &&
    has(last, "stopRecord") &&
    !chosen.some((wp) => has(wp, "takePhoto")) &&
    !middle.some((wp) => has(wp, "startRecord") || has(wp, "stopRecord"));
  if (!isVideo) return { mode: undefined, cinema: false };

  const cinema = chosen.every(
    (wp) => !wp.useGlobalSpeed && wp.speed === CINEMA_SPEED_MPS,
  );
  return { mode: "video", cinema };
}

/**
 * Walks the whole mission in flight order and returns a short Czech warning
 * if its recording actions don't pair up, or null when they do.
 *
 * `applyCaptureMode` deliberately touches only the selection, so applying
 * video to WP10–WP20 of an imported clip that already records WP1–WP72
 * leaves a second start while the camera is rolling — the aircraft won't
 * reject that file, it just silently records something other than what the
 * pilot meant. The bulk editor shows this as a warning rather than fixing it,
 * because two separate clips in one flight are a legitimate plan.
 */
export function findRecordingProblem(waypoints: Waypoint[]): string | null {
  let recording = false;
  for (const wp of [...waypoints].sort((a, b) => a.index - b.index)) {
    const label = `WP${wp.index + 1}`;
    for (const action of wp.actions) {
      if (action.actionType === "startRecord") {
        if (recording)
          return `Na ${label} se spouští nahrávání, které už běží — zkontrolujte start a stop videa mimo výběr.`;
        recording = true;
      } else if (action.actionType === "stopRecord") {
        if (!recording)
          return `Na ${label} se zastavuje nahrávání, které neběží — zkontrolujte start a stop videa mimo výběr.`;
        recording = false;
      }
    }
  }
  return recording
    ? "Nahrávání se do konce trasy nezastaví — chybí stop videa za výběrem."
    : null;
}
