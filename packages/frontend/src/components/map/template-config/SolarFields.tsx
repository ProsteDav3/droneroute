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
import { type SolarParams } from "@/lib/templates";
import { recommendSolarSpacing, THERMAL_CAMERA_FOV } from "@/lib/solarCamera";
import type { UnitSystem } from "@droneroute/shared";
import { CaptureModeToggle } from "./CaptureModeToggle";

interface SolarFieldsProps {
  solarParams: SolarParams;
  onSolarChange: (params: SolarParams) => void;
  unitSystem: UnitSystem;
  payloadEnumValue: number;
  heightModeText: string;
}

export function SolarFields({
  solarParams,
  onSolarChange,
  unitSystem,
  payloadEnumValue,
  heightModeText,
}: SolarFieldsProps) {
  const fov = THERMAL_CAMERA_FOV[payloadEnumValue];
  const rec = fov
    ? recommendSolarSpacing(solarParams.altitude, payloadEnumValue)
    : null;

  return (
    <div className="grid grid-cols-2 gap-2 mb-3">
      <div>
        <Label
          className="text-[10px]"
          title={`Jak vysoko dron letí, ${heightModeText} (referenční výška této mise).`}
        >
          Výška ({heightLabel(unitSystem)})
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
          title="Kompasový směr, ve kterém vedou letové řádky, nastavený referenční čárou nakreslenou podél řady panelů."
        >
          Úhel řady
        </Label>
        <div className="h-7 flex items-center text-xs px-2 rounded-md border border-input bg-muted/30">
          {Math.round(solarParams.rowAngleDeg)}&deg;
        </div>
      </div>
      <div>
        <Label
          className="text-[10px]"
          title="Vzdálenost mezi letovými řádky (napříč tratí). Menší rozestup dává větší překryv termálních snímků, ale delší let."
        >
          Rozestup řádků ({distanceLabel(unitSystem)})
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
          title="Vzdálenost mezi fotkami podél každého letového řádku (podél trati). Bez toho by byly vyfoceny jen oba konce každé řady."
        >
          Rozestup fotek ({distanceLabel(unitSystem)})
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
      {!rec ? (
        <div className="col-span-2 text-[10px] text-muted-foreground">
          Zorné pole aktuální kamery není známé — nastavte rozestup ručně.
          (Doporučený rozestup je k dispozici pro termální kamery DJI: H20T,
          M30T, M3T, M3TD, Matrice 4T.)
        </div>
      ) : (
        <div className="col-span-2 flex flex-col gap-1 text-[10px] text-muted-foreground bg-muted/20 rounded-md px-2 py-1">
          <div className="flex items-center justify-between gap-2">
            <span>
              Doporučeno pro {fov!.label} v této výšce:{" "}
              {Math.round(toDisplayDistance(rec.lineSpacingM, unitSystem))}
              {distanceLabel(unitSystem)} řádek /{" "}
              {Math.round(toDisplayDistance(rec.photoSpacingM, unitSystem))}
              {distanceLabel(unitSystem)} fotka
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
              Použít
            </Button>
          </div>
          {fov!.experimental && (
            <div className="text-amber-500">
              Identita tohoto dronu/kamery není potvrzená (žádná zveřejněná
              specifikace DJI) — považujte toto doporučení za orientační, dokud
              nebude ověřeno na reálném hardwaru.
            </div>
          )}
        </div>
      )}
      <div className="col-span-2">
        <CaptureModeToggle
          value={solarParams.captureMode === "video" ? "video" : "photo"}
          onChange={(mode) =>
            onSolarChange({
              ...solarParams,
              captureMode: mode,
              addPhotos: mode === "photo",
            })
          }
        />
        <div className="text-[10px] text-muted-foreground mt-0.5">
          Foto: termální (IR) fotka na každém bodu trasy. Video: termální záznam
          od prvního do posledního bodu trasy.
        </div>
      </div>
      <div className="col-span-2 text-[10px] text-muted-foreground">
        Gimbal je pevně nastaven přímo dolů (nadir) — standardní kompozice pro
        fotografování ploché plochy panelů shora.
      </div>
    </div>
  );
}
