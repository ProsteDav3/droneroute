import { useState } from "react";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  heightLabel,
  distanceLabel,
  toDisplayHeight,
  fromDisplayHeight,
  toDisplayDistance,
  fromDisplayDistance,
} from "@/lib/units";
import { type GridParams } from "@/lib/templates";
import {
  recommendGridSpacing,
  computeAltitudeForGsd,
  computeGsdCm,
  isMultispectralPayload,
  NDVI_RECOMMENDED_FRONT_OVERLAP_PCT,
  NDVI_RECOMMENDED_SIDE_OVERLAP_PCT,
  VOLUMETRIC_RECOMMENDED_FRONT_OVERLAP_PCT,
  VOLUMETRIC_RECOMMENDED_SIDE_OVERLAP_PCT,
  type WideCameraFov,
} from "@/lib/solarCamera";
import type { UnitSystem } from "@droneroute/shared";
import { CaptureModeToggle } from "./CaptureModeToggle";

interface GridFieldsProps {
  gridParams: GridParams;
  onGridChange: (params: GridParams) => void;
  unitSystem: UnitSystem;
  wideFov: WideCameraFov | undefined;
  payloadEnumValue: number;
}

export function GridFields({
  gridParams,
  onGridChange,
  unitSystem,
  wideFov,
  payloadEnumValue,
}: GridFieldsProps) {
  // Overlap-%/GSD calculator inputs — ephemeral (not part of GridParams
  // itself), used only to compute a spacingM/photoSpacingM recommendation.
  // 75%/65% are common photogrammetry defaults (front/side overlap).
  const [gridFrontOverlapPct, setGridFrontOverlapPct] = useState(75);
  const [gridSideOverlapPct, setGridSideOverlapPct] = useState(65);

  // Target-GSD calculator input — ephemeral, drives a one-shot "Použít
  // výšku" action that sets gridParams.altitude via computeAltitudeForGsd
  // rather than being a persisted field of GridParams itself.
  const [targetGsdCm, setTargetGsdCm] = useState(2);

  // Volumetric-survey quick check — ephemeral, purely a planning aid (this
  // app doesn't compute volume itself). Off by default since most Grid
  // surveys are ordinary orthomosaic mapping, not stockpile volumetrics.
  const [gridVolumetricMode, setGridVolumetricMode] = useState(false);

  const targetAltitude = computeAltitudeForGsd(targetGsdCm, payloadEnumValue);
  const rec = recommendGridSpacing(
    gridParams.altitude,
    payloadEnumValue,
    gridFrontOverlapPct,
    gridSideOverlapPct,
  );
  const gsdCm = rec
    ? computeGsdCm(gridParams.altitude, payloadEnumValue)
    : null;

  return (
    <div className="grid grid-cols-2 gap-2 mb-3">
      <div>
        <Label className="text-[10px]">Výška ({heightLabel(unitSystem)})</Label>
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
          Rozestup řádků ({distanceLabel(unitSystem)})
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
        <Label
          className="text-[10px]"
          title="Vzdálenost mezi fotkami podél každého letového řádku (podél trati). Bez toho by byly vyfoceny jen oba konce každé řady."
        >
          Rozestup fotek ({distanceLabel(unitSystem)})
        </Label>
        <NumericInput
          value={toDisplayDistance(
            gridParams.photoSpacingM ?? gridParams.spacingM,
            unitSystem,
          )}
          onChange={(v) =>
            onGridChange({
              ...gridParams,
              photoSpacingM: fromDisplayDistance(v, unitSystem),
            })
          }
          min={1}
          step={1}
          fallback={20}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">Rotace (°)</Label>
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
      <div>
        <Label className="text-[10px]">Podélný překryv (%)</Label>
        <NumericInput
          value={gridFrontOverlapPct}
          onChange={setGridFrontOverlapPct}
          min={10}
          max={95}
          step={5}
          fallback={75}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">Boční překryv (%)</Label>
        <NumericInput
          value={gridSideOverlapPct}
          onChange={setGridSideOverlapPct}
          min={10}
          max={95}
          step={5}
          fallback={65}
          className="h-7 text-xs"
        />
      </div>
      {targetAltitude !== null && (
        <div className="col-span-2 flex items-end gap-2">
          <div className="flex-1">
            <Label
              className="text-[10px]"
              title="Zadejte požadované rozlišení (cm na pixel) a spočítá se výška letu, ve které ho tato kamera dosáhne."
            >
              Cílové GSD (cm/px)
            </Label>
            <NumericInput
              value={targetGsdCm}
              onChange={setTargetGsdCm}
              min={0.1}
              step={0.1}
              fallback={2}
              className="h-7 text-xs"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px] px-2 shrink-0"
            onClick={() =>
              onGridChange({ ...gridParams, altitude: targetAltitude })
            }
            title={`Nastaví výšku letu na ${Math.round(toDisplayHeight(targetAltitude, unitSystem))}${heightLabel(unitSystem)}`}
          >
            Použít výšku
          </Button>
        </div>
      )}
      {!rec ? (
        <div className="col-span-2 text-[10px] text-muted-foreground">
          Zorné pole aktuální kamery není známé — nastavte rozestup ručně.
        </div>
      ) : (
        <div className="col-span-2 flex flex-col gap-1 text-[10px] text-muted-foreground bg-muted/20 rounded-md px-2 py-1">
          <div className="flex items-center justify-between gap-2">
            <span>
              Doporučeno pro {wideFov?.label} v této výšce:{" "}
              {Math.round(toDisplayDistance(rec.lineSpacingM, unitSystem))}
              {distanceLabel(unitSystem)} řádek /{" "}
              {Math.round(toDisplayDistance(rec.photoSpacingM, unitSystem))}
              {distanceLabel(unitSystem)} fotka
              {gsdCm !== null && ` · GSD ${gsdCm.toFixed(1)} cm/px`}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-5 text-[10px] px-2 shrink-0"
              onClick={() =>
                onGridChange({
                  ...gridParams,
                  spacingM: rec.lineSpacingM,
                  photoSpacingM: rec.photoSpacingM,
                })
              }
            >
              Použít
            </Button>
          </div>
          {gsdCm === null && (
            <div>
              Rozlišení kamery není známé — GSD nelze spočítat, ale doporučený
              rozestup podle zorného pole platí.
            </div>
          )}
          {wideFov?.experimental && (
            <div className="text-amber-500">
              Identita tohoto dronu/kamery není potvrzená (žádná zveřejněná
              specifikace DJI) — považujte toto doporučení za orientační, dokud
              nebude ověřeno na reálném hardwaru.
            </div>
          )}
        </div>
      )}
      {isMultispectralPayload(payloadEnumValue) && (
        <div className="col-span-2 flex flex-col gap-1 text-[10px] text-muted-foreground bg-muted/20 rounded-md px-2 py-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">
              Multispektrální snímkování (NDVI)
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-5 text-[10px] px-2 shrink-0"
              onClick={() => {
                setGridFrontOverlapPct(NDVI_RECOMMENDED_FRONT_OVERLAP_PCT);
                setGridSideOverlapPct(NDVI_RECOMMENDED_SIDE_OVERLAP_PCT);
              }}
            >
              Použít doporučený překryv
            </Button>
          </div>
          <div>
            Vegetační indexy (NDVI) potřebují větší redundanci mezi snímky než
            běžná RGB fotogrammetrie — doporučeno{" "}
            {NDVI_RECOMMENDED_FRONT_OVERLAP_PCT}% podélný /{" "}
            {NDVI_RECOMMENDED_SIDE_OVERLAP_PCT}% boční překryv.
          </div>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>
              Vyfoťte kalibrační panel před vzletem a po přistání pro
              radiometrickou kalibraci.
            </li>
            <li>
              Létejte za stálého osvětlení (ideálně kolem slunečního poledne ±2
              h), vyhněte se proměnlivé oblačnosti během letu.
            </li>
          </ul>
        </div>
      )}
      <div className="col-span-2 flex items-center gap-1.5">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={gridVolumetricMode}
            onChange={(e) => setGridVolumetricMode(e.target.checked)}
            className="rounded"
          />
          Výpočet objemu (hromady, skládky)
        </label>
      </div>
      {gridVolumetricMode &&
        (() => {
          const sufficient =
            gridFrontOverlapPct >= VOLUMETRIC_RECOMMENDED_FRONT_OVERLAP_PCT &&
            gridSideOverlapPct >= VOLUMETRIC_RECOMMENDED_SIDE_OVERLAP_PCT;
          return (
            <div className="col-span-2 flex flex-col gap-1 text-[10px] text-muted-foreground bg-muted/20 rounded-md px-2 py-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  Kontrola pokrytí pro volumetrii
                </span>
                {!sufficient && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-5 text-[10px] px-2 shrink-0"
                    onClick={() => {
                      setGridFrontOverlapPct(
                        VOLUMETRIC_RECOMMENDED_FRONT_OVERLAP_PCT,
                      );
                      setGridSideOverlapPct(
                        VOLUMETRIC_RECOMMENDED_SIDE_OVERLAP_PCT,
                      );
                    }}
                  >
                    Použít doporučený překryv
                  </Button>
                )}
              </div>
              {sufficient ? (
                <div>
                  Aktuální překryv ({gridFrontOverlapPct}% podélný /{" "}
                  {gridSideOverlapPct}% boční) je dostatečný pro kvalitní
                  výpočet objemu — samotný výpočet ale provádí až
                  fotogrammetrický software (Pix4D, Metashape apod.).
                </div>
              ) : (
                <div className="text-amber-500">
                  Aktuální překryv ({gridFrontOverlapPct}% podélný /{" "}
                  {gridSideOverlapPct}% boční) nemusí stačit na kvalitní výpočet
                  objemu — pro volumetrii se doporučuje alespoň{" "}
                  {VOLUMETRIC_RECOMMENDED_FRONT_OVERLAP_PCT}% podélný /{" "}
                  {VOLUMETRIC_RECOMMENDED_SIDE_OVERLAP_PCT}% boční překryv.
                </div>
              )}
              <div>
                Pro nejlepší přesnost zvažte i křížový nálet (druhý grid otočený
                o 90°) — samotný výpočet objemu ale provádí externí
                fotogrammetrický software, tady jde jen o rychlou kontrolu
                pokrytí před letem.
              </div>
            </div>
          );
        })()}
      <div>
        <CaptureModeToggle
          value={gridParams.captureMode === "video" ? "video" : "photo"}
          onChange={(mode) =>
            onGridChange({
              ...gridParams,
              captureMode: mode,
              addPhotos: mode === "photo",
            })
          }
        />
      </div>
      <div className="flex items-end pb-1">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={gridParams.reverse}
            onChange={(e) =>
              onGridChange({ ...gridParams, reverse: e.target.checked })
            }
            className="rounded"
          />
          Obrátit směr
        </label>
      </div>
      <div className="col-span-2 flex items-end pb-1">
        <label
          className="flex items-center gap-1.5 text-xs cursor-pointer"
          title="Nalétá druhý průlet otočený o 90° oproti prvnímu — doporučeno pro 3D rekonstrukci (fotogrammetrické mesh modely), kde jednosměrná mřížka málo pokrývá svislé plochy jako stěny a hrany střech."
        >
          <input
            type="checkbox"
            checked={gridParams.crosshatch ?? false}
            onChange={(e) =>
              onGridChange({ ...gridParams, crosshatch: e.target.checked })
            }
            className="rounded"
          />
          Crosshatch (dvojitá mřížka pro 3D rekonstrukci)
        </label>
      </div>
    </div>
  );
}
