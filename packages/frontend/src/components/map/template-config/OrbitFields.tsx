import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { Lock, Unlock } from "lucide-react";
import { LocationSearch } from "@/components/ui/location-search";
import {
  heightLabel,
  distanceLabel,
  toDisplayHeight,
  fromDisplayHeight,
  toDisplayDistance,
  fromDisplayDistance,
} from "@/lib/units";
import {
  computeGimbalPitch,
  computeAltitudeForPitch,
  computeFramedForRadius,
  computeFramedForAltitude,
  type OrbitParams,
} from "@/lib/templates";
import type { WideCameraFov } from "@/lib/solarCamera";
import type { UnitSystem } from "@droneroute/shared";
import { CaptureModeToggle } from "./CaptureModeToggle";

interface OrbitFieldsProps {
  orbitParams: OrbitParams;
  onOrbitChange: (params: OrbitParams) => void;
  unitSystem: UnitSystem;
  wideFov: WideCameraFov | undefined;
  heightModeText: string;
  setFlyToTarget: (target: [number, number]) => void;
}

export function OrbitFields({
  orbitParams,
  onOrbitChange,
  unitSystem,
  wideFov,
  heightModeText,
  setFlyToTarget,
}: OrbitFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-2 mb-3">
      <div className="col-span-2">
        <Label className="text-[10px]">
          Vystředit na adresu nebo souřadnice
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
          title="Vodorovná vzdálenost od středového bodu k letové trase."
        >
          Radius ({distanceLabel(unitSystem)})
        </Label>
        <NumericInput
          value={toDisplayDistance(orbitParams.radiusM, unitSystem)}
          onChange={(v) => {
            const radiusM = fromDisplayDistance(v, unitSystem);
            if (orbitParams.altitudeGimbalLinked) {
              const framed = wideFov
                ? computeFramedForRadius(
                    radiusM,
                    orbitParams.poiHeight,
                    wideFov.vfovDeg,
                    orbitParams.altitude,
                  )
                : null;
              onOrbitChange(
                framed
                  ? {
                      ...orbitParams,
                      radiusM,
                      altitude: framed.altitude,
                      gimbalPitchDeg: framed.gimbalPitchDeg,
                    }
                  : {
                      ...orbitParams,
                      radiusM,
                      gimbalPitchDeg: computeGimbalPitch(
                        orbitParams.altitude,
                        orbitParams.poiHeight,
                        radiusM,
                      ),
                    },
              );
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
        <Label className="text-[10px]">Body</Label>
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
          title={`Jak vysoko dron letí, ${heightModeText} (referenční výška této mise).`}
        >
          Výška letu ({heightLabel(unitSystem)})
        </Label>
        <NumericInput
          value={toDisplayHeight(orbitParams.altitude, unitSystem)}
          onChange={(v) => {
            const altitude = fromDisplayHeight(v, unitSystem);
            if (orbitParams.altitudeGimbalLinked) {
              const framed = wideFov
                ? computeFramedForAltitude(
                    altitude,
                    orbitParams.poiHeight,
                    wideFov.vfovDeg,
                    orbitParams.radiusM,
                  )
                : null;
              onOrbitChange(
                framed
                  ? {
                      ...orbitParams,
                      altitude,
                      radiusM: framed.radiusM,
                      gimbalPitchDeg: framed.gimbalPitchDeg,
                    }
                  : {
                      ...orbitParams,
                      altitude,
                      gimbalPitchDeg: computeGimbalPitch(
                        altitude,
                        orbitParams.poiHeight,
                        orbitParams.radiusM,
                      ),
                    },
              );
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
          title="Skutečná výška bodu, na který má kamera mířit (např. střecha) — stejná reference jako výška letu."
        >
          Výška POI ({heightLabel(unitSystem)})
        </Label>
        <NumericInput
          value={toDisplayHeight(orbitParams.poiHeight, unitSystem)}
          onChange={(v) => {
            const poiHeight = fromDisplayHeight(v, unitSystem);
            if (orbitParams.altitudeGimbalLinked) {
              const framed = wideFov
                ? computeFramedForRadius(
                    orbitParams.radiusM,
                    poiHeight,
                    wideFov.vfovDeg,
                    orbitParams.altitude,
                  )
                : null;
              onOrbitChange(
                framed
                  ? {
                      ...orbitParams,
                      poiHeight,
                      altitude: framed.altitude,
                      gimbalPitchDeg: framed.gimbalPitchDeg,
                    }
                  : {
                      ...orbitParams,
                      poiHeight,
                      gimbalPitchDeg: computeGimbalPitch(
                        orbitParams.altitude,
                        poiHeight,
                        orbitParams.radiusM,
                      ),
                    },
              );
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
            title="Náklon kamery. -90° = přímo dolů, 0° = horizont."
          >
            Náklon gimbalu (°)
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
                ? "Výška a náklon gimbalu se vzájemně automaticky aktualizují. Kliknutím uzamknete a upravíte je nezávisle."
                : "Výška a náklon gimbalu jsou uzamčeny nezávisle. Kliknutím je znovu propojíte."
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
            ? wideFov
              ? "Propojeno — úprava radiusu, výšky letu nebo výšky POI přepočítá zbylé hodnoty tak, aby byl celý objekt v záběru vybrané kamery."
              : "Propojeno s výškou — změna kteréhokoliv přepočítá druhý z radiusu a výšky POI. FOV vybrané kamery není známé, přesné zarovnání na celý objekt není k dispozici."
            : "Uzamčeno — výška a náklon gimbalu se už vzájemně automaticky neaktualizují."}
        </div>
      </div>
      <div>
        <Label className="text-[10px]">Počáteční úhel (°)</Label>
        <NumericInput
          value={orbitParams.startAngleDeg}
          onChange={(v) => onOrbitChange({ ...orbitParams, startAngleDeg: v })}
          min={-360}
          max={360}
          step={5}
          fallback={0}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">Koncový úhel (°, 360 = celý kruh)</Label>
        <NumericInput
          value={orbitParams.endAngleDeg}
          onChange={(v) => onOrbitChange({ ...orbitParams, endAngleDeg: v })}
          min={orbitParams.startAngleDeg}
          max={720}
          step={5}
          fallback={360}
          className="h-7 text-xs"
        />
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={orbitParams.clockwise}
            onChange={(e) =>
              onOrbitChange({ ...orbitParams, clockwise: e.target.checked })
            }
            className="rounded"
          />
          Po směru hodin
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
          Středový POI
        </label>
        <label
          className="flex items-center gap-1.5 text-xs cursor-pointer"
          title="Zafixuje cíl kamery na aktuálním středu — přesun nebo změna radiusu orbitu pak s ním nehne, náklon gimbalu se dopočítá zvlášť pro každý bod trasy."
        >
          <input
            type="checkbox"
            checked={!!orbitParams.poiCenter}
            onChange={(e) =>
              onOrbitChange({
                ...orbitParams,
                poiCenter: e.target.checked ? orbitParams.center : undefined,
              })
            }
            className="rounded"
          />
          Uzamknout POI
        </label>
      </div>
      <div className="col-span-2">
        <CaptureModeToggle
          value={orbitParams.captureMode === "video" ? "video" : "photo"}
          onChange={(mode) =>
            onOrbitChange({ ...orbitParams, captureMode: mode })
          }
        />
      </div>
    </div>
  );
}
