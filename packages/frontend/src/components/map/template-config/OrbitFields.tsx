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
  computeAltitudeForPitch,
  computeFramedForRadius,
  computeFramedForAltitude,
  aimPitchOutOfRange,
  computeOrbitAimPitch,
  fitAltitudeRange,
  fitRadiusRange,
  computeRadiusForPitch,
  defaultAimHeight,
  objectFitsInFrame,
  poiDistanceSwing,
  recomputeBuildingOrbitForArc,
  DEFAULT_WIDE_VFOV_DEG,
  MIN_GIMBAL_PITCH_DEG,
  MAX_GIMBAL_PITCH_DEG,
  type FitRange,
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
  const vfovDeg = wideFov?.vfovDeg ?? DEFAULT_WIDE_VFOV_DEG;
  const linked = orbitParams.altitudeGimbalLinked;
  const altitudeLocked = !!orbitParams.altitudeLocked;
  /** What the panel shows in "Mířit na výšku": the explicit value, or the
   *  automatic middle of the object until the user overrides it. */
  const shownAimHeight =
    orbitParams.aimHeight ?? defaultAimHeight(orbitParams.poiHeight);
  const aimIsAuto = orbitParams.aimHeight === undefined;

  /** Pitch for a candidate geometry, honoring the current aim height. */
  const pitchFor = (altitude: number, poiHeight: number, radiusM: number) =>
    computeOrbitAimPitch(altitude, poiHeight, radiusM, orbitParams.aimHeight);

  /**
   * Locking the altitude trades the whole-object framing guarantee away —
   * altitude is exactly what that solve moves to keep the subject in shot —
   * so the panel checks the real geometry and says so rather than letting a
   * cropped building through unannounced.
   */
  const objectCropped =
    orbitParams.poiHeight > 0 &&
    !objectFitsInFrame(
      orbitParams.altitude,
      orbitParams.poiHeight,
      orbitParams.radiusM,
      vfovDeg,
      shownAimHeight,
    );

  /**
   * Flying below the aim point asks the camera to look steeply upward, past
   * anything a drone gimbal reaches. The pitch gets clamped there, which
   * means it no longer points where this panel says — worth saying out loud
   * rather than exporting an angle the aircraft will refuse.
   */
  const aimUnreachable = aimPitchOutOfRange(
    orbitParams.altitude,
    orbitParams.poiHeight,
    orbitParams.radiusM,
    orbitParams.aimHeight,
  );

  /**
   * With a locked POI the flight circle can sit anywhere the clearance
   * allows — including an arc that starts and ends just short of the
   * subject and swings round its far side, where the subject is plainly
   * larger at the ends than in the middle. That is a composition choice,
   * not an error, so instead of clamping the drag (as an earlier revision
   * did, at a fixed 1.6 ratio that forbade exactly that shot) the panel
   * measures the swing over the waypoints actually flown and says so.
   */
  const swing = orbitParams.poiCenter
    ? poiDistanceSwing(
        orbitParams.center,
        orbitParams.poiCenter,
        orbitParams.radiusM,
        orbitParams.startAngleDeg,
        orbitParams.endAngleDeg,
        orbitParams.numPoints,
      )
    : null;

  /**
   * What the radius and altitude fields print underneath themselves: how far
   * in / how low the whole object still fits, and where it fills a
   * comfortable share of the frame — each computed for the OTHER value as it
   * stands right now, so the user can see before typing where a change will
   * land. Only meaningful when there's an object to frame.
   */
  const radiusRange =
    orbitParams.poiHeight > 0
      ? fitRadiusRange(
          orbitParams.altitude,
          orbitParams.poiHeight,
          vfovDeg,
          shownAimHeight,
          orbitParams.radiusM,
        )
      : null;
  const altitudeRange =
    orbitParams.poiHeight > 0
      ? fitAltitudeRange(
          orbitParams.radiusM,
          orbitParams.poiHeight,
          vfovDeg,
          shownAimHeight,
          orbitParams.altitude,
        )
      : null;

  /**
   * Narrowing a building orbit's arc to one side (an obstacle or neighboring
   * structure blocks the rest) should also shrink the radius back down —
   * the initial recommendation sizes it for a full 360° loop, which for a
   * large building can end up far larger than the arc actually flown needs,
   * reaching past the building's own footprint into unrelated obstacles.
   * Only re-derives when linked framing is actually driving the numbers
   * (skipped for a manually unlocked pitch or a locked/decoupled POI, same
   * gating as everywhere else this data is used).
   */
  const applyArcChange = (startAngleDeg: number, endAngleDeg: number) => {
    if (
      orbitParams.buildingVertices &&
      linked &&
      // Re-deriving the framing moves the altitude, which is precisely what
      // the lock exists to prevent.
      !altitudeLocked &&
      !orbitParams.poiCenter
    ) {
      const reframed = recomputeBuildingOrbitForArc(
        orbitParams.buildingVertices,
        orbitParams.poiHeight,
        vfovDeg,
        startAngleDeg,
        endAngleDeg,
        orbitParams.aimHeight,
      );
      onOrbitChange({
        ...orbitParams,
        startAngleDeg,
        endAngleDeg,
        center: reframed.center,
        radiusM: reframed.radiusM,
        altitude: reframed.altitude,
        gimbalPitchDeg: reframed.gimbalPitchDeg,
      });
    } else {
      onOrbitChange({ ...orbitParams, startAngleDeg, endAngleDeg });
    }
  };

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
          ariaLabel="Radius"
          onChange={(v) => {
            const radiusM = fromDisplayDistance(v, unitSystem);
            if (!linked) {
              onOrbitChange({ ...orbitParams, radiusM });
              return;
            }
            // The locked case is the whole point of the lock: hold the
            // altitude, re-aim the gimbal, let the framing take care of
            // itself (objectCropped warns when it can't).
            if (altitudeLocked) {
              onOrbitChange({
                ...orbitParams,
                radiusM,
                gimbalPitchDeg: pitchFor(
                  orbitParams.altitude,
                  orbitParams.poiHeight,
                  radiusM,
                ),
              });
              return;
            }
            const framed = computeFramedForRadius(
              radiusM,
              orbitParams.poiHeight,
              vfovDeg,
              orbitParams.altitude,
              orbitParams.aimHeight,
            );
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
                    gimbalPitchDeg: pitchFor(
                      orbitParams.altitude,
                      orbitParams.poiHeight,
                      radiusM,
                    ),
                  },
            );
          }}
          min={5}
          step={5}
          fallback={5}
          className="h-7 text-xs"
        />
        <FitRangeHint
          range={radiusRange}
          current={orbitParams.radiusM}
          toDisplay={(m) => toDisplayDistance(m, unitSystem)}
          unit={distanceLabel(unitSystem)}
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
        <div className="flex items-center justify-between">
          <Label
            className="text-[10px]"
            title={`Jak vysoko dron letí, ${heightModeText} (referenční výška této mise).`}
          >
            Výška letu ({heightLabel(unitSystem)})
          </Label>
          <button
            type="button"
            disabled={!linked}
            onClick={() =>
              onOrbitChange({ ...orbitParams, altitudeLocked: !altitudeLocked })
            }
            title={
              !linked
                ? "Výška se přepočítává jen v propojeném režimu — zamykat tu není co."
                : altitudeLocked
                  ? "Výška letu je zamčená — úprava radiusu přepočítá jen náklon gimbalu. Kliknutím odemknete."
                  : "Zamkne výšku letu (např. kvůli překážkám). Úprava radiusu pak přepočítá jen náklon gimbalu, ne výšku."
            }
            className="text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
          >
            {altitudeLocked ? (
              <Lock className="h-3 w-3 text-amber-400" />
            ) : (
              <Unlock className="h-3 w-3" />
            )}
          </button>
        </div>
        <NumericInput
          value={toDisplayHeight(orbitParams.altitude, unitSystem)}
          ariaLabel="Výška letu"
          onChange={(v) => {
            const altitude = fromDisplayHeight(v, unitSystem);
            if (!linked) {
              onOrbitChange({ ...orbitParams, altitude });
              return;
            }
            // Typing an altitude is an explicit instruction — the lock only
            // stops the framing solve from moving it behind the user's back,
            // it doesn't make the field read-only.
            if (altitudeLocked) {
              onOrbitChange({
                ...orbitParams,
                altitude,
                gimbalPitchDeg: pitchFor(
                  altitude,
                  orbitParams.poiHeight,
                  orbitParams.radiusM,
                ),
              });
              return;
            }
            const framed = computeFramedForAltitude(
              altitude,
              orbitParams.poiHeight,
              vfovDeg,
              orbitParams.radiusM,
              orbitParams.aimHeight,
            );
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
                    gimbalPitchDeg: pitchFor(
                      altitude,
                      orbitParams.poiHeight,
                      orbitParams.radiusM,
                    ),
                  },
            );
          }}
          min={5}
          step={5}
          fallback={30}
          className="h-7 text-xs"
        />
        <FitRangeHint
          range={altitudeRange}
          current={orbitParams.altitude}
          toDisplay={(m) => toDisplayHeight(m, unitSystem)}
          unit={heightLabel(unitSystem)}
        />
      </div>
      <div>
        <Label
          className="text-[10px]"
          title="Skutečná výška orbitovaného objektu od země (např. budova) — určuje, co se musí vejít do záběru. Kam kamera míří, řídí pole vedle."
        >
          Výška objektu ({heightLabel(unitSystem)})
        </Label>
        <NumericInput
          value={toDisplayHeight(orbitParams.poiHeight, unitSystem)}
          ariaLabel="Výška objektu"
          onChange={(v) => {
            const poiHeight = fromDisplayHeight(v, unitSystem);
            if (!linked) {
              onOrbitChange({ ...orbitParams, poiHeight });
              return;
            }
            if (altitudeLocked) {
              onOrbitChange({
                ...orbitParams,
                poiHeight,
                gimbalPitchDeg: pitchFor(
                  orbitParams.altitude,
                  poiHeight,
                  orbitParams.radiusM,
                ),
              });
              return;
            }
            const framed = computeFramedForRadius(
              orbitParams.radiusM,
              poiHeight,
              vfovDeg,
              orbitParams.altitude,
              orbitParams.aimHeight,
            );
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
                    gimbalPitchDeg: pitchFor(
                      orbitParams.altitude,
                      poiHeight,
                      orbitParams.radiusM,
                    ),
                  },
            );
          }}
          min={0}
          step={1}
          fallback={0}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label
            className="text-[10px]"
            title="Přesná výška, na kterou kamera míří. Výchozí je polovina objektu; zadanou hodnotu bere doslova, takže u 20m budovy zamíříte na střechu (20) i na patu (0)."
          >
            Mířit na výšku ({heightLabel(unitSystem)})
          </Label>
          {!aimIsAuto && (
            <button
              type="button"
              onClick={() =>
                onOrbitChange({
                  ...orbitParams,
                  aimHeight: undefined,
                  gimbalPitchDeg: linked
                    ? computeOrbitAimPitch(
                        orbitParams.altitude,
                        orbitParams.poiHeight,
                        orbitParams.radiusM,
                        undefined,
                      )
                    : orbitParams.gimbalPitchDeg,
                })
              }
              title="Zpět na automatiku — polovinu výšky objektu."
              className="text-[9px] text-muted-foreground hover:text-foreground"
            >
              auto
            </button>
          )}
        </div>
        <NumericInput
          value={toDisplayHeight(shownAimHeight, unitSystem)}
          ariaLabel="Mířit na výšku"
          onChange={(v) => {
            const aimHeight = fromDisplayHeight(v, unitSystem);
            onOrbitChange({
              ...orbitParams,
              aimHeight,
              gimbalPitchDeg: linked
                ? computeOrbitAimPitch(
                    orbitParams.altitude,
                    orbitParams.poiHeight,
                    orbitParams.radiusM,
                    aimHeight,
                  )
                : orbitParams.gimbalPitchDeg,
            });
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
          ariaLabel="Náklon gimbalu"
          onChange={(v) => {
            if (!linked) {
              onOrbitChange({ ...orbitParams, gimbalPitchDeg: v });
              return;
            }
            // Asking for the angle that's already set means "leave it
            // alone". Without this the field's whole-degree granularity
            // moves the aircraft on a no-op edit: at a 200m radius one
            // degree spans several metres of altitude, so re-solving lands
            // on the middle of that degree's band rather than back where it
            // started.
            if (v === orbitParams.gimbalPitchDeg) return;
            // Every branch re-derives the pitch from the value it just
            // solved for, so the displayed angle never diverges from the
            // geometry actually stored — the solve can clamp (altitude
            // floor/ceiling, radius bounds), and an unreachable request has
            // to read back as what will really be flown.
            if (altitudeLocked) {
              const radiusM = computeRadiusForPitch(
                v,
                orbitParams.altitude,
                shownAimHeight,
              );
              onOrbitChange({
                ...orbitParams,
                radiusM,
                gimbalPitchDeg: pitchFor(
                  orbitParams.altitude,
                  orbitParams.poiHeight,
                  radiusM,
                ),
              });
              return;
            }
            // Solve against the aim height, not the object's full height:
            // the pitch shown everywhere else in this panel points at the
            // aim height, so solving against the roof made retyping the
            // very same angle shove the drone several metres upward.
            const altitude = computeAltitudeForPitch(
              v,
              shownAimHeight,
              orbitParams.radiusM,
            );
            onOrbitChange({
              ...orbitParams,
              altitude,
              gimbalPitchDeg: pitchFor(
                altitude,
                orbitParams.poiHeight,
                orbitParams.radiusM,
              ),
            });
          }}
          min={MIN_GIMBAL_PITCH_DEG}
          max={MAX_GIMBAL_PITCH_DEG}
          step={1}
          fallback={-45}
          className="h-7 text-xs"
        />
        <div className="text-[10px] text-muted-foreground mt-0.5">
          {!linked
            ? "Uzamčeno — výška a náklon gimbalu se už vzájemně automaticky neaktualizují."
            : altitudeLocked
              ? "Výška letu zamčená — úprava radiusu přepočítá jen náklon gimbalu. Kamera pořád míří na zadanou výšku, ale vejití celého objektu do záběru už zaručit nelze (viz upozornění níže)."
              : wideFov
                ? "Propojeno — úprava radiusu, výšky letu nebo výšky objektu přepočítá zbylé hodnoty tak, aby byl celý objekt v záběru vybrané kamery."
                : "Propojeno — úprava radiusu, výšky letu nebo výšky objektu přepočítá zbylé hodnoty tak, aby byl celý objekt v záběru. FOV konkrétní kamery není známé (vyberte dron v nastavení mise pro přesnější výpočet), použit typický širokoúhlý objektiv."}
        </div>
        {aimUnreachable && (
          <div className="text-[10px] text-amber-400 mt-1">
            Kamera by musela mířit strmě vzhůru — dron letí pod bodem zaměření.
            Náklon je omezen na {MAX_GIMBAL_PITCH_DEG}°, takže nemíří přesně na
            zadanou výšku. Zvyšte výšku letu nebo snižte výšku míření.
          </div>
        )}
        {objectCropped && (
          <div className="text-[10px] text-amber-400 mt-1">
            Objekt vysoký {toDisplayHeight(orbitParams.poiHeight, unitSystem)}{" "}
            {heightLabel(unitSystem)} se při této výšce letu a radiusu do záběru
            celý nevejde. Zvětšete radius, změňte výšku letu, nebo zamiřte
            jinam.
          </div>
        )}
      </div>
      <div>
        <Label className="text-[10px]">Počáteční úhel (°)</Label>
        <NumericInput
          value={orbitParams.startAngleDeg}
          onChange={(v) => applyArcChange(v, orbitParams.endAngleDeg)}
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
          onChange={(v) => applyArcChange(orbitParams.startAngleDeg, v)}
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
      {swing && Number.isFinite(swing.ratio) && (
        <div
          className={`col-span-2 text-[10px] ${swing.ratio > 2 ? "text-amber-400" : "text-muted-foreground"}`}
          title="Nejmenší a největší vzdálenost letových bodů od cíle kamery. Čím větší rozdíl, tím víc se mění velikost objektu v záběru během letu — u oblouku, který začíná a končí těsně u objektu a obletí ho z druhé strany, je to záměr."
        >
          Vzdálenost od cíle{" "}
          {Math.round(toDisplayDistance(swing.nearM, unitSystem))}–
          {Math.round(toDisplayDistance(swing.farM, unitSystem))}{" "}
          {distanceLabel(unitSystem)} · velikost v záběru se změní{" "}
          {swing.ratio.toFixed(1)}×
        </div>
      )}
      <div className="col-span-2">
        <CaptureModeToggle
          value={orbitParams.captureMode === "video" ? "video" : "photo"}
          cinema={{ enabled: !!orbitParams.cinema }}
          onChange={({ mode, cinema }) =>
            onOrbitChange({ ...orbitParams, captureMode: mode, cinema })
          }
        />
      </div>
    </div>
  );
}

/**
 * One line under a radius/altitude field: the bound past which the whole
 * object no longer fits in frame, and the band where it fills a comfortable
 * share of it. Turns amber when the current value is outside the fitting
 * range — the same condition the object-cropped warning fires on, surfaced
 * right where the number being edited lives.
 */
function FitRangeHint({
  range,
  current,
  toDisplay,
  unit,
}: {
  range: FitRange | null;
  current: number;
  toDisplay: (metres: number) => number;
  unit: string;
}) {
  if (!range) return null;
  const outside =
    current < range.fitsFrom ||
    (range.fitsTo !== null && current > range.fitsTo);
  const fitsText =
    range.fitsTo === null
      ? `vejde se od ${toDisplay(range.fitsFrom)} ${unit}`
      : `vejde se ${toDisplay(range.fitsFrom)}–${toDisplay(range.fitsTo)} ${unit}`;
  const idealText =
    range.idealTo > range.idealFrom
      ? ` · ideálně ${toDisplay(range.idealFrom)}–${toDisplay(range.idealTo)} ${unit}`
      : "";
  return (
    <div
      className={`text-[10px] mt-0.5 ${outside ? "text-amber-400" : "text-muted-foreground"}`}
      title="Rozsah, ve kterém je celý objekt v záběru kamery (při ostatních hodnotách tak, jak jsou teď). „Ideálně“ = objekt zabírá zhruba 35–65 % výšky záběru: ani ztracený v prostoru, ani na hraně oříznutí."
    >
      {outside ? "✗ " : "✓ "}
      {fitsText}
      {idealText}
    </div>
  );
}
