import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useMap } from "react-map-gl/mapbox";
import { useMissionStore } from "@/store/missionStore";
import { TemplateConfigPanel } from "./TemplateConfigPanel";
import { TemplatePreview } from "./TemplatePreview";
import type { TurbineParams } from "@/lib/templates";
import {
  generateTurbineInspection,
  DEFAULT_TURBINE_PARAMS,
} from "@/lib/templates";

/** A mousedown/mouseup pair further apart than this (screen px) is a drag, not a click-to-place. */
const CLICK_MAX_DRAG_PX = 6;

export function TurbineDrawHandler() {
  const templateMode = useMissionStore((s) => s.templateMode);
  const setTemplateMode = useMissionStore((s) => s.setTemplateMode);
  const appendWaypoints = useMissionStore((s) => s.appendWaypoints);
  const replaceTemplateGroup = useMissionStore((s) => s.replaceTemplateGroup);
  const editingTemplateGroupId = useMissionStore(
    (s) => s.editingTemplateGroupId,
  );
  const setEditingTemplateGroupId = useMissionStore(
    (s) => s.setEditingTemplateGroupId,
  );
  const templateGroups = useMissionStore((s) => s.templateGroups);
  const pois = useMissionStore((s) => s.pois);
  const pendingPresetLoad = useMissionStore((s) => s.pendingPresetLoad);
  const setPendingPresetLoad = useMissionStore((s) => s.setPendingPresetLoad);
  const pendingPresetForThisHandler =
    pendingPresetLoad?.type === "turbine" ? pendingPresetLoad : null;
  const { current: map } = useMap();

  const [confirmed, setConfirmed] = useState(false);
  const [turbineParams, setTurbineParams] = useState<TurbineParams | null>(
    null,
  );

  const downPos = useRef<{ x: number; y: number } | null>(null);

  const resetState = useCallback(() => {
    downPos.current = null;
    setConfirmed(false);
    setTurbineParams(null);
  }, []);

  useEffect(() => {
    if (editingTemplateGroupId || pendingPresetForThisHandler) return;
    resetState();
  }, [
    templateMode,
    editingTemplateGroupId,
    pendingPresetForThisHandler,
    resetState,
  ]);

  // A saved "turbine" template preset was loaded: same one-shot seed
  // pattern as PencilDrawHandler/CorridorDrawHandler — doesn't clear
  // pendingPresetLoad here (cleared explicitly in handleApply/handleCancel
  // instead), so the sibling reset-effect above doesn't wipe this out on
  // the very next render.
  useEffect(() => {
    if (!pendingPresetForThisHandler) return;
    const params = pendingPresetForThisHandler.params as TurbineParams;
    setTurbineParams(params);
    setConfirmed(true);
    if (useMissionStore.getState().templateMode !== "turbine") {
      setTemplateMode("turbine");
    }
  }, [pendingPresetForThisHandler, setTemplateMode]);

  // Reopening an already-applied turbine inspection for editing: reload
  // its stored params (including the original hub position) straight into
  // "confirmed" state — no need to re-click the hub to tweak e.g. blade
  // length or standoff distance.
  useEffect(() => {
    if (!editingTemplateGroupId) return;
    const group = templateGroups[editingTemplateGroupId];
    if (!group || group.type !== "turbine") return;

    const params = group.params as TurbineParams;
    setTurbineParams(params);
    setConfirmed(true);
    if (templateMode !== "turbine") {
      setTemplateMode("turbine");
    }
  }, [editingTemplateGroupId, templateGroups, templateMode, setTemplateMode]);

  // A single click (not a drag) places the hub at the clicked position
  // with default params — blade length, standoff, etc. are then adjusted
  // via the config panel's numeric fields rather than by dragging, since
  // there's no single "size" a drag gesture would naturally represent here.
  useEffect(() => {
    if (!map || templateMode !== "turbine") return;

    const onMouseDown = (e: any) => {
      if (confirmed) return;
      downPos.current = { x: e.point.x, y: e.point.y };
    };

    const onMouseUp = (e: any) => {
      if (confirmed || !downPos.current) return;
      const dx = e.point.x - downPos.current.x;
      const dy = e.point.y - downPos.current.y;
      downPos.current = null;
      if (Math.hypot(dx, dy) > CLICK_MAX_DRAG_PX) return;

      const hubCenter: [number, number] = [e.lngLat.lat, e.lngLat.lng];
      setTurbineParams({ ...DEFAULT_TURBINE_PARAMS, hubCenter });
      setConfirmed(true);
    };

    map.on("mousedown", onMouseDown);
    map.on("mouseup", onMouseUp);

    return () => {
      map.off("mousedown", onMouseDown);
      map.off("mouseup", onMouseUp);
    };
  }, [map, templateMode, confirmed]);

  const preview = useMemo(() => {
    if (!turbineParams) return null;
    return generateTurbineInspection(turbineParams);
  }, [turbineParams]);

  if (templateMode !== "turbine") return null;

  const handleApply = () => {
    if (!preview || !turbineParams) {
      resetState();
      setPendingPresetLoad(null);
      return;
    }
    if (editingTemplateGroupId) {
      replaceTemplateGroup(
        editingTemplateGroupId,
        preview.waypoints,
        preview.pois,
        turbineParams,
      );
    } else {
      appendWaypoints(preview.waypoints, preview.pois, {
        type: "turbine",
        params: turbineParams,
      });
    }
    resetState();
    setPendingPresetLoad(null);
  };

  const handleCancel = () => {
    resetState();
    setTemplateMode(null);
    setEditingTemplateGroupId(null);
    setPendingPresetLoad(null);
  };

  return (
    <>
      {/* Preview waypoints */}
      {confirmed && preview && <TemplatePreview result={preview} />}

      {/* Config panel */}
      {confirmed && turbineParams && (
        <TemplateConfigPanel
          type="turbine"
          turbineParams={turbineParams}
          onTurbineChange={setTurbineParams}
          onApply={handleApply}
          onCancel={handleCancel}
          waypointCount={preview?.waypoints.length ?? 0}
          pois={pois}
        />
      )}
    </>
  );
}
