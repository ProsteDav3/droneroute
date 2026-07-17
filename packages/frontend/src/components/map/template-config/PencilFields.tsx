import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  heightLabel,
  speedLabel,
  toDisplayHeight,
  fromDisplayHeight,
  toDisplaySpeed,
  fromDisplaySpeed,
  speedRange,
} from "@/lib/units";
import { type PencilParams } from "@/lib/templates";
import type { PointOfInterest, UnitSystem } from "@droneroute/shared";
import { CaptureModeToggle } from "./CaptureModeToggle";

interface PencilFieldsProps {
  pencilParams: PencilParams;
  onPencilChange: (params: PencilParams) => void;
  unitSystem: UnitSystem;
  pois?: PointOfInterest[];
}

export function PencilFields({
  pencilParams,
  onPencilChange,
  unitSystem,
  pois,
}: PencilFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-2 mb-3">
      <div>
        <Label className="text-[10px]">Body trasy</Label>
        <NumericInput
          value={pencilParams.numPoints}
          onChange={(v) => onPencilChange({ ...pencilParams, numPoints: v })}
          min={2}
          max={200}
          fallback={10}
          integer
          className="h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px]">Výška ({heightLabel(unitSystem)})</Label>
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
          Rychlost ({speedLabel(unitSystem)})
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
        <Label className="text-[10px]">Náklon gimbalu (°)</Label>
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
          Obrátit směr
        </label>
      </div>
      <div>
        <CaptureModeToggle
          value={pencilParams.captureMode === "video" ? "video" : "photo"}
          onChange={(mode) =>
            onPencilChange({ ...pencilParams, captureMode: mode })
          }
        />
      </div>
      {pois && pois.length > 0 && (
        <div>
          <Label className="text-[10px]">Mířit na POI</Label>
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
              <SelectItem value="none">Žádný (sledovat trasu)</SelectItem>
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
  );
}
