import type { Mission, Waypoint, WaypointAction } from "@droneroute/shared";
import { CAMERA_SETTLE_SECONDS } from "@droneroute/shared";

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

function isRecordAction(action: WaypointAction): boolean {
  return (
    action.actionType === "startRecord" || action.actionType === "stopRecord"
  );
}

/**
 * The opening camera setup a segment needs to stand on its own: set the
 * gimbal to this leg's angle, hold still so the aircraft finishes turning
 * to the target and the gimbal settles, then focus.
 *
 * The parent route does this once, on its first two waypoints — which is
 * right for one continuous flight but wrong for segments, since each segment
 * is flown as its own flight, months apart in a time-lapse series. Carried
 * through the split unchanged it left every segment but the first taking off
 * with the gimbal wherever the pilot had left it, and never focusing
 * (measured on a real 71-segment upload: 1 of 71 segments set the gimbal, 2
 * of 71 focused).
 *
 * Added only to routes that actually aim the camera at a target — a survey
 * grid, or a mission whose camera the pilot controls, must not have gimbal
 * moves invented for it. Anything the segment already inherited is kept as
 * is rather than duplicated.
 */
function openingCameraActions(first: Waypoint): WaypointAction[] {
  const has = (type: string) =>
    (first.actions ?? []).some((a) => a.actionType === type);
  const actions: WaypointAction[] = [];
  if (!has("gimbalRotate")) {
    actions.push({
      actionId: 0,
      actionType: "gimbalRotate",
      params: {
        gimbalRotateMode: "absoluteAngle",
        gimbalPitchRotateAngle: first.gimbalPitchAngle,
        payloadPositionIndex: 0,
      },
    } as WaypointAction);
  }
  // An inherited hover is handled by `withSettleAtLeast` instead, which
  // lengthens it rather than adding a second pause next to it.
  if (!has("hover")) {
    actions.push({
      actionId: 0,
      actionType: "hover",
      params: { hoverTime: CAMERA_SETTLE_SECONDS },
    } as WaypointAction);
  }
  if (!has("focus")) {
    actions.push({
      actionId: 0,
      actionType: "focus",
      params: {
        isPointFocus: true,
        focusX: 0.5,
        focusY: 0.5,
        isInfiniteFocus: false,
        payloadPositionIndex: 0,
      },
    } as WaypointAction);
  }
  return actions;
}

/**
 * Raises a hover the segment inherited to the segment settle, leaving a
 * longer one alone. The parent route's own settle is one second — right for
 * a pause that sits inside its footage, too short for a segment entered cold
 * — and the segment that happens to start on that waypoint would otherwise
 * be the one segment that keeps the short version.
 */
function withSettleAtLeast(actions: WaypointAction[]): WaypointAction[] {
  return actions.map((action) => {
    if (action.actionType !== "hover") return action;
    const params = action.params as { hoverTime?: number };
    const hoverTime = Math.max(params.hoverTime ?? 0, CAMERA_SETTLE_SECONDS);
    return { ...action, params: { ...params, hoverTime } };
  });
}

/** Whether this route aims the camera at a target at all. */
function tracksTarget(waypoints: Waypoint[]): boolean {
  return waypoints.some((wp) => wp.headingMode === "towardPOI");
}

/** Re-numbers actionId 0..n so ids stay unique/sequential within the waypoint. */
function renumberActions(actions: WaypointAction[]): WaypointAction[] {
  return actions.map((action, i) => ({ ...action, actionId: i }));
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
 * start on its first waypoint, stop on its second — added alongside
 * (not instead of) any other action already on those waypoints (gimbal
 * moves, hover, zoom, focus, yaw), which must survive the split untouched.
 */
export function buildMissionSegments(mission: Mission): Mission[] {
  const segmentCount = mission.waypoints.length - 1;
  const pad = String(segmentCount).length;
  const safeName = mission.name.replace(/[^a-zA-Z0-9_-]/g, "_");

  const startTemplate = findAction(mission.waypoints, "startRecord");
  const stopTemplate = findAction(mission.waypoints, "stopRecord");
  const isVideoMode = startTemplate !== undefined && stopTemplate !== undefined;

  const aimsCamera = tracksTarget(mission.waypoints);

  const segments: Mission[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const segmentName = `${safeName}-seg-${String(i + 1).padStart(pad, "0")}-of-${segmentCount}`;
    const first: Waypoint = { ...mission.waypoints[i], index: 0 };
    const second: Waypoint = { ...mission.waypoints[i + 1], index: 1 };

    // Camera setup first, recording last, so the settle and the gimbal swing
    // are not in the clip.
    const opening = aimsCamera ? openingCameraActions(first) : [];

    if (isVideoMode) {
      const firstOther = (first.actions ?? []).filter(
        (a) => !isRecordAction(a),
      );
      const secondOther = (second.actions ?? []).filter(
        (a) => !isRecordAction(a),
      );
      first.actions = renumberActions([
        ...opening,
        ...(aimsCamera ? withSettleAtLeast(firstOther) : firstOther),
        { ...startTemplate, actionId: 0 },
      ]);
      second.actions = renumberActions([
        ...secondOther,
        { ...stopTemplate, actionId: 0 },
      ]);
    } else if (opening.length > 0) {
      first.actions = renumberActions([
        ...opening,
        ...withSettleAtLeast(first.actions ?? []),
      ]);
    }

    segments.push({
      ...mission,
      name: segmentName,
      waypoints: [first, second],
    });
  }
  return segments;
}
