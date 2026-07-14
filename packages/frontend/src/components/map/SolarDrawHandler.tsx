import { useState, useCallback, useMemo, useEffect } from "react";
import { Source, Layer, Marker, useMap } from "react-map-gl/mapbox";
import { useMissionStore } from "@/store/missionStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { TemplateConfigPanel } from "./TemplateConfigPanel";
import { TemplatePreview } from "./TemplatePreview";
import type { SolarParams } from "@/lib/templates";
import {
  generateSolarSurvey,
  DEFAULT_SOLAR_PARAMS,
  bearing,
} from "@/lib/templates";
import { haversineDistance } from "@/lib/geo";
import { toDisplayDistance, distanceLabel } from "@/lib/units";

/** Small map label showing the distance between two points, at their midpoint. */
function EdgeLengthLabel({
  a,
  b,
}: {
  a: [number, number];
  b: [number, number];
}) {
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  const distM = haversineDistance(a[0], a[1], b[0], b[1]);
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return (
    <Marker longitude={mid[1]} latitude={mid[0]} anchor="center">
      <div className="pointer-events-none px-1 py-0.5 rounded bg-yellow-950/70 border border-yellow-400/50 text-[10px] font-mono text-yellow-200 whitespace-nowrap">
        {Math.round(toDisplayDistance(distM, unitSystem))}
        {distanceLabel(unitSystem)}
      </div>
    </Marker>
  );
}

/** Edge-length labels for every side of a (possibly still-open) traced polygon. */
function EdgeLengthLabels({
  vertices,
  closed,
}: {
  vertices: [number, number][];
  closed: boolean;
}) {
  if (vertices.length < 2) return null;
  const edges: [[number, number], [number, number]][] = [];
  for (let i = 0; i + 1 < vertices.length; i++) {
    edges.push([vertices[i], vertices[i + 1]]);
  }
  if (closed && vertices.length >= 3) {
    edges.push([vertices[vertices.length - 1], vertices[0]]);
  }
  return (
    <>
      {edges.map(([a, b], i) => (
        <EdgeLengthLabel key={`edge-${i}`} a={a} b={b} />
      ))}
    </>
  );
}

/**
 * Draws the boundary of a solar panel array to survey: click to place
 * vertices tracing its outline (square, rectangle, or any other shape),
 * click near the first vertex (or double-click) to close it. Mirrors
 * ObstacleDrawHandler's interaction. Once the boundary closes, a second
 * step asks for a 2-click reference line along one row of panels — this
 * sets the exact flight-line direction instead of guessing it from the
 * traced shape's longest edge, since that guess doesn't always match how
 * the panels are actually laid out. Only then does the template config
 * panel appear with a live clipped-to-shape flight path preview.
 */
export function SolarDrawHandler() {
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
  const { current: map } = useMap();

  const [vertices, setVertices] = useState<[number, number][]>([]);
  const [closedVertices, setClosedVertices] = useState<
    [number, number][] | null
  >(null);
  const [anglePoints, setAnglePoints] = useState<[number, number][]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [solarParams, setSolarParams] = useState<SolarParams | null>(null);

  const resetState = useCallback(() => {
    setVertices([]);
    setClosedVertices(null);
    setAnglePoints([]);
    setConfirmed(false);
    setSolarParams(null);
  }, []);

  useEffect(() => {
    if (editingTemplateGroupId) return;
    resetState();
  }, [templateMode, editingTemplateGroupId, resetState]);

  // Reopening an already-applied solar survey for editing: load its stored
  // params straight into "confirmed" state, skipping the drawing gesture.
  useEffect(() => {
    if (!editingTemplateGroupId) return;
    const group = templateGroups[editingTemplateGroupId];
    if (!group || group.type !== "solar") return;

    setSolarParams(group.params as SolarParams);
    setVertices((group.params as SolarParams).vertices);
    setConfirmed(true);
    if (templateMode !== "solar") {
      setTemplateMode("solar");
    }
  }, [editingTemplateGroupId, templateGroups, templateMode, setTemplateMode]);

  const closeShape = useCallback((verts: [number, number][]) => {
    if (verts.length < 3) return;
    setVertices([]);
    setClosedVertices(verts);
  }, []);

  // Escape cancels drawing (or the whole template if nothing drawn yet)
  useEffect(() => {
    if (templateMode !== "solar") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (confirmed || vertices.length > 0 || closedVertices) {
          resetState();
          setEditingTemplateGroupId(null);
        } else {
          setTemplateMode(null);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    templateMode,
    confirmed,
    vertices.length,
    closedVertices,
    resetState,
    setTemplateMode,
    setEditingTemplateGroupId,
  ]);

  // Step 1: map click handler for placing boundary vertices
  useEffect(() => {
    if (templateMode !== "solar" || confirmed || closedVertices || !map) return;

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
  }, [templateMode, confirmed, closedVertices, map, vertices, closeShape]);

  // Step 2: map click handler for the 2-click row-direction reference line
  useEffect(() => {
    if (templateMode !== "solar" || confirmed || !closedVertices || !map)
      return;

    const handleClick = (e: any) => {
      const pt: [number, number] = [e.lngLat.lat, e.lngLat.lng];
      setAnglePoints((prev) => {
        if (prev.length >= 2) return prev;
        const next = [...prev, pt];
        if (next.length === 2) {
          const rowAngleDeg = bearing(
            next[0][0],
            next[0][1],
            next[1][0],
            next[1][1],
          );
          setSolarParams({
            ...DEFAULT_SOLAR_PARAMS,
            vertices: closedVertices,
            rowAngleDeg,
          });
          setConfirmed(true);
        }
        return next;
      });
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [templateMode, confirmed, closedVertices, map]);

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

  // Closed boundary outline, shown while drawing the reference angle line
  const closedGeojson = useMemo(() => {
    if (!closedVertices) return null;
    const ring = [
      ...closedVertices.map(([lat, lng]) => [lng, lat]),
      [closedVertices[0][1], closedVertices[0][0]],
    ];
    return {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Polygon" as const, coordinates: [ring] },
    };
  }, [closedVertices]);

  const angleLineGeojson = useMemo(() => {
    if (anglePoints.length < 2) return null;
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: anglePoints.map(([lat, lng]) => [lng, lat]),
      },
    };
  }, [anglePoints]);

  if (templateMode !== "solar") return null;

  const handleApply = () => {
    if (!preview || !solarParams) {
      resetState();
      return;
    }
    if (editingTemplateGroupId) {
      replaceTemplateGroup(
        editingTemplateGroupId,
        preview.waypoints,
        preview.pois,
        solarParams,
      );
    } else {
      appendWaypoints(preview.waypoints, preview.pois, {
        type: "solar",
        params: solarParams,
      });
    }
    resetState();
  };

  const handleCancel = () => {
    resetState();
    setTemplateMode(null);
    setEditingTemplateGroupId(null);
  };

  return (
    <>
      {!confirmed && !closedVertices && (
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

          <EdgeLengthLabels vertices={vertices} closed={false} />

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

      {!confirmed && closedVertices && (
        <>
          <EdgeLengthLabels vertices={closedVertices} closed={true} />

          {closedGeojson && (
            <Source id="solar-closed-shape" type="geojson" data={closedGeojson}>
              <Layer
                id="solar-closed-shape-fill"
                type="fill"
                paint={{ "fill-color": "#eab308", "fill-opacity": 0.1 }}
              />
              <Layer
                id="solar-closed-shape-outline"
                type="line"
                paint={{ "line-color": "#eab308", "line-width": 2 }}
              />
            </Source>
          )}

          {anglePoints.map((pos, i) => (
            <Marker
              key={`solar-angle-${i}`}
              longitude={pos[1]}
              latitude={pos[0]}
              anchor="center"
            >
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: "#67e8f9",
                  border: "2px solid #0891b2",
                }}
              />
            </Marker>
          ))}

          {angleLineGeojson && (
            <Source
              id="solar-angle-line"
              type="geojson"
              data={angleLineGeojson}
            >
              <Layer
                id="solar-angle-line-layer"
                type="line"
                paint={{
                  "line-color": "#0891b2",
                  "line-width": 3,
                  "line-opacity": 0.9,
                }}
              />
            </Source>
          )}

          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 bg-card/95 backdrop-blur-sm border border-border rounded-md shadow-lg px-3 py-1.5 text-xs">
            Click two points along a solar panel row to set the flight direction
            ({anglePoints.length}/2)
          </div>
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
