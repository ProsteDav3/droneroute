import { useState, useCallback, useMemo, useEffect } from "react";
import { Source, Layer, Marker, useMap } from "react-map-gl/mapbox";
import { useMissionStore } from "@/store/missionStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";
import { heightLabel, toDisplayHeight, fromDisplayHeight } from "@/lib/units";

const DEFAULT_BUILDING_HEIGHT_M = 20;

interface DragState {
  start: [number, number];
  end: [number, number];
}

/** Four corners of the axis-aligned rectangle spanned by two opposite corners. */
function rectangleVertices(
  corner1: [number, number],
  corner2: [number, number],
): [number, number][] {
  const [lat1, lng1] = corner1;
  const [lat2, lng2] = corner2;
  return [
    [lat1, lng1],
    [lat1, lng2],
    [lat2, lng2],
    [lat2, lng1],
  ];
}

function ringGeojson(vertices: [number, number][]) {
  if (vertices.length < 2) return null;
  const coords = vertices.map(([lat, lng]) => [lng, lat]);
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: coords },
  };
}

/**
 * Handles building footprint drawing on the map — either a 2-corner
 * click-and-drag rectangle, or a click-to-place polygon (mirrors
 * ObstacleDrawHandler's vertex loop). Once a shape is finalized, a small
 * panel asks for the building's height before committing it.
 */
export function BuildingDrawHandler() {
  const isDrawingBuilding = useMissionStore((s) => s.isDrawingBuilding);
  const buildingDrawMode = useMissionStore((s) => s.buildingDrawMode);
  const drawingBuildingVertices = useMissionStore(
    (s) => s.drawingBuildingVertices,
  );
  const setDrawingBuildingVertices = useMissionStore(
    (s) => s.setDrawingBuildingVertices,
  );
  const addBuilding = useMissionStore((s) => s.addBuilding);
  const setIsDrawingBuilding = useMissionStore((s) => s.setIsDrawingBuilding);
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  const { current: map } = useMap();

  const [dragging, setDragging] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [pendingVertices, setPendingVertices] = useState<
    [number, number][] | null
  >(null);
  const [height, setHeight] = useState(DEFAULT_BUILDING_HEIGHT_M);

  const resetState = useCallback(() => {
    setDragging(false);
    setDragState(null);
    setPendingVertices(null);
    setHeight(DEFAULT_BUILDING_HEIGHT_M);
  }, []);

  // Reset local drawing state whenever drawing is toggled off or the
  // rectangle/polygon sub-mode changes.
  useEffect(() => {
    resetState();
  }, [isDrawingBuilding, buildingDrawMode, resetState]);

  // Escape cancels the shape in progress and exits drawing mode.
  useEffect(() => {
    if (!isDrawingBuilding) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawingBuildingVertices([]);
        setIsDrawingBuilding(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isDrawingBuilding, setDrawingBuildingVertices, setIsDrawingBuilding]);

  // Rectangle mode: click-and-drag two opposite corners.
  useEffect(() => {
    if (!map || !isDrawingBuilding || buildingDrawMode !== "rectangle") return;

    let isDragging = false;
    let currentDrag: DragState | null = null;

    const onMouseDown = (e: any) => {
      if (pendingVertices) return;
      e.preventDefault();
      map.getMap().dragPan.disable();
      const pos: [number, number] = [e.lngLat.lat, e.lngLat.lng];
      isDragging = true;
      currentDrag = { start: pos, end: pos };
      setDragging(true);
      setDragState(currentDrag);
    };

    const onMouseMove = (e: any) => {
      if (!isDragging || !currentDrag) return;
      currentDrag = { ...currentDrag, end: [e.lngLat.lat, e.lngLat.lng] };
      setDragState({ ...currentDrag });
    };

    const onMouseUp = (e: any) => {
      if (!isDragging || !currentDrag) return;
      map.getMap().dragPan.enable();
      isDragging = false;

      const endPos: [number, number] = [e.lngLat.lat, e.lngLat.lng];
      const finalDrag = { ...currentDrag, end: endPos };
      setDragging(false);
      setDragState(null);

      const tooSmall =
        Math.abs(finalDrag.start[0] - finalDrag.end[0]) < 0.00001 &&
        Math.abs(finalDrag.start[1] - finalDrag.end[1]) < 0.00001;
      if (!tooSmall) {
        setPendingVertices(rectangleVertices(finalDrag.start, finalDrag.end));
      }
      currentDrag = null;
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
  }, [map, isDrawingBuilding, buildingDrawMode, pendingVertices]);

  // Polygon mode: click to place vertices, close near first vertex or double-click.
  useEffect(() => {
    if (!map || !isDrawingBuilding || buildingDrawMode !== "polygon") return;

    const handleClick = (e: any) => {
      if (pendingVertices) return;
      const newVertex: [number, number] = [e.lngLat.lat, e.lngLat.lng];
      const currentVertices =
        useMissionStore.getState().drawingBuildingVertices;

      if (currentVertices.length >= 3) {
        const [firstLat, firstLng] = currentVertices[0];
        const firstPoint = map.project([firstLng, firstLat]);
        const clickPoint = map.project([e.lngLat.lng, e.lngLat.lat]);
        const dist = Math.sqrt(
          (firstPoint.x - clickPoint.x) ** 2 +
            (firstPoint.y - clickPoint.y) ** 2,
        );
        if (dist < 15) {
          setPendingVertices(currentVertices);
          setDrawingBuildingVertices([]);
          return;
        }
      }

      setDrawingBuildingVertices([...currentVertices, newVertex]);
    };

    const handleDblClick = (e: any) => {
      e.preventDefault();
      const verts = useMissionStore.getState().drawingBuildingVertices;
      if (verts.length >= 3) {
        setPendingVertices(verts);
        setDrawingBuildingVertices([]);
      }
    };

    map.on("click", handleClick);
    map.on("dblclick", handleDblClick);
    return () => {
      map.off("click", handleClick);
      map.off("dblclick", handleDblClick);
    };
  }, [
    map,
    isDrawingBuilding,
    buildingDrawMode,
    pendingVertices,
    setDrawingBuildingVertices,
  ]);

  const dragGuideGeojson = useMemo(() => {
    if (!dragging || !dragState) return null;
    return ringGeojson(rectangleVertices(dragState.start, dragState.end));
  }, [dragging, dragState]);

  const polygonGuideGeojson = useMemo(
    () => ringGeojson(drawingBuildingVertices),
    [drawingBuildingVertices],
  );

  const pendingGeojson = useMemo(() => {
    if (!pendingVertices) return null;
    return ringGeojson([...pendingVertices, pendingVertices[0]]);
  }, [pendingVertices]);

  const handleApply = () => {
    if (!pendingVertices) return;
    addBuilding(pendingVertices, height);
  };

  const handleCancel = () => {
    resetState();
  };

  if (!isDrawingBuilding) return null;

  return (
    <>
      {buildingDrawMode === "polygon" &&
        drawingBuildingVertices.map((pos, i) => (
          <Marker
            key={`building-draw-v-${i}`}
            longitude={pos[1]}
            latitude={pos[0]}
            anchor="center"
          >
            <div
              style={{
                width: i === 0 ? 14 : 10,
                height: i === 0 ? 14 : 10,
                borderRadius: "50%",
                background: i === 0 ? "#93c5fd" : "#ffffff",
                border: "2px solid #3b82f6",
              }}
            />
          </Marker>
        ))}

      {dragGuideGeojson && (
        <Source id="building-drag-guide" type="geojson" data={dragGuideGeojson}>
          <Layer
            id="building-drag-guide-layer"
            type="line"
            paint={{
              "line-color": "#3b82f6",
              "line-width": 2,
              "line-opacity": 0.6,
              "line-dasharray": [3, 2],
            }}
          />
        </Source>
      )}

      {polygonGuideGeojson && (
        <Source
          id="building-polygon-guide"
          type="geojson"
          data={polygonGuideGeojson}
        >
          <Layer
            id="building-polygon-guide-layer"
            type="line"
            paint={{
              "line-color": "#3b82f6",
              "line-width": 2,
              "line-opacity": 0.8,
              "line-dasharray": [3, 2],
            }}
          />
        </Source>
      )}

      {pendingGeojson && (
        <Source id="building-pending" type="geojson" data={pendingGeojson}>
          <Layer
            id="building-pending-fill-layer"
            type="fill"
            paint={{ "fill-color": "#3b82f6", "fill-opacity": 0.15 }}
          />
          <Layer
            id="building-pending-line-layer"
            type="line"
            paint={{ "line-color": "#3b82f6", "line-width": 2 }}
          />
        </Source>
      )}

      {pendingVertices && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-2xl p-3 min-w-[220px]">
          <div className="text-xs font-semibold mb-2">Building</div>
          <Label
            className="text-[10px]"
            title="Real height of the building, above ground — used to recommend an orbit altitude, radius, and gimbal pitch when a POI is placed on it."
          >
            Height ({heightLabel(unitSystem)})
          </Label>
          <NumericInput
            value={toDisplayHeight(height, unitSystem)}
            onChange={(v) => setHeight(fromDisplayHeight(v, unitSystem))}
            min={1}
            step={1}
            fallback={DEFAULT_BUILDING_HEIGHT_M}
            className="h-7 text-xs"
          />
          <div className="flex gap-2 mt-2">
            <Button size="sm" onClick={handleApply} className="flex-1">
              <Check className="h-3 w-3" />
              Apply
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancel}
              className="flex-1"
            >
              <X className="h-3 w-3" />
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
