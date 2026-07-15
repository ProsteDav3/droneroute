import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Source, Layer, useMap } from "react-map-gl/mapbox";
import { useMissionStore } from "@/store/missionStore";
import { TemplateConfigPanel } from "./TemplateConfigPanel";
import { TemplatePreview } from "./TemplatePreview";
import type { CorridorParams } from "@/lib/templates";
import {
  generateCorridor,
  pathLength,
  DEFAULT_CORRIDOR_PARAMS,
} from "@/lib/templates";

const MIN_PATH_LENGTH_M = 10;

export function CorridorDrawHandler() {
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
    pendingPresetLoad?.type === "corridor" ? pendingPresetLoad : null;
  const { current: map } = useMap();

  const [rawPath, setRawPath] = useState<[number, number][]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [corridorParams, setCorridorParams] = useState<CorridorParams | null>(
    null,
  );

  const drawingRef = useRef(false);
  const pathRef = useRef<[number, number][]>([]);
  const lastPointTime = useRef(0);

  const resetState = useCallback(() => {
    drawingRef.current = false;
    pathRef.current = [];
    lastPointTime.current = 0;
    setRawPath([]);
    setConfirmed(false);
    setCorridorParams(null);
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

  // A saved "corridor" template preset was loaded: same one-shot seed
  // pattern as PencilDrawHandler's pendingPresetForThisHandler — doesn't
  // clear pendingPresetLoad here (cleared explicitly in handleApply/
  // handleCancel instead), so the sibling reset-effect above doesn't wipe
  // this out on the very next render.
  useEffect(() => {
    if (!pendingPresetForThisHandler) return;
    const params = pendingPresetForThisHandler.params as CorridorParams;
    setCorridorParams(params);
    setRawPath(params.path);
    drawingRef.current = false;
    setConfirmed(true);
    if (useMissionStore.getState().templateMode !== "corridor") {
      setTemplateMode("corridor");
    }
  }, [pendingPresetForThisHandler, setTemplateMode]);

  // Reopening an already-applied corridor for editing: reload its stored
  // params (including the originally drawn path) straight into "confirmed"
  // state — no need to redraw the path to tweak e.g. altitude or offset.
  useEffect(() => {
    if (!editingTemplateGroupId) return;
    const group = templateGroups[editingTemplateGroupId];
    if (!group || group.type !== "corridor") return;

    const params = group.params as CorridorParams;
    setCorridorParams(params);
    setRawPath(params.path);
    setConfirmed(true);
    if (templateMode !== "corridor") {
      setTemplateMode("corridor");
    }
  }, [editingTemplateGroupId, templateGroups, templateMode, setTemplateMode]);

  // Map mouse events for drawing the centerline
  useEffect(() => {
    if (!map || templateMode !== "corridor") return;

    const onMouseDown = (e: any) => {
      if (confirmed) return;
      e.preventDefault();
      map.getMap().dragPan.disable();
      const pos: [number, number] = [e.lngLat.lat, e.lngLat.lng];
      drawingRef.current = true;
      pathRef.current = [pos];
      lastPointTime.current = Date.now();
      setRawPath([pos]);
    };

    const onMouseMove = (e: any) => {
      if (!drawingRef.current) return;
      const now = Date.now();
      if (now - lastPointTime.current < 16) return;
      lastPointTime.current = now;
      const pos: [number, number] = [e.lngLat.lat, e.lngLat.lng];
      pathRef.current = [...pathRef.current, pos];
      setRawPath([...pathRef.current]);
    };

    const onMouseUp = (e: any) => {
      if (!drawingRef.current) return;
      map.getMap().dragPan.enable();
      drawingRef.current = false;

      const finalPos: [number, number] = [e.lngLat.lat, e.lngLat.lng];
      const finalPath = [...pathRef.current, finalPos];
      pathRef.current = finalPath;
      setRawPath(finalPath);

      const totalLen = pathLength(finalPath);
      if (totalLen < MIN_PATH_LENGTH_M) {
        resetState();
        return;
      }

      setCorridorParams({
        ...DEFAULT_CORRIDOR_PARAMS,
        path: finalPath,
      });
      setConfirmed(true);
    };

    map.on("mousedown", onMouseDown);
    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);

    return () => {
      map.off("mousedown", onMouseDown);
      map.off("mousemove", onMouseMove);
      map.off("mouseup", onMouseUp);
      map.getMap().dragPan.enable();
    };
  }, [map, templateMode, confirmed, resetState]);

  const preview = useMemo(() => {
    if (!corridorParams) return null;
    return generateCorridor(corridorParams);
  }, [corridorParams]);

  // GeoJSON for the raw drawn centerline
  const rawPathGeojson = useMemo(() => {
    if (rawPath.length < 2) return null;
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: rawPath.map(([lat, lng]) => [lng, lat]),
      },
    };
  }, [rawPath]);

  if (templateMode !== "corridor") return null;

  const handleApply = () => {
    if (!preview || !corridorParams) {
      resetState();
      setPendingPresetLoad(null);
      return;
    }
    if (editingTemplateGroupId) {
      replaceTemplateGroup(
        editingTemplateGroupId,
        preview.waypoints,
        preview.pois,
        corridorParams,
      );
    } else {
      appendWaypoints(preview.waypoints, preview.pois, {
        type: "corridor",
        params: corridorParams,
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
      {/* Raw centerline while drawing */}
      {rawPathGeojson && (
        <Source id="corridor-raw-path" type="geojson" data={rawPathGeojson}>
          <Layer
            id="corridor-raw-path-layer"
            type="line"
            paint={{
              "line-color": "#fb923c",
              "line-width": confirmed ? 2 : 3,
              "line-opacity": confirmed ? 0.25 : 0.8,
            }}
          />
        </Source>
      )}

      {/* Preview waypoints */}
      {confirmed && preview && <TemplatePreview result={preview} />}

      {/* Config panel */}
      {confirmed && corridorParams && (
        <TemplateConfigPanel
          type="corridor"
          corridorParams={corridorParams}
          onCorridorChange={setCorridorParams}
          onApply={handleApply}
          onCancel={handleCancel}
          waypointCount={preview?.waypoints.length ?? 0}
          pois={pois}
        />
      )}
    </>
  );
}
