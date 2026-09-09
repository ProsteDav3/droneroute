import { Source, Layer, Marker } from "react-map-gl/mapbox";
import type { Building } from "@droneroute/shared";
import { useMissionStore } from "@/store/missionStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { heightLabel, toDisplayHeight } from "@/lib/units";
import { useMemo, useRef } from "react";
import { EdgeLengthLabels } from "./EdgeLengthLabels";
import {
  buildingFillLayerIds,
  buildingOutlineLayerId,
  buildingSourceId,
} from "@/lib/buildingLayers";

const BUILDING_EDGE_LABEL_CLASS_NAME =
  "pointer-events-none px-1 py-0.5 rounded bg-blue-950/70 border border-blue-400/50 text-[10px] font-mono text-blue-200 whitespace-nowrap";
/** Nudged up from the edge midpoint so it doesn't sit exactly on top of the "click to insert a vertex" handle placed at the same spot when the building is selected. */
const BUILDING_EDGE_LABEL_OFFSET: [number, number] = [0, -14];

interface BuildingPolygonProps {
  building: Building;
  is3D: boolean;
}

export function BuildingPolygon({ building, is3D }: BuildingPolygonProps) {
  const selectedBuildingId = useMissionStore((s) => s.selectedBuildingId);
  const moveBuildingVertex = useMissionStore((s) => s.moveBuildingVertex);
  const addBuildingVertex = useMissionStore((s) => s.addBuildingVertex);
  const moveBuildingVertices = useMissionStore((s) => s.moveBuildingVertices);
  const removeBuildingVertex = useMissionStore((s) => s.removeBuildingVertex);
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);

  const isSelected = selectedBuildingId === building.id;

  /**
   * The wall being dragged, captured once when the drag starts.
   *
   * Every move has to be measured against where the wall stood before the
   * gesture, not against where it stands now: the store updates on each
   * frame, so measuring against the live footprint would apply each frame's
   * offset on top of the last and send the wall off at several times the
   * speed of the cursor.
   */
  const edgeDragRef = useRef<{
    edgeIndex: number;
    from: [number, number];
    a: [number, number];
    b: [number, number];
    moved: boolean;
  } | null>(null);

  const handleEdgeDrag = (lat: number, lng: number) => {
    const drag = edgeDragRef.current;
    if (!drag) return;
    const dLat = lat - drag.from[0];
    const dLng = lng - drag.from[1];
    if (dLat === 0 && dLng === 0) return;
    drag.moved = true;

    const next = (drag.edgeIndex + 1) % building.vertices.length;
    moveBuildingVertices(building.id, [
      {
        vertexIndex: drag.edgeIndex,
        lat: drag.a[0] + dLat,
        lng: drag.a[1] + dLng,
      },
      { vertexIndex: next, lat: drag.b[0] + dLat, lng: drag.b[1] + dLng },
    ]);
  };

  const geojson = useMemo(() => {
    const ring = [
      ...building.vertices.map(([lat, lng]) => [lng, lat]),
      [building.vertices[0][1], building.vertices[0][0]],
    ];
    return {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Polygon" as const, coordinates: [ring] },
    };
  }, [building.vertices]);

  const midpoints = useMemo(() => {
    if (!isSelected || building.vertices.length < 2) return [];
    return building.vertices.map((curr, i) => {
      const next = building.vertices[(i + 1) % building.vertices.length];
      return [(curr[0] + next[0]) / 2, (curr[1] + next[1]) / 2] as [
        number,
        number,
      ];
    });
  }, [isSelected, building.vertices]);

  const centroid = useMemo((): [number, number] => {
    const lat =
      building.vertices.reduce((sum, v) => sum + v[0], 0) /
      building.vertices.length;
    const lng =
      building.vertices.reduce((sum, v) => sum + v[1], 0) /
      building.vertices.length;
    return [lat, lng];
  }, [building.vertices]);

  const sourceId = buildingSourceId(building.id);
  const [fill2dLayerId, fill3dLayerId] = buildingFillLayerIds(building.id);

  return (
    <>
      <Source id={sourceId} type="geojson" data={geojson}>
        {/* Both layers always mounted, toggled by `visibility` rather than
         * switching one Layer's `type` between "fill" and "fill-extrusion"
         * for the same id — react-map-gl's Layer asserts a layer's type
         * never changes after creation and silently no-ops (just a
         * console.warn) if it does, since Mapbox GL JS itself can't change
         * a layer's type in place. Whichever mode this building's Layer
         * first mounted in would otherwise stick forever, regardless of
         * later is3D toggles — this is why buildings kept rendering flat
         * even in 3D mode. `visibility: "none"` (not `opacity: 0`) so the
         * hidden layer is actually skipped by the renderer instead of still
         * being rasterized fully transparent — with many buildings this
         * doubling of active fill-extrusion draws was a real contributor to
         * general 3D sluggishness. */}
        <Layer
          id={fill2dLayerId}
          type="fill"
          layout={{ visibility: is3D ? "none" : "visible" }}
          paint={{
            "fill-color": "#3b82f6",
            "fill-opacity": isSelected ? 0.22 : 0.12,
          }}
        />
        {/* Real 3D extrusion at the building's actual height, matching the
         * look of the source OSM buildings this is often converted from —
         * a flat ground rectangle doesn't convey size at all. */}
        <Layer
          id={fill3dLayerId}
          type="fill-extrusion"
          layout={{ visibility: is3D ? "visible" : "none" }}
          paint={{
            "fill-extrusion-color": "#3b82f6",
            "fill-extrusion-height": building.height,
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": isSelected ? 0.75 : 0.55,
          }}
        />
        <Layer
          id={buildingOutlineLayerId(building.id)}
          type="line"
          paint={{
            "line-color": "#3b82f6",
            "line-width": isSelected ? 3 : 2,
            "line-opacity": isSelected ? 1 : 0.7,
          }}
        />
      </Source>

      <Marker longitude={centroid[1]} latitude={centroid[0]} anchor="center">
        <div className="pointer-events-none px-1.5 py-0.5 rounded bg-blue-950/70 border border-blue-400/50 text-[10px] font-mono text-blue-200 whitespace-nowrap">
          {building.name} &middot; H:{" "}
          {toDisplayHeight(building.height, unitSystem)}
          {heightLabel(unitSystem)}
        </div>
      </Marker>

      <EdgeLengthLabels
        vertices={building.vertices}
        closed
        labelClassName={BUILDING_EDGE_LABEL_CLASS_NAME}
        offset={BUILDING_EDGE_LABEL_OFFSET}
      />

      {isSelected &&
        building.vertices.map((pos, i) => (
          <Marker
            key={`building-v-${building.id}-${i}`}
            longitude={pos[1]}
            latitude={pos[0]}
            anchor="center"
            draggable
            onDragEnd={(e) => {
              moveBuildingVertex(building.id, i, e.lngLat.lat, e.lngLat.lng);
            }}
          >
            <div
              onContextMenu={(e) => {
                e.preventDefault();
                if (building.vertices.length > 3) {
                  removeBuildingVertex(building.id, i);
                }
              }}
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#fff",
                border: "2px solid #3b82f6",
                cursor: "move",
              }}
            />
          </Marker>
        ))}

      {isSelected &&
        midpoints.map((pos, i) => (
          <Marker
            key={`building-mid-${building.id}-${i}`}
            longitude={pos[1]}
            latitude={pos[0]}
            anchor="center"
            draggable
            onDragStart={() => {
              const next = (i + 1) % building.vertices.length;
              edgeDragRef.current = {
                edgeIndex: i,
                from: pos,
                a: building.vertices[i],
                b: building.vertices[next],
                moved: false,
              };
            }}
            onDrag={(e) => handleEdgeDrag(e.lngLat.lat, e.lngLat.lng)}
            onDragEnd={(e) => handleEdgeDrag(e.lngLat.lat, e.lngLat.lng)}
          >
            <div
              onClick={(e) => {
                e.stopPropagation();
                // A drag ends with a click too. Adding a vertex there would
                // undo the wall the operator just moved, by putting a corner
                // in the middle of it.
                if (edgeDragRef.current?.moved) {
                  edgeDragRef.current = null;
                  return;
                }
                edgeDragRef.current = null;
                addBuildingVertex(building.id, i, pos[0], pos[1]);
              }}
              title="Tažením posunete celou stranu, kliknutím přidáte roh"
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#bfdbfe",
                border: "1px solid #3b82f6",
                cursor: "move",
                opacity: 0.85,
              }}
            />
          </Marker>
        ))}
    </>
  );
}
