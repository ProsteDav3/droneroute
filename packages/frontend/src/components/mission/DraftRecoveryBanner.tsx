import { useState } from "react";
import { FileClock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  peekMissionDraft,
  restoreMissionDraft,
  clearMissionDraft,
  useMissionStore,
} from "@/store/missionStore";

function formatSavedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("cs-CZ", {
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * Shown once at app start if an autosaved draft exists and the editor is
 * still in its pristine empty state (i.e. the user hasn't already loaded or
 * started a mission this session) — offers to recover unsaved edits from a
 * crashed tab/browser, or discard them.
 */
export function DraftRecoveryBanner() {
  const [draft] = useState(() => {
    const pending = peekMissionDraft();
    if (!pending) return null;
    const current = useMissionStore.getState();
    const isPristine =
      current.waypoints.length === 0 &&
      current.pois.length === 0 &&
      current.obstacles.length === 0 &&
      current.buildings.length === 0 &&
      !current.dirty;
    return isPristine ? pending : null;
  });
  const [dismissed, setDismissed] = useState(false);

  if (!draft || dismissed) return null;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 rounded-md border border-[#00c2ff]/30 bg-background/95 backdrop-blur-sm px-3 py-2 text-xs shadow-lg max-w-md">
      <FileClock className="h-4 w-4 shrink-0 text-[#33cfff]" />
      <span className="text-muted-foreground">
        Nalezen neuložený koncept mise{" "}
        <span className="text-foreground font-medium">{draft.missionName}</span>{" "}
        z {formatSavedAt(draft.savedAt)}.
      </span>
      <div className="flex gap-1.5 shrink-0">
        <Button
          size="sm"
          className="h-6 text-[11px] px-2"
          onClick={() => {
            restoreMissionDraft(draft);
            setDismissed(true);
          }}
        >
          Obnovit
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[11px] px-2"
          onClick={() => {
            clearMissionDraft();
            setDismissed(true);
          }}
        >
          Zahodit
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setDismissed(true)}
          title="Zavřít (koncept zůstane uložen)"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
