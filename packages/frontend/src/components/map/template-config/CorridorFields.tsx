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
import { type CorridorParams } from "@/lib/templates";
import type { UnitSystem } from "@droneroute/shared";
import { CaptureModeToggle } from "./CaptureModeToggle";

interface CorridorFieldsProps {
  corridorParams: CorridorParams;
  onCorridorChange: (params: CorridorParams) => void;
  unitSystem: UnitSystem;
}

export function CorridorFields({
  corridorParams,
  onCorridorChange,
  unitSystem,
}: CorridorFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-2 mb-3">
      <div>
        <Label className="text-[10px]">Body trasy</Label>
        <NumericInput
          value={corridorParams.numPoints}
          onChange={(v) =>
            onCorridorChange({ ...corridorParams, numPoints: v })
          }
          min={2}
          max={200}
          fallback={20}
          integer
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">Výška ({heightLabel(unitSystem)})</Label>
        <NumericInput
          value={toDisplayHeight(corridorParams.altitude, unitSystem)}
          onChange={(v) =>
            onCorridorChange({
              ...corridorParams,
              altitude: fromDisplayHeight(v, unitSystem),
            })
          }
          min={5}
          step={5}
          fallback={40}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label
          className="text-[10px]"
          title="Boční vzdálenost mezi souběžnými průlety podél osy stavby."
        >
          Boční rozestup ({distanceLabel(unitSystem)})
        </Label>
        <NumericInput
          value={toDisplayDistance(corridorParams.offsetM, unitSystem)}
          onChange={(v) =>
            onCorridorChange({
              ...corridorParams,
              offsetM: fromDisplayDistance(v, unitSystem),
            })
          }
          min={1}
          step={1}
          fallback={10}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label
          className="text-[10px]"
          title="Kolik souběžných průletů podél osy stavby. Lichý počet zahrnuje průlet přesně po ose, sudý počet ji symetricky obklopí z obou stran."
        >
          Počet průletů
        </Label>
        <NumericInput
          value={corridorParams.numPasses}
          onChange={(v) =>
            onCorridorChange({ ...corridorParams, numPasses: v })
          }
          min={1}
          max={10}
          fallback={2}
          integer
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">
          Rychlost ({speedLabel(unitSystem)})
        </Label>
        <NumericInput
          value={toDisplaySpeed(corridorParams.speed, unitSystem)}
          onChange={(v) =>
            onCorridorChange({
              ...corridorParams,
              speed: fromDisplaySpeed(v, unitSystem),
            })
          }
          min={speedRange(unitSystem).min}
          max={speedRange(unitSystem).max}
          step={speedRange(unitSystem).step}
          fallback={5}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">Náklon gimbalu (°)</Label>
        <NumericInput
          value={corridorParams.gimbalPitchAngle}
          onChange={(v) =>
            onCorridorChange({ ...corridorParams, gimbalPitchAngle: v })
          }
          min={-90}
          max={45}
          step={5}
          fallback={-30}
          className="h-7 text-xs"
        />
      </div>
      <div>
        <CaptureModeToggle
          value={corridorParams.captureMode === "video" ? "video" : "photo"}
          onChange={(mode) =>
            onCorridorChange({ ...corridorParams, captureMode: mode })
          }
        />
      </div>
      <div className="flex items-end pb-1">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={corridorParams.reverse}
            onChange={(e) =>
              onCorridorChange({
                ...corridorParams,
                reverse: e.target.checked,
              })
            }
            className="rounded"
          />
          Obrátit směr
        </label>
      </div>
    </div>
  );
}
