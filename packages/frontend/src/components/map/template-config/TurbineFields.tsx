import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
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
import { type TurbineParams } from "@/lib/templates";
import type { UnitSystem } from "@droneroute/shared";
import { CaptureModeToggle } from "./CaptureModeToggle";

interface TurbineFieldsProps {
  turbineParams: TurbineParams;
  onTurbineChange: (params: TurbineParams) => void;
  unitSystem: UnitSystem;
}

export function TurbineFields({
  turbineParams,
  onTurbineChange,
  unitSystem,
}: TurbineFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-2 mb-3">
      <div>
        <Label className="text-[10px]">
          Výška rotoru ({heightLabel(unitSystem)})
        </Label>
        <NumericInput
          value={toDisplayHeight(turbineParams.hubHeight, unitSystem)}
          onChange={(v) =>
            onTurbineChange({
              ...turbineParams,
              hubHeight: fromDisplayHeight(v, unitSystem),
            })
          }
          min={5}
          step={5}
          fallback={90}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">
          Délka listu ({distanceLabel(unitSystem)})
        </Label>
        <NumericInput
          value={toDisplayDistance(turbineParams.bladeLengthM, unitSystem)}
          onChange={(v) =>
            onTurbineChange({
              ...turbineParams,
              bladeLengthM: fromDisplayDistance(v, unitSystem),
            })
          }
          min={5}
          step={5}
          fallback={55}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">Počet listů</Label>
        <NumericInput
          value={turbineParams.numBlades}
          onChange={(v) => onTurbineChange({ ...turbineParams, numBlades: v })}
          min={1}
          max={6}
          fallback={3}
          integer
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label
          className="text-[10px]"
          title="Kompasový směr, kterým je natočený rotor turbíny (kolmo na rovinu, ve které se listy točí). Musí odpovídat skutečné orientaci turbíny — výchozí hodnota je jen zástupná."
        >
          Natočení rotoru (°)
        </Label>
        <NumericInput
          value={turbineParams.rotorYawDeg}
          onChange={(v) =>
            onTurbineChange({ ...turbineParams, rotorYawDeg: v })
          }
          min={0}
          max={360}
          step={5}
          fallback={0}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label
          className="text-[10px]"
          title="Úhel prvního listu v rovině rotoru, 0° = svisle nahoru. Ostatní listy jsou rozmístěné rovnoměrně po 360°/počet listů."
        >
          Úhel 1. listu (°)
        </Label>
        <NumericInput
          value={turbineParams.blade1AngleDeg}
          onChange={(v) =>
            onTurbineChange({ ...turbineParams, blade1AngleDeg: v })
          }
          min={-180}
          max={180}
          step={5}
          fallback={0}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label
          className="text-[10px]"
          title="Bezpečná vzdálenost dronu od roviny listů."
        >
          Odstup ({distanceLabel(unitSystem)})
        </Label>
        <NumericInput
          value={toDisplayDistance(turbineParams.standoffM, unitSystem)}
          onChange={(v) =>
            onTurbineChange({
              ...turbineParams,
              standoffM: fromDisplayDistance(v, unitSystem),
            })
          }
          min={3}
          step={1}
          fallback={10}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label
          className="text-[10px]"
          title="Boční rozestup mezi průlety pro pokrytí náběžné a odtokové hrany listu."
        >
          Rozestup hran ({distanceLabel(unitSystem)})
        </Label>
        <NumericInput
          value={toDisplayDistance(turbineParams.edgeSpacingM, unitSystem)}
          onChange={(v) =>
            onTurbineChange({
              ...turbineParams,
              edgeSpacingM: fromDisplayDistance(v, unitSystem),
            })
          }
          min={0}
          step={1}
          fallback={3}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">Počet průletů na list</Label>
        <NumericInput
          value={turbineParams.numPasses}
          onChange={(v) => onTurbineChange({ ...turbineParams, numPasses: v })}
          min={1}
          max={4}
          fallback={2}
          integer
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">Body na list</Label>
        <NumericInput
          value={turbineParams.numPointsPerBlade}
          onChange={(v) =>
            onTurbineChange({ ...turbineParams, numPointsPerBlade: v })
          }
          min={2}
          max={100}
          fallback={15}
          integer
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">
          Rychlost ({speedLabel(unitSystem)})
        </Label>
        <NumericInput
          value={toDisplaySpeed(turbineParams.speed, unitSystem)}
          onChange={(v) =>
            onTurbineChange({
              ...turbineParams,
              speed: fromDisplaySpeed(v, unitSystem),
            })
          }
          min={speedRange(unitSystem).min}
          max={speedRange(unitSystem).max}
          step={speedRange(unitSystem).step}
          fallback={3}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">Náklon gimbalu (°)</Label>
        <NumericInput
          value={turbineParams.gimbalPitchAngle}
          onChange={(v) =>
            onTurbineChange({ ...turbineParams, gimbalPitchAngle: v })
          }
          min={-90}
          max={45}
          step={5}
          fallback={0}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <CaptureModeToggle
          value={turbineParams.captureMode === "video" ? "video" : "photo"}
          onChange={(mode) =>
            onTurbineChange({ ...turbineParams, captureMode: mode })
          }
        />
      </div>
      <div className="flex items-end pb-1">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={turbineParams.createPoi}
            onChange={(e) =>
              onTurbineChange({
                ...turbineParams,
                createPoi: e.target.checked,
              })
            }
            className="rounded"
          />
          Vytvořit POI na rotoru
        </label>
      </div>
    </div>
  );
}
