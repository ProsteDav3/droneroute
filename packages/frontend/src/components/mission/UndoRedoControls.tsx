import { Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMissionHistory } from "@/store/missionDraft";

/** Floating undo/redo buttons — mirrors the Ctrl+Z / Ctrl+Shift+Z shortcuts. */
export function UndoRedoControls() {
  const { undo, redo, canUndo, canRedo } = useMissionHistory();

  return (
    <div className="absolute top-14 left-4 z-10 flex gap-1">
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8 bg-background/90 backdrop-blur-sm"
        disabled={!canUndo}
        onClick={undo}
        title="Zpět (Ctrl+Z)"
      >
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8 bg-background/90 backdrop-blur-sm"
        disabled={!canRedo}
        onClick={redo}
        title="Znovu (Ctrl+Shift+Z)"
      >
        <Redo2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
