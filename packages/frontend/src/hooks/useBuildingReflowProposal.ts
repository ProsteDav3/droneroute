import { useMemo } from "react";
import { useMissionStore } from "@/store/missionStore";
import { WIDE_CAMERA_FOV } from "@/lib/solarCamera";
import { computeBuildingReflow } from "@/lib/buildingReflow";
import type { BuildingReflowResult } from "@/lib/buildingReflow";

/**
 * One waypoint's proposed move, carrying where it starts as well as where it
 * would end up — the map preview needs both to draw the leader line, and the
 * store's `applyBuildingReflow` ignores the extra fields.
 */
export interface BuildingReflowPreviewMove {
  index: number;
  latitude: number;
  longitude: number;
  fromLatitude: number;
  fromLongitude: number;
}

export interface BuildingReflowProposal extends Omit<
  BuildingReflowResult,
  "moves"
> {
  moves: BuildingReflowPreviewMove[];
}

/**
 * The live reflow proposal for the building edit in progress, or `null` when
 * there is nothing to propose.
 *
 * Derived state, not stored state: it recomputes from the baseline footprint
 * and the building's current shape, so it tracks a vertex drag continuously
 * instead of going stale between the drag and the confirmation.
 */
export function useBuildingReflowProposal(): BuildingReflowProposal | null {
  const pendingBuildingEdit = useMissionStore((s) => s.pendingBuildingEdit);
  const buildings = useMissionStore((s) => s.buildings);
  const waypoints = useMissionStore((s) => s.waypoints);
  // Same FOV lookup the orbit seed itself uses when a POI is dropped on a
  // building (see missionStore's addPoi) — the reflow has to size the new
  // radius against the same camera the template did.
  const payloadEnumValue = useMissionStore((s) => s.config.payloadEnumValue);
  const cameraFovDeg = WIDE_CAMERA_FOV[payloadEnumValue]?.vfovDeg;
  const blendPoints = useMissionStore((s) => s.reflowBlendPoints);

  return useMemo(() => {
    if (!pendingBuildingEdit) return null;
    const building = buildings.find(
      (b) => b.id === pendingBuildingEdit.buildingId,
    );
    if (!building) return null;

    const result = computeBuildingReflow({
      oldVertices: pendingBuildingEdit.vertices,
      newVertices: building.vertices,
      oldHeight: pendingBuildingEdit.height,
      newHeight: building.height,
      waypoints,
      vfovDeg: cameraFovDeg,
      blendPoints,
    });
    if (!result) return null;

    const byIndex = new Map(waypoints.map((wp) => [wp.index, wp]));
    return {
      ...result,
      moves: result.moves.flatMap((move) => {
        const wp = byIndex.get(move.index);
        if (!wp) return [];
        return [
          {
            ...move,
            fromLatitude: wp.latitude,
            fromLongitude: wp.longitude,
          },
        ];
      }),
    };
  }, [pendingBuildingEdit, buildings, waypoints, cameraFovDeg, blendPoints]);
}
