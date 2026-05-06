import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Source, Layer, useMap } from "react-map-gl/mapbox";
import { useMissionStore } from "@/store/missionStore";
import { TemplateConfigPanel } from "./TemplateConfigPanel";
import { TemplatePreview } from "./TemplatePreview";
import type { PencilParams } from "@/lib/templates";
import {
  generatePencil,
  pathLength,
  DEFAULT_PENCIL_PARAMS,
} from "@/lib/templates";

const MIN_PATH_LENGTH_M = 10;

export function PencilDrawHandler() {
  const templateMode = useMissionStore((s) => s.templateMode);
  const setTemplateMode = useMissionStore((s) => s.setTemplateMode);
  const appendWaypoints = useMissionStore((s) => s.appendWaypoints);
  const pois = useMissionStore((s) => s.pois);
  const { current: map } = useMap();

  const [rawPath, setRawPath] = useState<[number, number][]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [pencilParams, setPencilParams] = useState<PencilParams | null>(null);

  const drawingRef = useRef(false);
  const pathRef = useRef<[number, number][]>([]);
  const lastPointTime = useRef(0);

  const resetState = useCallback(() => {
    drawingRef.current = false;
    pathRef.current = [];
    lastPointTime.current = 0;
    setRawPath([]);
    setConfirmed(false);
    setPencilParams(null);
  }, []);

  useEffect(() => {
    resetState();
  }, [templateMode, resetState]);

  // Map mouse events for pencil drawing
  useEffect(() => {
    if (!map || templateMode !== "pencil") return;

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

      setPencilParams({
        ...DEFAULT_PENCIL_PARAMS,
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
    if (!pencilParams) return null;
    return generatePencil(pencilParams);
  }, [pencilParams]);

  // GeoJSON for the raw drawn path
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

  if (templateMode !== "pencil") return null;

  const handleApply = () => {
    if (preview) {
      appendWaypoints(preview.waypoints, preview.pois);
    }
    resetState();
  };

  const handleCancel = () => {
    resetState();
    setTemplateMode(null);
  };

  return (
    <>
      {/* Raw path while drawing */}
      {rawPathGeojson && (
        <Source id="pencil-raw-path" type="geojson" data={rawPathGeojson}>
          <Layer
            id="pencil-raw-path-layer"
            type="line"
            paint={{
              "line-color": "#a78bfa",
              "line-width": confirmed ? 2 : 3,
              "line-opacity": confirmed ? 0.25 : 0.8,
            }}
          />
        </Source>
      )}

      {/* Preview waypoints */}
      {confirmed && preview && <TemplatePreview result={preview} />}

      {/* Config panel */}
      {confirmed && pencilParams && (
        <TemplateConfigPanel
          type="pencil"
          pencilParams={pencilParams}
          onPencilChange={setPencilParams}
          onApply={handleApply}
          onCancel={handleCancel}
          waypointCount={preview?.waypoints.length ?? 0}
          pois={pois}
        />
      )}
    </>
  );
}
