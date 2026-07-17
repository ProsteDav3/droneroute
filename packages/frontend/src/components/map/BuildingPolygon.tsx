import { Source, Layer, Marker } from "react-map-gl/mapbox";
import type { Building } from "@droneroute/shared";
import { useMissionStore } from "@/store/missionStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { heightLabel, toDisplayHeight } from "@/lib/units";
import { useMemo } from "react";
import { EdgeLengthLabels } from "./EdgeLengthLabels";

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
  const removeBuildingVertex = useMissionStore((s) => s.removeBuildingVertex);
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);

  const isSelected = selectedBuildingId === building.id;

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

  const sourceId = `building-${building.id}`;

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
          id={`${sourceId}-fill-2d`}
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
          id={`${sourceId}-fill-3d`}
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
          id={`${sourceId}-outline`}
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
          >
            <div
              onClick={(e) => {
                e.stopPropagation();
                addBuildingVertex(building.id, i, pos[0], pos[1]);
              }}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#bfdbfe",
                border: "1px solid #3b82f6",
                cursor: "pointer",
                opacity: 0.7,
              }}
            />
          </Marker>
        ))}
    </>
  );
}
