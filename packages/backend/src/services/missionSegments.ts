import type { Mission } from "@droneroute/shared";

/**
 * Splits a mission's waypoints into consecutive one-leg missions (waypoint
 * 1→2, 2→3, ... N-1→N). Each leg keeps the parent mission's config and
 * POIs (e.g. a shared `towardPOI` target), so heading/gimbal targeting
 * stays identical across every leg regardless of which slice of the
 * original path it covers. Shared by the zip-export flow
 * (`generateMissionSegmentsZip`) and the save-as-missions route — callers
 * that persist these must replace `id` with a fresh one per row, since it's
 * just carried through from the parent mission here.
 */
export function buildMissionSegments(mission: Mission): Mission[] {
  const segmentCount = mission.waypoints.length - 1;
  const pad = String(segmentCount).length;
  const safeName = mission.name.replace(/[^a-zA-Z0-9_-]/g, "_");

  const segments: Mission[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const segmentName = `${safeName}-seg-${String(i + 1).padStart(pad, "0")}-of-${segmentCount}`;
    segments.push({
      ...mission,
      name: segmentName,
      waypoints: [
        { ...mission.waypoints[i], index: 0 },
        { ...mission.waypoints[i + 1], index: 1 },
      ],
    });
  }
  return segments;
}
