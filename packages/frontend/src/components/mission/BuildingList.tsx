import { useState, useRef } from "react";
import { Warehouse, X, Settings, Orbit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { useMissionStore } from "@/store/missionStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { polygonArea, formatArea } from "@/lib/geo";
import { orbitParamsForBuilding } from "@/lib/templates";
import { heightLabel, toDisplayHeight, fromDisplayHeight } from "@/lib/units";

export function BuildingList() {
  const {
    buildings,
    selectedBuildingId,
    selectBuilding,
    removeBuilding,
    updateBuilding,
    setPendingOrbitParams,
  } = useMissionStore();
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [expandedEditor, setExpandedEditor] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  if (buildings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
        <Warehouse className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">No buildings yet</p>
        <p className="text-xs mt-1">
          Use the "Building" button to draw a footprint
        </p>
      </div>
    );
  }

  const startRename = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingName(id);
    setTimeout(() => nameInputRef.current?.select(), 0);
  };

  const commitRename = (id: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed) {
      updateBuilding(id, { name: trimmed });
    }
    setEditingName(null);
  };

  const toggleEditor = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedEditor((prev) => (prev === id ? null : id));
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      {buildings.map((building) => {
        const isSelected = selectedBuildingId === building.id;
        const isRenaming = editingName === building.id;
        const isEditorOpen = expandedEditor === building.id;

        return (
          <div key={building.id}>
            <div
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors ${
                isSelected
                  ? "bg-blue-500/20 border border-blue-500/40"
                  : "hover:bg-secondary border border-transparent"
              }`}
              onClick={() => selectBuilding(isSelected ? null : building.id)}
            >
              <Warehouse className="h-3 w-3 text-blue-400 shrink-0" />
              <div className="flex-1 min-w-0">
                {isRenaming ? (
                  <input
                    ref={nameInputRef}
                    className="text-xs font-medium bg-transparent border-b border-blue-400 outline-none w-full py-0"
                    defaultValue={building.name}
                    autoFocus
                    onBlur={(e) => commitRename(building.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        commitRename(building.id, e.currentTarget.value);
                      if (e.key === "Escape") setEditingName(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <div
                    className="text-xs font-medium truncate cursor-text hover:text-blue-300 transition-colors"
                    onDoubleClick={(e) => startRename(building.id, e)}
                    title="Double-click to rename"
                  >
                    {building.name}
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground">
                  H: {toDisplayHeight(building.height, unitSystem)}
                  {heightLabel(unitSystem)} &middot;{" "}
                  {formatArea(polygonArea(building.vertices), unitSystem)}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 text-muted-foreground hover:text-blue-400"
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingOrbitParams(orbitParamsForBuilding(building));
                }}
                title="Create an orbit around this building, with radius, altitude, and gimbal pitch pre-filled"
              >
                <Orbit className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={`h-5 w-5 shrink-0 ${
                  isEditorOpen
                    ? "text-blue-400 hover:text-blue-400"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={(e) => toggleEditor(building.id, e)}
                title="Edit building settings"
              >
                <Settings className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  removeBuilding(building.id);
                }}
                title="Remove building"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>

            {isEditorOpen && (
              <div className="ml-4 mr-1 mt-1 mb-2 border-l-2 border-blue-400/30 bg-blue-500/5 rounded-r-md p-3 space-y-2">
                <div>
                  <Label
                    className="text-xs"
                    title="Real height of the building, above ground — used to recommend an orbit altitude, radius, and gimbal pitch when a POI is placed on it."
                  >
                    Height ({heightLabel(unitSystem)})
                  </Label>
                  <NumericInput
                    value={toDisplayHeight(building.height, unitSystem)}
                    onChange={(v) =>
                      updateBuilding(building.id, {
                        height: fromDisplayHeight(v, unitSystem),
                      })
                    }
                    min={1}
                    step={1}
                    fallback={20}
                    className="h-7 text-xs"
                  />
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {building.vertices.length} vertices &middot; Right-click a
                  vertex on the map to remove it
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
