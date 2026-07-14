import { useState, useCallback, useMemo, useEffect } from "react";
import { Source, Layer, Marker, useMap } from "react-map-gl/mapbox";
import { useMissionStore } from "@/store/missionStore";
import { TemplateConfigPanel } from "./TemplateConfigPanel";
import { TemplatePreview } from "./TemplatePreview";
import type { SolarParams } from "@/lib/templates";
import { generateSolarSurvey, DEFAULT_SOLAR_PARAMS } from "@/lib/templates";

/**
 * Draws the boundary of a solar panel array to survey: click to place
 * vertices tracing its outline (square, rectangle, or any other shape),
 * click near the first vertex (or double-click) to close it. Mirrors
 * ObstacleDrawHandler's interaction, but produces a template config panel
 * with a live clipped-to-shape flight path preview instead of an obstacle.
 */
export function SolarDrawHandler() {
  const templateMode = useMissionStore((s) => s.templateMode);
  const setTemplateMode = useMissionStore((s) => s.setTemplateMode);
  const appendWaypoints = useMissionStore((s) => s.appendWaypoints);
  const { current: map } = useMap();

  const [vertices, setVertices] = useState<[number, number][]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [solarParams, setSolarParams] = useState<SolarParams | null>(null);

  const resetState = useCallback(() => {
    setVertices([]);
    setConfirmed(false);
    setSolarParams(null);
  }, []);

  useEffect(() => {
    resetState();
  }, [templateMode, resetState]);

  const closeShape = useCallback((verts: [number, number][]) => {
    if (verts.length < 3) return;
    setSolarParams({ ...DEFAULT_SOLAR_PARAMS, vertices: verts });
    setConfirmed(true);
  }, []);

  // Escape cancels drawing (or the whole template if nothing drawn yet)
  useEffect(() => {
    if (templateMode !== "solar") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (confirmed || vertices.length > 0) {
          resetState();
        } else {
          setTemplateMode(null);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [templateMode, confirmed, vertices.length, resetState, setTemplateMode]);

  // Map click handler for placing vertices
  useEffect(() => {
    if (templateMode !== "solar" || confirmed || !map) return;

    const handleClick = (e: any) => {
      const newVertex: [number, number] = [e.lngLat.lat, e.lngLat.lng];

      if (vertices.length >= 3) {
        const [firstLat, firstLng] = vertices[0];
        const firstPoint = map.project([firstLng, firstLat]);
        const clickPoint = map.project([e.lngLat.lng, e.lngLat.lat]);
        const dist = Math.sqrt(
          (firstPoint.x - clickPoint.x) ** 2 +
            (firstPoint.y - clickPoint.y) ** 2,
        );
        if (dist < 15) {
          closeShape(vertices);
          return;
        }
      }

      setVertices([...vertices, newVertex]);
    };

    const handleDblClick = (e: any) => {
      e.preventDefault();
      closeShape(vertices);
    };

    map.on("click", handleClick);
    map.on("dblclick", handleDblClick);
    return () => {
      map.off("click", handleClick);
      map.off("dblclick", handleDblClick);
    };
  }, [templateMode, confirmed, map, vertices, closeShape]);

  const preview = useMemo(() => {
    if (!solarParams) return null;
    return generateSolarSurvey(solarParams);
  }, [solarParams]);

  // GeoJSON for the boundary being drawn
  const lineGeojson = useMemo(() => {
    if (vertices.length < 2) return null;
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: vertices.map(([lat, lng]) => [lng, lat]),
      },
    };
  }, [vertices]);

  const closingGeojson = useMemo(() => {
    if (vertices.length < 3) return null;
    const first = vertices[0];
    const last = vertices[vertices.length - 1];
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [last[1], last[0]],
          [first[1], first[0]],
        ],
      },
    };
  }, [vertices]);

  if (templateMode !== "solar") return null;

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
      {!confirmed && (
        <>
          {vertices.map((pos, i) => (
            <Marker
              key={`solar-v-${i}`}
              longitude={pos[1]}
              latitude={pos[0]}
              anchor="center"
            >
              <div
                style={{
                  width: i === 0 ? 14 : 10,
                  height: i === 0 ? 14 : 10,
                  borderRadius: "50%",
                  background: i === 0 ? "#fde047" : "#ffffff",
                  border: "2px solid #eab308",
                }}
              />
            </Marker>
          ))}

          {lineGeojson && (
            <Source id="solar-drawing-line" type="geojson" data={lineGeojson}>
              <Layer
                id="solar-drawing-line-layer"
                type="line"
                paint={{
                  "line-color": "#eab308",
                  "line-width": 2,
                  "line-opacity": 0.8,
                  "line-dasharray": [3, 2],
                }}
              />
            </Source>
          )}

          {closingGeojson && (
            <Source
              id="solar-closing-line"
              type="geojson"
              data={closingGeojson}
            >
              <Layer
                id="solar-closing-line-layer"
                type="line"
                paint={{
                  "line-color": "#eab308",
                  "line-width": 1.5,
                  "line-opacity": 0.4,
                  "line-dasharray": [2, 3],
                }}
              />
            </Source>
          )}
        </>
      )}

      {confirmed && preview && <TemplatePreview result={preview} />}

      {confirmed && solarParams && (
        <TemplateConfigPanel
          type="solar"
          solarParams={solarParams}
          onSolarChange={setSolarParams}
          onApply={handleApply}
          onCancel={handleCancel}
          waypointCount={preview?.waypoints.length ?? 0}
        />
      )}
    </>
  );
}
