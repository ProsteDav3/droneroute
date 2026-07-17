import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Trash2 } from "lucide-react";
import { useConfigStore } from "@/store/configStore";
import { useDjiCloudOpsStore } from "@/store/djiCloudOpsStore";

const LS_KEY = "djiWaylineLibraryPanelOpen";

function formatDate(unixMs: number | undefined): string | null {
  if (!unixMs) return null;
  return new Date(unixMs).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
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
    fetchWaylines,
    deleteWaylineFromLibrary,
  } = useDjiCloudOpsStore();
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(LS_KEY) === "true",
  );

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
          {waylines.map((wl) => (
            <div key={wl.id} className="flex items-center gap-2 text-[11px]">
              <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="truncate block">{wl.name}</span>
                {formatDate(wl.update_time ?? wl.create_time) && (
                  <span className="text-[10px] text-muted-foreground">
                    {formatDate(wl.update_time ?? wl.create_time)}
                  </span>
                )}
              </div>
              <button
                className="shrink-0 text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-40"
                onClick={() => handleDelete(wl.id, wl.name)}
                disabled={deletingWaylineId === wl.id}
                title="Smazat z DJI Cloud"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
