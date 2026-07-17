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
import { type FacadeParams } from "@/lib/templates";
import {
  recommendFacadeGrid,
  deriveFacadeGridCounts,
  THERMAL_CAMERA_FOV,
} from "@/lib/solarCamera";
import { haversineDistance } from "@/lib/geo";
import type { UnitSystem } from "@droneroute/shared";
import { CaptureModeToggle } from "./CaptureModeToggle";

interface FacadeFieldsProps {
  facadeParams: FacadeParams;
  onFacadeChange: (params: FacadeParams) => void;
  unitSystem: UnitSystem;
  payloadEnumValue: number;
}

export function FacadeFields({
  facadeParams,
  onFacadeChange,
  unitSystem,
  payloadEnumValue,
}: FacadeFieldsProps) {
  // Thermal-overlap calculator inputs — ephemeral (not part of FacadeParams
  // itself), used only to recommend numRows/numColumns. 20% matches
  // recommendSolarSpacing's default — full coverage without gaps, not
  // photogrammetric reconstruction, so no need for Grid's higher 65-75%
  // overlap.
  const [facadeHorizOverlapPct, setFacadeHorizOverlapPct] = useState(20);
  const [facadeVertOverlapPct, setFacadeVertOverlapPct] = useState(20);

  const rec = recommendFacadeGrid(
    facadeParams.distanceM,
    payloadEnumValue,
    facadeHorizOverlapPct,
    facadeVertOverlapPct,
  );

  return (
    <div className="grid grid-cols-2 gap-2 mb-3">
      <div>
        <Label className="text-[10px]">
          Vzdálenost od stěny ({distanceLabel(unitSystem)})
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
          Min. výška ({heightLabel(unitSystem)})
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
          Max. výška ({heightLabel(unitSystem)})
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
        <Label className="text-[10px]">Řady</Label>
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
        <Label className="text-[10px]">Sloupce</Label>
        <NumericInput
          value={facadeParams.numColumns}
          onChange={(v) => onFacadeChange({ ...facadeParams, numColumns: v })}
          min={2}
          max={30}
          fallback={8}
          integer
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">Vodorovný překryv (%)</Label>
        <NumericInput
          value={facadeHorizOverlapPct}
          onChange={setFacadeHorizOverlapPct}
          min={0}
          max={90}
          step={5}
          fallback={20}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">Svislý překryv (%)</Label>
        <NumericInput
          value={facadeVertOverlapPct}
          onChange={setFacadeVertOverlapPct}
          min={0}
          max={90}
          step={5}
          fallback={20}
          className="h-7 text-xs"
        />
      </div>
      {!rec ? (
        <div className="col-span-2 text-[10px] text-muted-foreground">
          Termální zorné pole aktuální kamery není známé — nastavte řady a
          sloupce ručně. (Doporučení je k dispozici pro termální kamery DJI:
          H20T, M30T, M3T, M3TD, Matrice 4T.)
        </div>
      ) : (
        (() => {
          const wallLengthM = haversineDistance(
            facadeParams.point1[0],
            facadeParams.point1[1],
            facadeParams.point2[0],
            facadeParams.point2[1],
          );
          const wallHeightM =
            facadeParams.maxAltitude - facadeParams.minAltitude;
          const { numColumns: recNumColumns, numRows: recNumRows } =
            deriveFacadeGridCounts(
              wallLengthM,
              wallHeightM,
              rec.horizSpacingM,
              rec.vertSpacingM,
            );
          const fov = THERMAL_CAMERA_FOV[payloadEnumValue];
          return (
            <div className="col-span-2 flex flex-col gap-1 text-[10px] text-muted-foreground bg-muted/20 rounded-md px-2 py-1">
              <div className="flex items-center justify-between gap-2">
                <span>
                  Doporučeno pro {fov?.label} při tomto odstupu: {recNumRows}{" "}
                  řad / {recNumColumns} sloupců
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-5 text-[10px] px-2 shrink-0"
                  onClick={() =>
                    onFacadeChange({
                      ...facadeParams,
                      numRows: recNumRows,
                      numColumns: recNumColumns,
                    })
                  }
                >
                  Použít
                </Button>
              </div>
              {fov?.experimental && (
                <div className="text-amber-500">
                  Identita tohoto dronu/kamery není potvrzená (žádná zveřejněná
                  specifikace DJI) — považujte toto doporučení za orientační,
                  dokud nebude ověřeno na reálném hardwaru.
                </div>
              )}
            </div>
          );
        })()
      )}
      <div>
        <CaptureModeToggle
          value={facadeParams.captureMode === "video" ? "video" : "photo"}
          onChange={(mode) =>
            onFacadeChange({
              ...facadeParams,
              captureMode: mode,
              addPhotos: mode === "photo",
            })
          }
        />
      </div>
    </div>
  );
}
