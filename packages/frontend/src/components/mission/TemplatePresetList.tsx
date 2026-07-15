import { useState, useRef } from "react";
import { Bookmark, X, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMissionStore } from "@/store/missionStore";
import { useTemplatePresetsStore } from "@/store/templatePresetsStore";
import type { TemplateType, TemplateParams } from "@/lib/templates";

const TYPE_LABELS: Record<string, string> = {
  orbit: "Orbit",
  grid: "Mřížkový průzkum",
  facade: "Sken fasády",
  pencil: "Volná křivka",
  solar: "Solární panelový průzkum",
  corridor: "Liniová stavba",
};

export function TemplatePresetList() {
  const { presets, renamePreset, removePreset } = useTemplatePresetsStore();
  const setPendingPresetLoad = useMissionStore((s) => s.setPendingPresetLoad);
  const [editingName, setEditingName] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  if (presets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
        <Bookmark className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">Zatím žádné uložené šablony</p>
        <p className="text-xs mt-1">
          Nastavte šablonu a klikněte na "Uložit jako šablonu" pro pozdější
          použití
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
      renamePreset(id, trimmed);
    }
    setEditingName(null);
  };

  return (
    <div className="flex flex-col gap-1 p-2">
      {presets.map((preset) => {
        const isRenaming = editingName === preset.id;
        return (
          <div
            key={preset.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors hover:bg-secondary border border-transparent"
            onClick={() =>
              setPendingPresetLoad({
                type: preset.type as TemplateType,
                params: preset.params as unknown as TemplateParams,
              })
            }
            title="Kliknutím načtete tuto šablonu"
          >
            <Bookmark className="h-3 w-3 text-indigo-400 shrink-0" />
            <div className="flex-1 min-w-0">
              {isRenaming ? (
                <input
                  ref={nameInputRef}
                  className="text-xs font-medium bg-transparent border-b border-indigo-400 outline-none w-full py-0"
                  defaultValue={preset.name}
                  autoFocus
                  onBlur={(e) => commitRename(preset.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      commitRename(preset.id, e.currentTarget.value);
                    if (e.key === "Escape") setEditingName(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <div
                  className="text-xs font-medium truncate cursor-text hover:text-indigo-300 transition-colors"
                  onDoubleClick={(e) => startRename(preset.id, e)}
                  title="Přejmenujte dvojklikem"
                >
                  {preset.name}
                </div>
              )}
              <div className="text-[10px] text-muted-foreground">
                {TYPE_LABELS[preset.type] ?? preset.type}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 text-muted-foreground hover:text-indigo-400"
              onClick={(e) => {
                e.stopPropagation();
                setPendingPresetLoad({
                  type: preset.type as TemplateType,
                  params: preset.params as unknown as TemplateParams,
                });
              }}
              title="Načíst tuto šablonu"
            >
              <FolderOpen className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                removePreset(preset.id);
              }}
              title="Smazat šablonu"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
