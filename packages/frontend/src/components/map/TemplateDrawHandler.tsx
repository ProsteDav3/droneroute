import { useState, useCallback, useMemo, useEffect } from "react";
import { Source, Layer, Marker, useMap } from "react-map-gl/mapbox";
import { useMissionStore } from "@/store/missionStore";
import { TemplateConfigPanel } from "./TemplateConfigPanel";
import { TemplatePreview } from "./TemplatePreview";
import type {
  OrbitParams,
  GridParams,
  FacadeParams,
  TemplateResult,
} from "@/lib/templates";
import {
  generateOrbit,
  generateGrid,
  generateFacade,
  destinationPoint,
  bearing,
  computeGimbalPitch,
  DEFAULT_ORBIT_PARAMS,
  DEFAULT_GRID_PARAMS,
  DEFAULT_FACADE_PARAMS,
} from "@/lib/templates";

/** DEFAULT_ORBIT_PARAMS + a freshly-drawn center/radius, with gimbal pitch
 * recomputed for that radius instead of the static default. */
function initialOrbitParams(
  center: [number, number],
  radiusM: number,
): OrbitParams {
  const base = { ...DEFAULT_ORBIT_PARAMS, center, radiusM };
  return {
    ...base,
    gimbalPitchDeg: computeGimbalPitch(
      base.altitude,
      base.poiHeight,
      base.radiusM,
    ),
  };
}

/** Haversine distance in meters */
function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface DragState {
  start: [number, number];
  end: [number, number];
}

/** Generate a GeoJSON circle for orbit preview */
function circleGeoJson(center: [number, number], radiusM: number) {
  const [lat, lng] = center;
  const coords: [number, number][] = [];
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusM / 6371000) * Math.cos(angle) * (180 / Math.PI);
    const dLng =
      ((radiusM / 6371000) * Math.sin(angle) * (180 / Math.PI)) /
      Math.cos((lat * Math.PI) / 180);
    coords.push([lng + dLng, lat + dLat]);
  }
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: coords },
  };
}

/**
 * A draggable handle sitting on the orbit's center. Lets you nudge the
 * center after the fact — e.g. a searched address puts you close but not
 * exactly on the spot — without having to cancel and re-drag from scratch.
 * Only active while the config panel is open, before Apply.
 */
function OrbitCenterHandle({
  center,
  onMove,
}: {
  center: [number, number];
  onMove: (center: [number, number]) => void;
}) {
  const [lat, lng] = center;

  const handleDrag = useCallback(
    (e: { lngLat: { lng: number; lat: number } }) => {
      onMove([e.lngLat.lat, e.lngLat.lng]);
    },
    [onMove],
  );

  return (
    <Marker
      longitude={lng}
      latitude={lat}
      anchor="center"
      draggable
      onDrag={handleDrag}
    >
      <div
        title="Drag to move the orbit center"
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fbbf24",
          border: "3px solid #f59e0b",
          boxShadow: "0 0 0 4px rgba(251,191,36,0.35)",
          cursor: "grab",
        }}
      />
    </Marker>
  );
}

/**
 * A draggable handle sitting on the orbit's start bearing. Dragging it
 * rotates the whole arc (keeping its angular width constant) around the
 * center — lets you pick exactly where the first waypoint goes by eye,
 * without typing a start-angle number.
 */
function OrbitRotationHandle({
  orbitParams,
  onRotate,
}: {
  orbitParams: OrbitParams;
  onRotate: (startAngleDeg: number) => void;
}) {
  const { center, radiusM, startAngleDeg } = orbitParams;
  const [cLat, cLng] = center;
  const [hLat, hLng] = destinationPoint(cLat, cLng, radiusM, startAngleDeg);

  const handleDrag = useCallback(
    (e: { lngLat: { lng: number; lat: number } }) => {
      onRotate(bearing(cLat, cLng, e.lngLat.lat, e.lngLat.lng));
    },
    [cLat, cLng, onRotate],
  );

  return (
    <Marker
      longitude={hLng}
      latitude={hLat}
      anchor="center"
      draggable
      onDrag={handleDrag}
    >
      <div
        title="Drag to rotate the arc"
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#fff",
          border: "3px solid #a78bfa",
          boxShadow: "0 0 0 4px rgba(167,139,250,0.35)",
          cursor: "grab",
        }}
      />
    </Marker>
  );
}

export function TemplateDrawHandler() {
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
  const pendingOrbitParams = useMissionStore((s) => s.pendingOrbitParams);
  const setPendingOrbitParams = useMissionStore((s) => s.setPendingOrbitParams);
  const { current: map } = useMap();

  const [dragging, setDragging] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const [orbitParams, setOrbitParams] = useState<OrbitParams | null>(null);
  const [gridParams, setGridParams] = useState<GridParams | null>(null);
  const [facadeParams, setFacadeParams] = useState<FacadeParams | null>(null);

  const resetState = useCallback(() => {
    setDragging(false);
    setDragState(null);
    setConfirmed(false);
    setOrbitParams(null);
    setGridParams(null);
    setFacadeParams(null);
  }, []);

  useEffect(() => {
    if (editingTemplateGroupId || pendingOrbitParams) return;
    resetState();
  }, [templateMode, editingTemplateGroupId, pendingOrbitParams, resetState]);

  // A POI was placed on a building: open the Orbit panel pre-filled with a
  // recommended altitude/radius/gimbal pitch instead of an empty drag
  // gesture. Mirrors the editingTemplateGroupId reopen-effect below.
  //
  // Deliberately does NOT clear pendingOrbitParams here, and deliberately
  // does NOT depend on `templateMode`. The sibling reset-effect above uses
  // `pendingOrbitParams` as a guard to skip resetState() — clearing it in
  // this same effect batches the clear into the same render as the
  // setTemplateMode("orbit") call above, so on the *next* render the guard
  // is already false and the reset-effect wipes what this effect just set.
  // Instead, pendingOrbitParams stays truthy (a one-shot flag consumed only
  // once, since it's not in this effect's deps) until handleApply/
  // handleCancel explicitly clear it — the same lifecycle editingTemplateGroupId
  // already uses.
  useEffect(() => {
    if (!pendingOrbitParams) return;
    setOrbitParams(pendingOrbitParams);
    setGridParams(null);
    setFacadeParams(null);
    setDragging(false);
    setDragState(null);
    setConfirmed(true);
    if (useMissionStore.getState().templateMode !== "orbit") {
      setTemplateMode("orbit");
    }
  }, [pendingOrbitParams, setTemplateMode]);

  // Reopening an already-applied orbit/grid/facade for editing: load its
  // stored params straight into "confirmed" state, skipping the drag
  // gesture. Only handles the three types this component owns — pencil and
  // solar templates load themselves the same way in their own handlers.
  useEffect(() => {
    if (!editingTemplateGroupId) return;
    const group = templateGroups[editingTemplateGroupId];
    if (!group) return;

    if (group.type === "orbit") {
      setOrbitParams(group.params as OrbitParams);
      setGridParams(null);
      setFacadeParams(null);
    } else if (group.type === "grid") {
      setGridParams(group.params as GridParams);
      setOrbitParams(null);
      setFacadeParams(null);
    } else if (group.type === "facade") {
      setFacadeParams(group.params as FacadeParams);
      setOrbitParams(null);
      setGridParams(null);
    } else {
      return;
    }
    setDragging(false);
    setDragState(null);
    setConfirmed(true);
    if (templateMode !== group.type) {
      setTemplateMode(group.type);
    }
  }, [editingTemplateGroupId, templateGroups, templateMode, setTemplateMode]);

  // Map mouse events for drag-to-draw
  useEffect(() => {
    if (!map || !templateMode || templateMode === "pencil") return;

    let isDragging = false;
    let currentDrag: DragState | null = null;

    const onMouseDown = (e: any) => {
      if (confirmed) return;
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
      setDragState(finalDrag);
      setDragging(false);

      const dist = haversine(
        finalDrag.start[0],
        finalDrag.start[1],
        finalDrag.end[0],
        finalDrag.end[1],
      );

      if (dist < 5) {
        resetState();
        return;
      }

      const tm = useMissionStore.getState().templateMode;
      if (tm === "orbit") {
        setOrbitParams(initialOrbitParams(finalDrag.start, Math.round(dist)));
      } else if (tm === "grid") {
        setGridParams({
          ...DEFAULT_GRID_PARAMS,
          corner1: finalDrag.start,
          corner2: finalDrag.end,
        });
      } else if (tm === "facade") {
        setFacadeParams({
          ...DEFAULT_FACADE_PARAMS,
          point1: finalDrag.start,
          point2: finalDrag.end,
        });
      }

      setConfirmed(true);
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
  }, [map, templateMode, confirmed, resetState]);

  const preview: TemplateResult | null = useMemo(() => {
    if (orbitParams) return generateOrbit(orbitParams);
    if (gridParams) return generateGrid(gridParams);
    if (facadeParams) return generateFacade(facadeParams);
    return null;
  }, [orbitParams, gridParams, facadeParams]);

  const dragPreview = useMemo(() => {
    if (!dragging || !dragState || !templateMode) return null;
    const dist = haversine(
      dragState.start[0],
      dragState.start[1],
      dragState.end[0],
      dragState.end[1],
    );
    if (dist < 5) return null;

    if (templateMode === "orbit") {
      return generateOrbit(
        initialOrbitParams(dragState.start, Math.round(dist)),
      );
    }
    if (templateMode === "grid") {
      return generateGrid({
        ...DEFAULT_GRID_PARAMS,
        corner1: dragState.start,
        corner2: dragState.end,
      });
    }
    if (templateMode === "facade") {
      return generateFacade({
        ...DEFAULT_FACADE_PARAMS,
        point1: dragState.start,
        point2: dragState.end,
      });
    }
    return null;
  }, [dragging, dragState, templateMode]);

  // Build drag guide GeoJSON
  const dragGuideGeojson = useMemo(() => {
    if (!dragging || !dragState) return null;
    if (templateMode === "orbit") {
      const dist = haversine(
        dragState.start[0],
        dragState.start[1],
        dragState.end[0],
        dragState.end[1],
      );
      return circleGeoJson(dragState.start, dist);
    }
    if (templateMode === "grid") {
      const [lat1, lng1] = dragState.start;
      const [lat2, lng2] = dragState.end;
      return {
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [lng1, lat1],
            [lng2, lat1],
            [lng2, lat2],
            [lng1, lat2],
            [lng1, lat1],
          ],
        },
      };
    }
    if (templateMode === "facade") {
      return {
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [dragState.start[1], dragState.start[0]],
            [dragState.end[1], dragState.end[0]],
          ],
        },
      };
    }
    return null;
  }, [dragging, dragState, templateMode]);

  if (!templateMode || templateMode === "pencil") return null;

  const handleApply = () => {
    if (!preview) {
      resetState();
      setPendingOrbitParams(null);
      return;
    }
    const params = orbitParams || gridParams || facadeParams;
    if (editingTemplateGroupId && params) {
      replaceTemplateGroup(
        editingTemplateGroupId,
        preview.waypoints,
        preview.pois,
        params,
      );
    } else if (params) {
      appendWaypoints(preview.waypoints, preview.pois, {
        type: templateMode as "orbit" | "grid" | "facade",
        params,
      });
    }
    resetState();
    setPendingOrbitParams(null);
  };

  const handleCancel = () => {
    resetState();
    setTemplateMode(null);
    setEditingTemplateGroupId(null);
    setPendingOrbitParams(null);
  };

  const activePreview = confirmed ? preview : dragPreview;

  return (
    <>
      {/* Draw guide during drag */}
      {dragGuideGeojson && (
        <Source id="template-drag-guide" type="geojson" data={dragGuideGeojson}>
          <Layer
            id="template-drag-guide-layer"
            type="line"
            paint={{
              "line-color": "#a78bfa",
              "line-width": 2,
              "line-opacity": 0.5,
              "line-dasharray": [3, 2],
            }}
          />
        </Source>
      )}

      {/* Center marker for orbit drag */}
      {dragging && dragState && templateMode === "orbit" && (
        <Marker
          longitude={dragState.start[1]}
          latitude={dragState.start[0]}
          anchor="center"
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#a78bfa",
            }}
          />
        </Marker>
      )}

      {/* Facade endpoint markers during drag */}
      {dragging && dragState && templateMode === "facade" && (
        <>
          <Marker
            longitude={dragState.start[1]}
            latitude={dragState.start[0]}
            anchor="center"
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#a78bfa",
              }}
            />
          </Marker>
          <Marker
            longitude={dragState.end[1]}
            latitude={dragState.end[0]}
            anchor="center"
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#a78bfa",
              }}
            />
          </Marker>
        </>
      )}

      {/* Preview waypoints */}
      {activePreview && <TemplatePreview result={activePreview} />}

      {/* Center + rotation handles for a confirmed orbit.
          Center handle renders last (on top) so it stays grabbable even
          when a small radius puts it close to the rotation handle. */}
      {confirmed && orbitParams && (
        <>
          <OrbitRotationHandle
            orbitParams={orbitParams}
            onRotate={(newStartAngleDeg) => {
              const width = orbitParams.endAngleDeg - orbitParams.startAngleDeg;
              setOrbitParams({
                ...orbitParams,
                startAngleDeg: newStartAngleDeg,
                endAngleDeg: newStartAngleDeg + width,
              });
            }}
          />
          <OrbitCenterHandle
            center={orbitParams.center}
            onMove={(newCenter) =>
              setOrbitParams({ ...orbitParams, center: newCenter })
            }
          />
        </>
      )}

      {/* Config panel */}
      {confirmed && (
        <TemplateConfigPanel
          type={templateMode}
          orbitParams={orbitParams}
          gridParams={gridParams}
          facadeParams={facadeParams}
          onOrbitChange={setOrbitParams}
          onGridChange={setGridParams}
          onFacadeChange={setFacadeParams}
          onApply={handleApply}
          onCancel={handleCancel}
          waypointCount={activePreview?.waypoints.length ?? 0}
        />
      )}
    </>
  );
}
