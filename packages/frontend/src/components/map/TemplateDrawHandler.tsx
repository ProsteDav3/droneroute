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
  orbitMinStandoffM,
  clampOrbitCenterForPoiClearance,
  signedArcSweepDeg,
  orbitRadiusAtBearing,
  minStandoffForBuildingAtAltitudeM,
  defaultAimHeight,
  alignOrbitToDistance,
  recomputeBuildingOrbitForArc,
  DEFAULT_ORBIT_PARAMS,
  DEFAULT_GRID_PARAMS,
  DEFAULT_FACADE_PARAMS,
  DEFAULT_WIDE_VFOV_DEG,
} from "@/lib/templates";
import { WIDE_CAMERA_FOV } from "@/lib/solarCamera";

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

/**
 * Radius used when Orbit is created by a plain click (no drag) — lets a
 * touch/tablet user (who can't do a mouse-drag gesture) get a usable orbit
 * immediately, then adjust the radius in the config panel afterward. Grid
 * and Facade have no sensible single-point default (they need two distinct
 * corners), so a plain click for those still does nothing.
 */
const DEFAULT_CLICK_ORBIT_RADIUS_M = 30;

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
 *
 * Explicit `zIndex` (higher than OrbitPoiHandle's) via the Marker's own
 * `style` prop — not JSX/mount order — is what guarantees this handle stays
 * grabbable when it overlaps OrbitPoiHandle right after locking the POI.
 * The two markers are independent mapbox-gl `Marker` instances, each
 * appended to the shared canvas container at its OWN mount time (see
 * `@vis.gl/react-mapbox`'s Marker component) — OrbitPoiHandle only mounts
 * the moment "Uzamknout POI" is checked, i.e. strictly after this handle,
 * so relying on JSX order for stacking would put the newer POI marker on
 * top regardless of where it appears in this file.
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
      style={{ zIndex: 10 }}
    >
      <div
        title="Přetažením posunete střed orbitu"
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
 * A draggable handle sitting on the middle of the flown arc. Dragging it
 * sets the distance the flight holds **from the camera target** through the
 * middle of the arc (`OrbitParams.evenDistanceM`) — distance from the target
 * rather than from the orbit's own centre, because that is what keeps the
 * subject the same size on screen. The arc's two ends stay exactly where
 * they were placed; only the run between them moves.
 */
function OrbitMidArcHandle({
  poiCenter,
  midPoint,
  onDistance,
}: {
  poiCenter: [number, number];
  midPoint: [number, number];
  onDistance: (distanceFromTargetM: number) => void;
}) {
  const handleDrag = useCallback(
    (e: { lngLat: { lng: number; lat: number } }) => {
      onDistance(
        haversine(poiCenter[0], poiCenter[1], e.lngLat.lat, e.lngLat.lng),
      );
    },
    [poiCenter, onDistance],
  );

  return (
    <Marker
      longitude={midPoint[1]}
      latitude={midPoint[0]}
      anchor="center"
      draggable
      onDrag={handleDrag}
      style={{ zIndex: 8 }}
    >
      <div
        title="Přetažením ke středu z orbitu uděláte ovál — střed oblouku se přiblíží k objektu, začátek a konec zůstanou na místě"
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#a78bfa",
          border: "3px solid #8b5cf6",
          boxShadow: "0 0 0 4px rgba(167,139,250,0.35)",
          cursor: "grab",
        }}
      />
    </Marker>
  );
}

/**
 * A fixed (non-draggable) marker showing an orbit's independent camera aim
 * point (`OrbitParams.poiCenter`), only rendered once that field is set (see
 * the "Uzamknout POI" toggle in TemplateConfigPanel). Deliberately not
 * draggable: the whole point of locking the POI is that it stays put while
 * `OrbitCenterHandle` (given a higher `zIndex`, so it stays on top when the
 * two overlap right after locking) is used to resize/move the orbit circle
 * — previously both handles were draggable and overlapped exactly at lock
 * time, so grabbing "the orbit handle" often grabbed this one instead,
 * moving the POI by accident and forcing it to be dragged back afterward.
 */
function OrbitPoiHandle({
  poiCenter,
  onMove,
}: {
  poiCenter: [number, number];
  /** Present only while the route is locked to the target's ring, which is
   * the one mode where dragging the target is meant to take the flight with
   * it. Left out otherwise: the handle sits on top of the centre handle the
   * moment the POI is locked, and making both draggable meant grabbing "the
   * orbit" often moved the target by accident. */
  onMove?: (poiCenter: [number, number]) => void;
}) {
  const [lat, lng] = poiCenter;
  const handleDrag = useCallback(
    (e: { lngLat: { lng: number; lat: number } }) => {
      onMove?.([e.lngLat.lat, e.lngLat.lng]);
    },
    [onMove],
  );

  return (
    <Marker
      longitude={lng}
      latitude={lat}
      anchor="center"
      draggable={!!onMove}
      onDrag={handleDrag}
      style={{ zIndex: onMove ? 12 : 5 }}
    >
      <div
        title={
          onMove
            ? "Cíl kamery — přetažením posunete cíl i celou trasu, která kolem něj zůstane na červeném kruhu"
            : "Cíl kamery (POI je uzamčen na tomto místě, odděleně od středu orbitu)"
        }
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#00c2ff",
          border: "3px solid #33cfff",
          boxShadow: "0 0 0 4px rgba(0,194,255,0.35)",
        }}
      />
    </Marker>
  );
}

/** GeoJSON ring (as a closed LineString) at `radiusM` around `center` — the
 * visual guide showing the minimum-clearance boundary from a locked POI, so
 * dragging the orbit's center shows *why* it stops rather than just
 * silently refusing to move closer. */
function buildGuideRingGeojson(
  center: [number, number],
  radiusM: number,
): GeoJSON.Feature<GeoJSON.LineString> {
  const [lat, lng] = center;
  const SEGMENTS = 64;
  const coords: [number, number][] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const [pLat, pLng] = destinationPoint(
      lat,
      lng,
      radiusM,
      (360 * i) / SEGMENTS,
    );
    coords.push([pLng, pLat]);
  }
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: coords },
  };
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
        title="Přetažením otočíte oblouk"
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
  const pendingPresetLoad = useMissionStore((s) => s.pendingPresetLoad);
  const setPendingPresetLoad = useMissionStore((s) => s.setPendingPresetLoad);
  const payloadEnumValue = useMissionStore((s) => s.config.payloadEnumValue);
  const vfovDeg =
    WIDE_CAMERA_FOV[payloadEnumValue]?.vfovDeg ?? DEFAULT_WIDE_VFOV_DEG;
  const { current: map } = useMap();

  // Only react to a pending preset load when it's one of the types this
  // handler owns — a preset for "pencil"/"solar"/"corridor"/"turbine" is
  // consumed by those handlers instead, and must not be treated as "busy"
  // here (which would otherwise wrongly skip resetState() on the next
  // unrelated mode change).
  const pendingPresetForThisHandler =
    pendingPresetLoad &&
    (pendingPresetLoad.type === "orbit" ||
      pendingPresetLoad.type === "grid" ||
      pendingPresetLoad.type === "facade")
      ? pendingPresetLoad
      : null;

  const [dragging, setDragging] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const [orbitParams, setOrbitParams] = useState<OrbitParams | null>(null);
  const [gridParams, setGridParams] = useState<GridParams | null>(null);
  const [facadeParams, setFacadeParams] = useState<FacadeParams | null>(null);

  /** The locked-POI clearance minimum — same number the config panel's own
   * guard uses (see `orbitStandoffViolation`), so the drag clamp and the
   * warning can never disagree about how much room the subject needs.
   * Deliberately the object's HEIGHT requirement only: a long building's
   * length needs far more room, and demanding it here made the requirement
   * exceed the radius, which clamped the centre handle to a single point the
   * user could not move at all. */
  const poiClearanceStandoffM = (poiHeight: number) =>
    orbitMinStandoffM(poiHeight, vfovDeg);

  const resetState = useCallback(() => {
    setDragging(false);
    setDragState(null);
    setConfirmed(false);
    setOrbitParams(null);
    setGridParams(null);
    setFacadeParams(null);
  }, []);

  useEffect(() => {
    if (
      editingTemplateGroupId ||
      pendingOrbitParams ||
      pendingPresetForThisHandler
    )
      return;
    resetState();
  }, [
    templateMode,
    editingTemplateGroupId,
    pendingOrbitParams,
    pendingPresetForThisHandler,
    resetState,
  ]);

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

  // A saved template preset was loaded: same one-shot seed pattern as
  // pendingOrbitParams above — deliberately does NOT clear
  // pendingPresetLoad here (cleared explicitly in handleApply/handleCancel
  // instead), for the same clobber-avoidance reason.
  useEffect(() => {
    if (!pendingPresetForThisHandler) return;
    const { type, params } = pendingPresetForThisHandler;
    if (type === "orbit") {
      setOrbitParams(params as OrbitParams);
      setGridParams(null);
      setFacadeParams(null);
    } else if (type === "grid") {
      setGridParams(params as GridParams);
      setOrbitParams(null);
      setFacadeParams(null);
    } else {
      setFacadeParams(params as FacadeParams);
      setOrbitParams(null);
      setGridParams(null);
    }
    setDragging(false);
    setDragState(null);
    setConfirmed(true);
    if (useMissionStore.getState().templateMode !== type) {
      setTemplateMode(type);
    }
  }, [pendingPresetForThisHandler, setTemplateMode]);

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
    if (
      !map ||
      !templateMode ||
      templateMode === "pencil" ||
      templateMode === "corridor" ||
      templateMode === "turbine"
    )
      return;

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

      const tm = useMissionStore.getState().templateMode;

      if (dist < 5) {
        // A plain click/tap with no meaningful drag. Orbit gets a
        // default-radius circle right away — dragging still lets you pick
        // the exact radius by hand, but a click alone is enough on a
        // tablet where dragging isn't practical. Grid/Facade need two
        // distinct corners, so a plain click for those is still a no-op.
        if (tm === "orbit") {
          setOrbitParams(
            initialOrbitParams(finalDrag.start, DEFAULT_CLICK_ORBIT_RADIUS_M),
          );
          setConfirmed(true);
          currentDrag = null;
          return;
        }
        resetState();
        return;
      }

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

  if (
    !templateMode ||
    templateMode === "pencil" ||
    templateMode === "corridor" ||
    templateMode === "turbine"
  )
    return null;

  const handleApply = () => {
    if (!preview) {
      resetState();
      setPendingOrbitParams(null);
      setPendingPresetLoad(null);
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
    setPendingPresetLoad(null);
  };

  const handleCancel = () => {
    resetState();
    setTemplateMode(null);
    setEditingTemplateGroupId(null);
    setPendingOrbitParams(null);
    setPendingPresetLoad(null);
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
              const newEndAngleDeg = newStartAngleDeg + width;
              // Rotating a building orbit's arc to a different side of the
              // building can need a different standoff too (an irregular
              // footprint isn't equally close to the circle at every
              // bearing) — re-derive it the same way narrowing the arc's
              // width does, see OrbitFields' applyArcChange.
              if (
                orbitParams.buildingVertices &&
                orbitParams.altitudeGimbalLinked &&
                // Re-deriving the framing moves the altitude — exactly what
                // the lock exists to prevent (see OrbitFields).
                !orbitParams.altitudeLocked &&
                !orbitParams.poiCenter
              ) {
                const reframed = recomputeBuildingOrbitForArc(
                  orbitParams.buildingVertices,
                  orbitParams.poiHeight,
                  vfovDeg,
                  newStartAngleDeg,
                  newEndAngleDeg,
                  orbitParams.aimHeight,
                );
                setOrbitParams({
                  ...orbitParams,
                  startAngleDeg: newStartAngleDeg,
                  endAngleDeg: newEndAngleDeg,
                  center: reframed.center,
                  radiusM: reframed.radiusM,
                  altitude: reframed.altitude,
                  gimbalPitchDeg: reframed.gimbalPitchDeg,
                });
              } else {
                setOrbitParams({
                  ...orbitParams,
                  startAngleDeg: newStartAngleDeg,
                  endAngleDeg: newEndAngleDeg,
                });
              }
            }}
          />
          {orbitParams.poiCenter && (
            <>
              <OrbitPoiHandle
                poiCenter={orbitParams.poiCenter}
                onMove={
                  orbitParams.snapToTargetRing && orbitParams.buildingVertices
                    ? (poiCenter) =>
                        setOrbitParams(
                          alignOrbitToDistance(
                            { ...orbitParams, poiCenter },
                            Math.round(
                              minStandoffForBuildingAtAltitudeM(
                                orbitParams.buildingVertices!,
                                orbitParams.poiHeight,
                                orbitParams.altitude,
                                orbitParams.aimHeight ??
                                  defaultAimHeight(orbitParams.poiHeight),
                                vfovDeg,
                              ),
                            ),
                          ),
                        )
                    : undefined
                }
              />
              {orbitParams.poiHeight > 0 && (
                <Source
                  id="orbit-poi-clearance-guide"
                  type="geojson"
                  data={buildGuideRingGeojson(
                    orbitParams.poiCenter,
                    poiClearanceStandoffM(orbitParams.poiHeight),
                  )}
                >
                  <Layer
                    id="orbit-poi-clearance-guide-layer"
                    type="line"
                    paint={{
                      "line-color": "#00c2ff",
                      "line-width": 2.5,
                      "line-opacity": 0.9,
                      "line-dasharray": [2, 2],
                    }}
                  />
                </Source>
              )}
              {/* Red ring: how far out the aircraft has to be for the WHOLE
                  building to fit in frame, width included — the blue ring
                  above is only what its height needs. Advice, not a limit:
                  flying inside it is a legitimate close-up of part of a long
                  building, and the panel says so in words. */}
              {orbitParams.buildingVertices &&
                orbitParams.poiHeight > 0 &&
                (() => {
                  const wholeBuildingM = minStandoffForBuildingAtAltitudeM(
                    orbitParams.buildingVertices,
                    orbitParams.poiHeight,
                    orbitParams.altitude,
                    orbitParams.aimHeight ??
                      defaultAimHeight(orbitParams.poiHeight),
                    vfovDeg,
                  );
                  if (
                    wholeBuildingM <=
                    poiClearanceStandoffM(orbitParams.poiHeight)
                  ) {
                    return null;
                  }
                  return (
                    <Source
                      id="orbit-whole-building-guide"
                      type="geojson"
                      data={buildGuideRingGeojson(
                        orbitParams.poiCenter!,
                        wholeBuildingM,
                      )}
                    >
                      <Layer
                        id="orbit-whole-building-guide-layer"
                        type="line"
                        paint={{
                          "line-color": "#ef4444",
                          "line-width": 2,
                          "line-opacity": 0.85,
                          "line-dasharray": [4, 3],
                        }}
                      />
                    </Source>
                  );
                })()}
            </>
          )}
          {orbitParams.poiCenter &&
            (() => {
              // Mid-arc handle: pulling the middle of the arc in only means
              // anything against a locked, off-centre target — with the POI at
              // the orbit's own centre every waypoint is already equidistant.
              const sweep = signedArcSweepDeg(
                orbitParams.startAngleDeg,
                orbitParams.endAngleDeg,
                orbitParams.clockwise,
              );
              const midBearing = orbitParams.startAngleDeg + sweep / 2;
              const midPoint = destinationPoint(
                orbitParams.center[0],
                orbitParams.center[1],
                orbitRadiusAtBearing(orbitParams, midBearing),
                midBearing,
              );
              return (
                <OrbitMidArcHandle
                  poiCenter={orbitParams.poiCenter!}
                  midPoint={midPoint}
                  onDistance={(distanceFromTargetM) =>
                    setOrbitParams({
                      ...orbitParams,
                      evenDistanceM: Math.max(
                        1,
                        Math.round(distanceFromTargetM),
                      ),
                    })
                  }
                />
              );
            })()}
          <OrbitCenterHandle
            center={orbitParams.center}
            onMove={(newCenter) => {
              const clampedCenter =
                orbitParams.poiCenter && orbitParams.poiHeight > 0
                  ? clampOrbitCenterForPoiClearance(
                      newCenter,
                      orbitParams.center,
                      {
                        poiCenter: orbitParams.poiCenter,
                        radiusM: orbitParams.radiusM,
                        minStandoffM: poiClearanceStandoffM(
                          orbitParams.poiHeight,
                        ),
                        startAngleDeg: orbitParams.startAngleDeg,
                        endAngleDeg: orbitParams.endAngleDeg,
                        numPoints: orbitParams.numPoints,
                      },
                    )
                  : newCenter;
              setOrbitParams({ ...orbitParams, center: clampedCenter });
            }}
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
