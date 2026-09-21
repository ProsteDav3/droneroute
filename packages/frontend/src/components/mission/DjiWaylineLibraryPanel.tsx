import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Pencil,
  Trash2,
} from "lucide-react";
import { useConfigStore } from "@/store/configStore";
import { useDjiCloudOpsStore } from "@/store/djiCloudOpsStore";
import { isSegmentWayline } from "@/lib/waylineNames";

const LS_KEY = "djiWaylineLibraryPanelOpen";

function formatDate(unixMs: number | undefined): string | null {
  if (!unixMs) return null;
  return new Date(unixMs).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

/** The library lists names with the `.kmz` extension (see djiCloudOpsStore's
 * `DjiWaylineSummary`), but that's not part of what someone means to type
 * when renaming — strip it for editing and let the backend re-append it
 * (`renameWayline`'s doc comment). */
function baseWaylineName(name: string): string {
  return name.replace(/\.kmz$/i, "");
}

/**
 * Lets you see and clean up the DJI Cloud workspace's wayline library
 * directly from SkyRoute, instead of only via DJI Pilot 2's own file
 * browser — mainly useful for clearing out old/duplicate missions so the
 * library doesn't silently accumulate clutter over time (uploads now
 * overwrite in place on a name match, but manually renamed or externally
 * created files still need manual cleanup here).
 */
export function DjiWaylineLibraryPanel() {
  const djiCloudEnabled = useConfigStore((s) => s.djiCloudEnabled);
  const {
    waylines,
    waylinesLoading,
    waylinesError,
    deletingWaylineId,
    renamingWaylineId,
    bulkWaylineDelete,
    fetchWaylines,
    deleteWaylineFromLibrary,
    renameWaylineInLibrary,
    deleteWaylinesInBulk,
  } = useDjiCloudOpsStore();
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(LS_KEY) === "true",
  );
  /** Which bulk delete is armed, if any. Clearing the whole library is not
   * something to do on one stray click, so the button only states the intent
   * and the count; a second, separate button actually does it. */
  const [armed, setArmed] = useState<"missions" | "segments" | null>(null);
  /** Which wayline's name is currently being edited inline (dvojklik or the
   * pencil button), same pattern as TemplatePresetList's `editingName`. */
  const [editingWaylineId, setEditingWaylineId] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  /** Escape unmounts the input while it still has focus, and the browser
   * then fires a blur that would commit the edit the user just cancelled.
   * This flag makes the cancel win. */
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (djiCloudEnabled && expanded) void fetchWaylines();
  }, [djiCloudEnabled, expanded, fetchWaylines]);

  if (!djiCloudEnabled) return null;

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(LS_KEY, String(next));
      return next;
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (!window.confirm(`Smazat "${name}" z DJI Cloud knihovny?`)) return;
    void deleteWaylineFromLibrary(id);
  };

  const startRename = (id: string) => {
    cancelledRef.current = false;
    setEditingWaylineId(id);
    setTimeout(() => nameInputRef.current?.select(), 0);
  };

  const commitRename = (id: string, value: string) => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    const trimmed = value.trim();
    setEditingWaylineId(null);
    if (!trimmed) {
      // Silently dropping the edit looks like the rename failed for no
      // reason, so say what happened — the original name is still there.
      toast.error("Název nesmí být prázdný");
      return;
    }
    void renameWaylineInLibrary(id, trimmed);
  };

  const cancelRename = () => {
    cancelledRef.current = true;
    setEditingWaylineId(null);
  };

  const segmentCount = waylines.filter((w) => isSegmentWayline(w.name)).length;
  const missionCount = waylines.length - segmentCount;
  const counts = { missions: missionCount, segments: segmentCount };
  const labels = { missions: "misí", segments: "segmentů" };

  const runBulkDelete = async (kind: "missions" | "segments") => {
    setArmed(null);
    const { deleted, failed } = await deleteWaylinesInBulk(kind);
    if (failed > 0) {
      toast.error(
        `Smazáno ${deleted} z ${deleted + failed} — ${failed} se nepodařilo smazat`,
      );
    } else if (deleted > 0) {
      toast.success(`Smazáno ${deleted} ${labels[kind]} z DJI Cloud`);
    }
  };

  return (
    <div className="border-t border-border bg-background/50">
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/40 transition-colors"
        onClick={toggleExpanded}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        DJI Cloud — wayline knihovna
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-1.5">
          {waylinesLoading && (
            <p className="text-[10px] text-muted-foreground">Načítám...</p>
          )}
          {waylinesError && (
            <p className="text-[10px] text-red-400">{waylinesError}</p>
          )}
          {!waylinesLoading && !waylinesError && waylines.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              Knihovna je prázdná
            </p>
          )}

          {bulkWaylineDelete && (
            <p className="text-[10px] text-amber-400">
              Mažu {bulkWaylineDelete.done} z {bulkWaylineDelete.total}{" "}
              {labels[bulkWaylineDelete.kind]}…
            </p>
          )}

          {!bulkWaylineDelete &&
            waylines.length > 0 &&
            (["missions", "segments"] as const).map((kind) =>
              counts[kind] === 0 ? null : armed === kind ? (
                <div key={kind} className="flex items-center gap-1.5">
                  <button
                    className="flex-1 h-6 rounded border border-red-500/60 bg-red-500/15 text-[10px] text-red-300 hover:bg-red-500/25 transition-colors"
                    onClick={() => void runBulkDelete(kind)}
                  >
                    Opravdu smazat {counts[kind]} {labels[kind]}
                  </button>
                  <button
                    className="h-6 px-2 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setArmed(null)}
                  >
                    Zrušit
                  </button>
                </div>
              ) : (
                <button
                  key={kind}
                  className="w-full h-6 rounded border border-border text-[10px] text-muted-foreground hover:text-red-400 hover:border-red-500/50 transition-colors"
                  onClick={() => setArmed(kind)}
                  title={
                    kind === "segments"
                      ? "Smaže z DJI Cloud všechny nahrané segmenty (názvy typu …-seg-3-of-71), celé mise zůstanou"
                      : "Smaže z DJI Cloud všechny celé mise, nahrané segmenty zůstanou"
                  }
                >
                  Smazat všechny {labels[kind]} ({counts[kind]})
                </button>
              ),
            )}
          {waylines.map((wl) => {
            const isRenaming = editingWaylineId === wl.id;
            const busy =
              deletingWaylineId === wl.id || renamingWaylineId === wl.id;
            return (
              <div key={wl.id} className="flex items-center gap-2 text-[11px]">
                <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  {isRenaming ? (
                    <input
                      ref={nameInputRef}
                      className="text-[11px] font-medium bg-transparent border-b border-indigo-400 outline-none w-full py-0"
                      defaultValue={baseWaylineName(wl.name)}
                      autoFocus
                      onBlur={(e) => commitRename(wl.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          commitRename(wl.id, e.currentTarget.value);
                        if (e.key === "Escape") cancelRename();
                      }}
                    />
                  ) : (
                    <span
                      className="truncate block cursor-text hover:text-indigo-300 transition-colors"
                      onDoubleClick={() => startRename(wl.id)}
                      title="Přejmenujte dvojklikem"
                    >
                      {wl.name}
                    </span>
                  )}
                  {formatDate(wl.update_time ?? wl.create_time) && (
                    <span className="text-[10px] text-muted-foreground">
                      {formatDate(wl.update_time ?? wl.create_time)}
                    </span>
                  )}
                </div>
                {!isRenaming && (
                  <button
                    className="shrink-0 text-muted-foreground hover:text-indigo-400 transition-colors disabled:opacity-40"
                    onClick={() => startRename(wl.id)}
                    disabled={busy}
                    title="Přejmenovat"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
                <button
                  className="shrink-0 text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-40"
                  onClick={() => handleDelete(wl.id, wl.name)}
                  disabled={busy || isRenaming}
                  title="Smazat z DJI Cloud"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
