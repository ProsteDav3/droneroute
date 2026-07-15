import type { Mission, Waypoint, WaypointAction } from "@droneroute/shared";

function findAction(
  waypoints: Waypoint[],
  actionType: string,
): WaypointAction | undefined {
  for (const wp of waypoints) {
    const action = wp.actions?.find((a) => a.actionType === actionType);
    if (action) return action;
  }
  return undefined;
}

/**
 * Splits a mission's waypoints into consecutive one-leg missions (waypoint
 * 1→2, 2→3, ... N-1→N). Each leg keeps the parent mission's config and
 * POIs (e.g. a shared `towardPOI` target), so heading/gimbal targeting
 * stays identical across every leg regardless of which slice of the
 * original path it covers. Shared by the zip-export flow
 * (`generateMissionSegmentsZip`) and the save-as-missions route — callers
 * that persist these must replace `id` with a fresh one per row, since it's
 * just carried through from the parent mission here.
 *
 * Video capture mode (see templates.ts) records continuously by placing a
 * single `startRecord` on the mission's first waypoint and a single
 * `stopRecord` on its last — carrying those two actions through unchanged
 * would leave every segment except the very first and very last with no
 * recording action at all. Instead, whenever the parent mission has a
 * start/stop record pair anywhere, every segment gets its own fresh pair:
 * start on its first waypoint, stop on its second.
 */
export function buildMissionSegments(mission: Mission): Mission[] {
  const segmentCount = mission.waypoints.length - 1;
  const pad = String(segmentCount).length;
  const safeName = mission.name.replace(/[^a-zA-Z0-9_-]/g, "_");

  const startTemplate = findAction(mission.waypoints, "startRecord");
  const stopTemplate = findAction(mission.waypoints, "stopRecord");
  const isVideoMode = startTemplate !== undefined && stopTemplate !== undefined;

  const segments: Mission[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const segmentName = `${safeName}-seg-${String(i + 1).padStart(pad, "0")}-of-${segmentCount}`;
    const first: Waypoint = { ...mission.waypoints[i], index: 0 };
    const second: Waypoint = { ...mission.waypoints[i + 1], index: 1 };

    if (isVideoMode) {
      first.actions = [{ ...startTemplate, actionId: 0 }];
      second.actions = [{ ...stopTemplate, actionId: 0 }];
    }

    segments.push({
      ...mission,
      name: segmentName,
      waypoints: [first, second],
    });
  }
  return segments;
}
