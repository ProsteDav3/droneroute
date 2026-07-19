import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DRONE_MODELS } from "@droneroute/shared";
import type { DroneModel } from "@droneroute/shared";

function droneKey(d: Pick<DroneModel, "droneEnumValue" | "droneSubEnumValue">) {
  return `${d.droneEnumValue}-${d.droneSubEnumValue}`;
}

interface NewMissionDroneDialogProps {
  /** `${droneEnumValue}-${droneSubEnumValue}` of the account's own default drone, pre-selected so confirming without changing anything still matches the usual choice. */
  defaultDroneKey: string;
  onConfirm: (model: DroneModel) => void;
  onCancel: () => void;
}

/**
 * Shown right when a new mission is created, before the editor opens — asks
 * which drone this specific mission will fly with instead of silently
 * inheriting the account-wide default. A mission's drone/camera selection is
 * saved with that mission alone (see `MissionConfig`) and never updates
 * retroactively if the account default changes later, so a pilot who flies
 * more than one drone model needs an explicit per-mission choice, not just
 * an account-level one — this is that choice, made once up front instead of
 * discovered later via a wrong field-of-view calculation (e.g. Orbit's
 * whole-object framing) deep in the mission.
 */
export function NewMissionDroneDialog({
  defaultDroneKey,
  onConfirm,
  onCancel,
}: NewMissionDroneDialogProps) {
  const [selectedKey, setSelectedKey] = useState(defaultDroneKey);

  const handleConfirm = () => {
    const model = DRONE_MODELS.find((d) => droneKey(d) === selectedKey);
    if (model) onConfirm(model);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onCancel}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-[0_0_60px_rgba(0,194,255,0.25)] w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold">Nová mise — model dronu</h2>
        </div>
        <div className="px-5 py-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            Vyberte dron, se kterým tuto misi poletíte — ovlivňuje výpočet
            zorného pole kamery (např. rámování celého objektu u orbitu) a
            hodnoty uložené při exportu.
          </p>
          <div>
            <Label className="text-xs">Model dronu</Label>
            <Select value={selectedKey} onValueChange={setSelectedKey}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DRONE_MODELS.map((d) => (
                  <SelectItem key={droneKey(d)} value={droneKey(d)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Zrušit
          </Button>
          <Button size="sm" onClick={handleConfirm}>
            Vytvořit misi
          </Button>
        </div>
      </div>
    </div>
  );
}
