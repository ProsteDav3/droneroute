import { useEffect, useMemo } from "react";
import { Source, Layer, useMap } from "react-map-gl/mapbox";
import { X, Undo2, Trash2, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMeasureStore } from "@/store/measureStore";
import { useMissionStore } from "@/store/missionStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { computeMeasureStats } from "@/lib/geo";
import { formatDistance, formatArea } from "@/lib/units";

/**
 * Standalone ruler/area tool — click the map to drop points and see a live
 * running distance (and enclosed area once there are 3+ points), entirely
 * independent of the loaded mission's own content. Lives as a child of
 * `<Map>` (like the other DrawHandler components) so it can attach its own
 * native mapbox click listener, but keeps its state in `measureStore`
 * rather than `missionStore` since it never touches waypoints/POIs.
 */
export function MeasureToolHandler() {
  const { current: map } = useMap();
  const isActive = useMeasureStore((s) => s.isActive);
  const points = useMeasureStore((s) => s.points);
  const addPoint = useMeasureStore((s) => s.addPoint);
  const undoLastPoint = useMeasureStore((s) => s.undoLastPoint);
  const clear = useMeasureStore((s) => s.clear);
  const stop = useMeasureStore((s) => s.stop);
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);

  // Any other map tool (waypoint/POI/obstacle/building/template) taking
  // over the click handler should silently end the measure session rather
  // than leaving two tools fighting over the same clicks.
  const isAddingWaypoint = useMissionStore((s) => s.isAddingWaypoint);
  const isAddingPoi = useMissionStore((s) => s.isAddingPoi);
  const isDrawingObstacle = useMissionStore((s) => s.isDrawingObstacle);
  const isDrawingBuilding = useMissionStore((s) => s.isDrawingBuilding);
  const templateMode = useMissionStore((s) => s.templateMode);
  useEffect(() => {
    if (
      isActive &&
      (isAddingWaypoint ||
        isAddingPoi ||
        isDrawingObstacle ||
        isDrawingBuilding ||
        templateMode)
    ) {
      stop();
    }
  }, [
    isActive,
    isAddingWaypoint,
    isAddingPoi,
    isDrawingObstacle,
    isDrawingBuilding,
    templateMode,
    stop,
  ]);

  useEffect(() => {
    if (!map || !isActive) return;
    const onClick = (e: any) => {
      addPoint([e.lngLat.lat, e.lngLat.lng]);
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map, isActive, addPoint]);

  // Escape removes the last point (mirrors most drawing tools' undo-last
  // behavior) rather than exiting the tool entirely — closing the whole
  // session is a separate, explicit action (the X button).
  useEffect(() => {
    if (!isActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") undoLastPoint();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isActive, undoLastPoint]);

  const stats = useMemo(() => computeMeasureStats(points), [points]);

  const lineGeojson = useMemo(() => {
    if (points.length < 2) return null;
    return {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: points.map(([lat, lng]) => [lng, lat]),
      },
    };
  }, [points]);

  const pointsGeojson = useMemo(() => {
    return {
      type: "FeatureCollection" as const,
      features: points.map(([lat, lng]) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Point" as const, coordinates: [lng, lat] },
      })),
    };
  }, [points]);

  if (!isActive) return null;

  return (
    <>
      {lineGeojson && (
        <Source id="measure-line" type="geojson" data={lineGeojson}>
          <Layer
            id="measure-line-layer"
            type="line"
            paint={{
              "line-color": "#facc15",
              "line-width": 2,
              "line-dasharray": [2, 1],
            }}
          />
        </Source>
      )}
      <Source id="measure-points" type="geojson" data={pointsGeojson}>
        <Layer
          id="measure-points-layer"
          type="circle"
          paint={{
            "circle-radius": 4,
            "circle-color": "#facc15",
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#1c1917",
          }}
        />
      </Source>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 rounded-lg bg-background/95 border border-border shadow-lg px-3 py-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Ruler className="h-3.5 w-3.5 text-yellow-400" />
          {points.length === 0
            ? "Klikněte na mapu pro měření"
            : formatDistance(stats.totalDistanceM, unitSystem)}
        </div>
        {stats.areaM2 !== null && (
          <>
            <div className="h-3 w-px bg-border" />
            <div className="text-xs text-muted-foreground">
              plocha {formatArea(stats.areaM2, unitSystem)}
            </div>
          </>
        )}
        <div className="h-3 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={undoLastPoint}
          disabled={points.length === 0}
          title="Odebrat poslední bod (Esc)"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={clear}
          disabled={points.length === 0}
          title="Vymazat měření"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={stop}
          title="Ukončit měření"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </>
  );
}
