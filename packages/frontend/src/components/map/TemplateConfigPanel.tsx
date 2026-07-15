import { useRef, useEffect, useState } from "react";
import { toast } from "sonner";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, X, MapPin, Lock, Unlock, Save } from "lucide-react";
import { LocationSearch } from "@/components/ui/location-search";
import { useMissionStore } from "@/store/missionStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { useAuthStore } from "@/store/authStore";
import { useTemplatePresetsStore } from "@/store/templatePresetsStore";
import {
  heightLabel,
  speedLabel,
  distanceLabel,
  toDisplayHeight,
  fromDisplayHeight,
  toDisplaySpeed,
  fromDisplaySpeed,
  toDisplayDistance,
  fromDisplayDistance,
  speedRange,
} from "@/lib/units";
import {
  computeGimbalPitch,
  computeAltitudeForPitch,
  type TemplateType,
  type OrbitParams,
  type GridParams,
  type FacadeParams,
  type PencilParams,
  type SolarParams,
} from "@/lib/templates";
import { recommendSolarSpacing, THERMAL_CAMERA_FOV } from "@/lib/solarCamera";
import type { PointOfInterest, HeightMode } from "@droneroute/shared";

function heightModeLabel(mode: HeightMode): string {
  switch (mode) {
    case "relativeToStartPoint":
      return "relative to the takeoff point";
    case "aboveGroundLevel":
      return "above ground level";
    case "EGM96":
      return "above mean sea level (EGM96)";
    default:
      return mode;
  }
}

interface TemplateConfigPanelProps {
  type: TemplateType;
  orbitParams?: OrbitParams | null;
  gridParams?: GridParams | null;
  facadeParams?: FacadeParams | null;
  pencilParams?: PencilParams | null;
  solarParams?: SolarParams | null;
  onOrbitChange?: (params: OrbitParams) => void;
  onGridChange?: (params: GridParams) => void;
  onFacadeChange?: (params: FacadeParams) => void;
  onPencilChange?: (params: PencilParams) => void;
  onSolarChange?: (params: SolarParams) => void;
  onApply: () => void;
  onCancel: () => void;
  waypointCount: number;
  pois?: PointOfInterest[];
}

export function TemplateConfigPanel({
  type,
  orbitParams,
  gridParams,
  facadeParams,
  pencilParams,
  solarParams,
  onOrbitChange,
  onGridChange,
  onFacadeChange,
  onPencilChange,
  onSolarChange,
  onApply,
  onCancel,
  waypointCount,
  pois,
}: TemplateConfigPanelProps) {
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  const setFlyToTarget = useMissionStore((s) => s.setFlyToTarget);
  const heightMode = useMissionStore((s) => s.config.heightMode);
  const payloadEnumValue = useMissionStore((s) => s.config.payloadEnumValue);
  const heightModeText = heightModeLabel(heightMode);
  const title =
    type === "orbit"
      ? "Orbit"
      : type === "grid"
        ? "Grid survey"
        : type === "facade"
          ? "Facade scan"
          : type === "solar"
            ? "Solar panel survey"
            : "Pencil path";
  const description =
    type === "orbit"
      ? "Circular flight path around a center point. Adjust the radius, number of points, and enable POI to keep the camera focused on the center. Set end angle below 360° for an open arc between a start and end bearing instead of a full loop."
      : type === "grid"
        ? "Lawn-mower zigzag pattern for systematic area coverage. Control line spacing for overlap and rotation to align with the terrain."
        : type === "facade"
          ? "Vertical scanning pattern along a wall or building face. Set the standoff distance, altitude range, and grid density for full coverage."
          : type === "solar"
            ? "Lawn-mower path clipped to the exact shape you traced around the panel array — the drone never flies past its edges. Flight lines run at the row angle you set by drawing a reference line along a panel row."
            : "Freehand flight path drawn on the map. Adjust the number of waypoints to control how closely the path is followed.";

  // Must stay in sync with MAX_WAYPOINTS in
  // packages/backend/src/services/missionValidation.ts — surfaced here so
  // a template that would exceed the mission's hard waypoint limit (e.g. a
  // large solar array with tight line/photo spacing) is caught before
  // Apply, not at save/export time.
  const MAX_WAYPOINTS = 5000;
  const exceedsWaypointLimit = waypointCount > MAX_WAYPOINTS;

  // "Save as preset" — reusable across missions, e.g. the same recurring
  // orbit around a fixed site. Works generically for whichever template
  // type/params this panel currently shows.
  const currentParams =
    orbitParams || gridParams || facadeParams || pencilParams || solarParams;
  const token = useAuthStore((s) => s.token);
  const createPreset = useTemplatePresetsStore((s) => s.createPreset);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetSaveInFlight, setPresetSaveInFlight] = useState(false);

  const handleSavePreset = async () => {
    const name = presetName.trim();
    if (!name || !currentParams) return;
    setPresetSaveInFlight(true);
    try {
      await createPreset(
        name,
        type,
        currentParams as unknown as Record<string, unknown>,
      );
      toast.success(`Saved "${name}" as a template preset`);
      setSavingPreset(false);
      setPresetName("");
    } catch (err: any) {
      toast.error(`Failed to save preset: ${err.message}`);
    } finally {
      setPresetSaveInFlight(false);
    }
  };

  // Stop all pointer/keyboard/wheel events from reaching Leaflet (native DOM level)
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    const events = [
      "mousedown",
      "mouseup",
      "dblclick",
      "wheel",
      "keydown",
      "keyup",
      "pointerdown",
      "pointerup",
      "touchstart",
      "touchend",
    ];
    for (const evt of events) el.addEventListener(evt, stop);
    return () => {
      for (const evt of events) el.removeEventListener(evt, stop);
    };
  }, []);

  return (
    <div
      ref={panelRef}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-2xl p-3 min-w-[320px] max-w-[420px]"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-purple-400">
            {title}
          </span>
          <Badge
            variant={exceedsWaypointLimit ? "destructive" : "secondary"}
            className="text-[10px] gap-1"
          >
            <MapPin className="h-3 w-3" />
            {waypointCount} waypoints
          </Badge>
        </div>
        <button
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground mb-3">{description}</p>

      {/* Orbit params */}
      {type === "orbit" && orbitParams && onOrbitChange && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="col-span-2">
            <Label className="text-[10px]">
              Center on address or coordinates
            </Label>
            <LocationSearch
              onLocationFound={(lat, lng) => {
                onOrbitChange({ ...orbitParams, center: [lat, lng] });
                setFlyToTarget([lat, lng]);
              }}
            />
          </div>
          <div>
            <Label
              className="text-[10px]"
              title="Horizontal distance from the center point to the flight path."
            >
              Radius ({distanceLabel(unitSystem)})
            </Label>
            <NumericInput
              value={toDisplayDistance(orbitParams.radiusM, unitSystem)}
              onChange={(v) => {
                const radiusM = fromDisplayDistance(v, unitSystem);
                if (orbitParams.altitudeGimbalLinked) {
                  onOrbitChange({
                    ...orbitParams,
                    radiusM,
                    gimbalPitchDeg: computeGimbalPitch(
                      orbitParams.altitude,
                      orbitParams.poiHeight,
                      radiusM,
                    ),
                  });
                } else {
                  onOrbitChange({ ...orbitParams, radiusM });
                }
              }}
              min={5}
              step={5}
              fallback={5}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px]">Points</Label>
            <NumericInput
              value={orbitParams.numPoints}
              onChange={(v) => onOrbitChange({ ...orbitParams, numPoints: v })}
              min={3}
              fallback={12}
              integer
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label
              className="text-[10px]"
              title={`How high the drone flies, ${heightModeText} (this mission's height reference).`}
            >
              Flight altitude ({heightLabel(unitSystem)})
            </Label>
            <NumericInput
              value={toDisplayHeight(orbitParams.altitude, unitSystem)}
              onChange={(v) => {
                const altitude = fromDisplayHeight(v, unitSystem);
                if (orbitParams.altitudeGimbalLinked) {
                  onOrbitChange({
                    ...orbitParams,
                    altitude,
                    gimbalPitchDeg: computeGimbalPitch(
                      altitude,
                      orbitParams.poiHeight,
                      orbitParams.radiusM,
                    ),
                  });
                } else {
                  onOrbitChange({ ...orbitParams, altitude });
                }
              }}
              min={5}
              step={5}
              fallback={30}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label
              className="text-[10px]"
              title={`Real height of the point the camera should look at (e.g. a rooftop), ${heightModeText} — same reference as flight altitude.`}
            >
              POI height ({heightLabel(unitSystem)})
            </Label>
            <NumericInput
              value={toDisplayHeight(orbitParams.poiHeight, unitSystem)}
              onChange={(v) => {
                const poiHeight = fromDisplayHeight(v, unitSystem);
                if (orbitParams.altitudeGimbalLinked) {
                  onOrbitChange({
                    ...orbitParams,
                    poiHeight,
                    gimbalPitchDeg: computeGimbalPitch(
                      orbitParams.altitude,
                      poiHeight,
                      orbitParams.radiusM,
                    ),
                  });
                } else {
                  onOrbitChange({ ...orbitParams, poiHeight });
                }
              }}
              min={0}
              step={1}
              fallback={0}
              className="h-7 text-xs"
            />
          </div>
          <div className="col-span-2">
            <div className="flex items-center justify-between">
              <Label
                className="text-[10px]"
                title="Camera tilt. -90° = straight down, 0° = horizon."
              >
                Gimbal pitch (°)
              </Label>
              <button
                type="button"
                onClick={() =>
                  onOrbitChange({
                    ...orbitParams,
                    altitudeGimbalLinked: !orbitParams.altitudeGimbalLinked,
                  })
                }
                title={
                  orbitParams.altitudeGimbalLinked
                    ? "Altitude and gimbal pitch auto-update each other. Click to lock and edit them independently."
                    : "Altitude and gimbal pitch are locked independently. Click to link them again."
                }
                className="text-muted-foreground hover:text-foreground"
              >
                {orbitParams.altitudeGimbalLinked ? (
                  <Unlock className="h-3 w-3" />
                ) : (
                  <Lock className="h-3 w-3 text-amber-400" />
                )}
              </button>
            </div>
            <NumericInput
              value={orbitParams.gimbalPitchDeg}
              onChange={(v) => {
                if (orbitParams.altitudeGimbalLinked) {
                  const altitude = computeAltitudeForPitch(
                    v,
                    orbitParams.poiHeight,
                    orbitParams.radiusM,
                  );
                  // Re-derive pitch from the (possibly floor/ceiling-clamped)
                  // altitude so the displayed pitch never silently diverges
                  // from what the stored altitude actually produces.
                  onOrbitChange({
                    ...orbitParams,
                    altitude,
                    gimbalPitchDeg: computeGimbalPitch(
                      altitude,
                      orbitParams.poiHeight,
                      orbitParams.radiusM,
                    ),
                  });
                } else {
                  onOrbitChange({ ...orbitParams, gimbalPitchDeg: v });
                }
              }}
              min={-120}
              max={45}
              step={1}
              fallback={-45}
              className="h-7 text-xs"
            />
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {orbitParams.altitudeGimbalLinked
                ? "Linked with altitude — changing either recalculates the other from radius + POI height."
                : "Locked — altitude and gimbal pitch no longer auto-update each other."}
            </div>
          </div>
          <div>
            <Label className="text-[10px]">Start angle (°)</Label>
            <NumericInput
              value={orbitParams.startAngleDeg}
              onChange={(v) =>
                onOrbitChange({ ...orbitParams, startAngleDeg: v })
              }
              min={-360}
              max={360}
              step={5}
              fallback={0}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px]">
              End angle (°, 360 = full circle)
            </Label>
            <NumericInput
              value={orbitParams.endAngleDeg}
              onChange={(v) =>
                onOrbitChange({ ...orbitParams, endAngleDeg: v })
              }
              min={orbitParams.startAngleDeg}
              max={720}
              step={5}
              fallback={360}
              className="h-7 text-xs"
            />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={orbitParams.clockwise}
                onChange={(e) =>
                  onOrbitChange({ ...orbitParams, clockwise: e.target.checked })
                }
                className="rounded"
              />
              Clockwise
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={orbitParams.createPoi}
                onChange={(e) =>
                  onOrbitChange({ ...orbitParams, createPoi: e.target.checked })
                }
                className="rounded"
              />
              Center POI
            </label>
          </div>
        </div>
      )}

      {/* Grid params */}
      {type === "grid" && gridParams && onGridChange && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <Label className="text-[10px]">
              Altitude ({heightLabel(unitSystem)})
            </Label>
            <NumericInput
              value={toDisplayHeight(gridParams.altitude, unitSystem)}
              onChange={(v) =>
                onGridChange({
                  ...gridParams,
                  altitude: fromDisplayHeight(v, unitSystem),
                })
              }
              min={5}
              step={5}
              fallback={80}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px]">
              Line spacing ({distanceLabel(unitSystem)})
            </Label>
            <NumericInput
              value={toDisplayDistance(gridParams.spacingM, unitSystem)}
              onChange={(v) =>
                onGridChange({
                  ...gridParams,
                  spacingM: fromDisplayDistance(v, unitSystem),
                })
              }
              min={3}
              step={5}
              fallback={30}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px]">Rotation (°)</Label>
            <NumericInput
              value={gridParams.rotationDeg}
              onChange={(v) => onGridChange({ ...gridParams, rotationDeg: v })}
              min={-180}
              max={180}
              step={5}
              fallback={0}
              className="h-7 text-xs"
            />
          </div>
          <div className="flex items-end gap-2 pb-1">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={gridParams.addPhotos}
                onChange={(e) =>
                  onGridChange({ ...gridParams, addPhotos: e.target.checked })
                }
                className="rounded"
              />
              Photos
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={gridParams.reverse}
                onChange={(e) =>
                  onGridChange({ ...gridParams, reverse: e.target.checked })
                }
                className="rounded"
              />
              Reverse
            </label>
          </div>
        </div>
      )}

      {/* Facade params */}
      {type === "facade" && facadeParams && onFacadeChange && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <Label className="text-[10px]">
              Distance from wall ({distanceLabel(unitSystem)})
            </Label>
            <NumericInput
              value={toDisplayDistance(facadeParams.distanceM, unitSystem)}
              onChange={(v) =>
                onFacadeChange({
                  ...facadeParams,
                  distanceM: fromDisplayDistance(v, unitSystem),
                })
              }
              min={3}
              step={5}
              fallback={20}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px]">
              Min altitude ({heightLabel(unitSystem)})
            </Label>
            <NumericInput
              value={toDisplayHeight(facadeParams.minAltitude, unitSystem)}
              onChange={(v) => {
                const metricV = fromDisplayHeight(v, unitSystem);
                onFacadeChange({
                  ...facadeParams,
                  minAltitude: metricV,
                  maxAltitude: Math.max(metricV + 5, facadeParams.maxAltitude),
                });
              }}
              min={2}
              step={5}
              fallback={10}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px]">
              Max altitude ({heightLabel(unitSystem)})
            </Label>
            <NumericInput
              value={toDisplayHeight(facadeParams.maxAltitude, unitSystem)}
              onChange={(v) =>
                onFacadeChange({
                  ...facadeParams,
                  maxAltitude: Math.max(
                    facadeParams.minAltitude + 5,
                    fromDisplayHeight(v, unitSystem),
                  ),
                })
              }
              min={toDisplayHeight(facadeParams.minAltitude + 5, unitSystem)}
              step={5}
              fallback={30}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px]">Rows</Label>
            <NumericInput
              value={facadeParams.numRows}
              onChange={(v) => onFacadeChange({ ...facadeParams, numRows: v })}
              min={1}
              max={20}
              fallback={4}
              integer
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px]">Columns</Label>
            <NumericInput
              value={facadeParams.numColumns}
              onChange={(v) =>
                onFacadeChange({ ...facadeParams, numColumns: v })
              }
              min={2}
              max={30}
              fallback={8}
              integer
              className="h-7 text-xs"
            />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={facadeParams.addPhotos}
                onChange={(e) =>
                  onFacadeChange({
                    ...facadeParams,
                    addPhotos: e.target.checked,
                  })
                }
                className="rounded"
              />
              Photos
            </label>
          </div>
        </div>
      )}

      {/* Pencil params */}
      {type === "pencil" && pencilParams && onPencilChange && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <Label className="text-[10px]">Waypoints</Label>
            <NumericInput
              value={pencilParams.numPoints}
              onChange={(v) =>
                onPencilChange({ ...pencilParams, numPoints: v })
              }
              min={2}
              max={200}
              fallback={10}
              integer
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px]">
              Altitude ({heightLabel(unitSystem)})
            </Label>
            <NumericInput
              value={toDisplayHeight(pencilParams.altitude, unitSystem)}
              onChange={(v) =>
                onPencilChange({
                  ...pencilParams,
                  altitude: fromDisplayHeight(v, unitSystem),
                })
              }
              min={5}
              step={5}
              fallback={30}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px]">
              Speed ({speedLabel(unitSystem)})
            </Label>
            <NumericInput
              value={toDisplaySpeed(pencilParams.speed, unitSystem)}
              onChange={(v) =>
                onPencilChange({
                  ...pencilParams,
                  speed: fromDisplaySpeed(v, unitSystem),
                })
              }
              min={speedRange(unitSystem).min}
              max={speedRange(unitSystem).max}
              step={speedRange(unitSystem).step}
              fallback={7}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px]">Gimbal pitch (°)</Label>
            <NumericInput
              value={pencilParams.gimbalPitchAngle}
              onChange={(v) =>
                onPencilChange({ ...pencilParams, gimbalPitchAngle: v })
              }
              min={-90}
              max={45}
              step={5}
              fallback={-45}
              className="h-7 text-xs"
            />
          </div>
          <div className="flex items-end pb-1 gap-3">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={pencilParams.reverse}
                onChange={(e) =>
                  onPencilChange({ ...pencilParams, reverse: e.target.checked })
                }
                className="rounded"
              />
              Reverse
            </label>
          </div>
          {pois && pois.length > 0 && (
            <div>
              <Label className="text-[10px]">Face POI</Label>
              <Select
                value={pencilParams.poiId || "none"}
                onValueChange={(v) =>
                  onPencilChange({
                    ...pencilParams,
                    poiId: v === "none" ? undefined : v,
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (follow path)</SelectItem>
                  {pois.map((poi) => (
                    <SelectItem key={poi.id} value={poi.id}>
                      {poi.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {/* Solar params */}
      {type === "solar" && solarParams && onSolarChange && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <Label
              className="text-[10px]"
              title={`How high the drone flies, ${heightModeText} (this mission's height reference).`}
            >
              Altitude ({heightLabel(unitSystem)})
            </Label>
            <NumericInput
              value={toDisplayHeight(solarParams.altitude, unitSystem)}
              onChange={(v) =>
                onSolarChange({
                  ...solarParams,
                  altitude: fromDisplayHeight(v, unitSystem),
                })
              }
              min={5}
              step={5}
              fallback={30}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label
              className="text-[10px]"
              title="Compass bearing the flight lines run at, set by the reference line you drew along a panel row."
            >
              Row angle
            </Label>
            <div className="h-7 flex items-center text-xs px-2 rounded-md border border-input bg-muted/30">
              {Math.round(solarParams.rowAngleDeg)}&deg;
            </div>
          </div>
          <div>
            <Label
              className="text-[10px]"
              title="Distance between flight lines (cross-track). Tighter spacing gives more thermal image overlap but a longer flight."
            >
              Line spacing ({distanceLabel(unitSystem)})
            </Label>
            <NumericInput
              value={toDisplayDistance(solarParams.spacingM, unitSystem)}
              onChange={(v) =>
                onSolarChange({
                  ...solarParams,
                  spacingM: fromDisplayDistance(v, unitSystem),
                })
              }
              min={2}
              step={1}
              fallback={10}
              className="h-7 text-xs"
            />
          </div>
          <div>
            <Label
              className="text-[10px]"
              title="Distance between photos along each flight line (along-track). Without this, only the two ends of each row would ever be photographed."
            >
              Photo spacing ({distanceLabel(unitSystem)})
            </Label>
            <NumericInput
              value={toDisplayDistance(solarParams.photoSpacingM, unitSystem)}
              onChange={(v) =>
                onSolarChange({
                  ...solarParams,
                  photoSpacingM: fromDisplayDistance(v, unitSystem),
                })
              }
              min={1}
              step={1}
              fallback={8}
              className="h-7 text-xs"
            />
          </div>
          {(() => {
            const fov = THERMAL_CAMERA_FOV[payloadEnumValue];
            const rec = fov
              ? recommendSolarSpacing(solarParams.altitude, payloadEnumValue)
              : null;
            if (!rec) {
              return (
                <div className="col-span-2 text-[10px] text-muted-foreground">
                  Field of view for the current camera isn't known — set spacing
                  manually. (Recommended spacing is available for DJI thermal
                  payloads: H20T, M30T, M3T, M3TD, Matrice 4T.)
                </div>
              );
            }
            return (
              <div className="col-span-2 flex flex-col gap-1 text-[10px] text-muted-foreground bg-muted/20 rounded-md px-2 py-1">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    Recommended for {fov.label} at this altitude:{" "}
                    {Math.round(
                      toDisplayDistance(rec.lineSpacingM, unitSystem),
                    )}
                    {distanceLabel(unitSystem)} line /{" "}
                    {Math.round(
                      toDisplayDistance(rec.photoSpacingM, unitSystem),
                    )}
                    {distanceLabel(unitSystem)} photo
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-5 text-[10px] px-2 shrink-0"
                    onClick={() =>
                      onSolarChange({
                        ...solarParams,
                        spacingM: rec.lineSpacingM,
                        photoSpacingM: rec.photoSpacingM,
                      })
                    }
                  >
                    Use
                  </Button>
                </div>
                {fov.experimental && (
                  <div className="text-amber-500">
                    This drone/camera identity is unconfirmed (no published DJI
                    spec) — treat this recommendation as provisional until
                    verified on real hardware.
                  </div>
                )}
              </div>
            );
          })()}
          <div className="col-span-2 flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={solarParams.addPhotos}
                onChange={(e) =>
                  onSolarChange({
                    ...solarParams,
                    addPhotos: e.target.checked,
                  })
                }
                className="rounded"
              />
              Thermal (IR) photo at each waypoint
            </label>
          </div>
          <div className="col-span-2 text-[10px] text-muted-foreground">
            Gimbal is fixed straight down (nadir) — standard framing for
            photographing a flat panel surface from above.
          </div>
        </div>
      )}

      {exceedsWaypointLimit && (
        <div className="text-[10px] text-destructive mb-2">
          This would generate {waypointCount} waypoints, over the mission limit
          of {MAX_WAYPOINTS} — increase spacing before applying.
        </div>
      )}

      {/* Save as reusable preset */}
      {currentParams &&
        (savingPreset ? (
          <div className="flex items-center gap-1.5 mb-2">
            <Input
              autoFocus
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSavePreset();
                if (e.key === "Escape") {
                  setSavingPreset(false);
                  setPresetName("");
                }
              }}
              placeholder="Preset name"
              className="h-7 text-xs flex-1"
            />
            <Button
              size="icon"
              className="h-7 w-7 shrink-0"
              disabled={!presetName.trim() || presetSaveInFlight}
              onClick={handleSavePreset}
              title="Save preset"
            >
              <Check className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => {
                setSavingPreset(false);
                setPresetName("");
              }}
              title="Cancel"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={!token}
            title={
              token
                ? "Save this template's settings as a reusable preset"
                : "Sign in to save presets"
            }
            onClick={() => setSavingPreset(true)}
            className="w-full h-7 text-xs mb-2"
          >
            <Save className="h-3 w-3 mr-1" />
            Save as preset
          </Button>
        ))}

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onApply}
          disabled={exceedsWaypointLimit}
          className="flex-1 h-7 text-xs bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50"
        >
          <Check className="h-3 w-3 mr-1" />
          Apply
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="h-7 text-xs"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
