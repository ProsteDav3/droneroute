import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { X, History, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface MissionVersionSummary {
  id: string;
  createdAt: string;
}

interface MissionVersionHistoryProps {
  missionId: string;
  missionName: string;
  onClose: () => void;
  /** Called after a successful restore so the caller can refresh its mission list/editor state. */
  onRestored: () => void;
}

/**
 * Version history panel for a single saved mission — lists the up-to-20
 * most recent snapshots (captured automatically on every save) and lets
 * the owner restore one. Restoring overwrites the mission's current
 * content but is itself recorded as a new version, so nothing is lost.
 */
export function MissionVersionHistory({
  missionId,
  missionName,
  onClose,
  onRestored,
}: MissionVersionHistoryProps) {
  const [versions, setVersions] = useState<MissionVersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<MissionVersionSummary[]>(
        `/missions/${missionId}/versions`,
      );
      setVersions(data);
    } catch (e: any) {
      setError(e.message || "Nepodařilo se načíst historii verzí");
    } finally {
      setLoading(false);
    }
  }, [missionId]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const handleRestore = async (versionId: string) => {
    if (!confirm("Obnovit misi na tuto verzi? Aktuální obsah bude přepsán."))
      return;
    setRestoringId(versionId);
    try {
      await api.post(`/missions/${missionId}/versions/${versionId}/restore`);
      toast.success("Mise byla obnovena na vybranou verzi");
      await fetchVersions();
      onRestored();
    } catch (e: any) {
      toast.error("Obnovení se nezdařilo: " + (e.message || "Neznámá chyba"));
    } finally {
      setRestoringId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleString("cs-CZ", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-lg w-full max-w-md mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold text-foreground truncate">
              Historie verzí — {missionName || "Trasa bez názvu"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-3 flex-1">
          {loading && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Načítání historie...
            </p>
          )}

          {!loading && error && (
            <p className="text-sm text-destructive py-6 text-center">{error}</p>
          )}

          {!loading && !error && versions.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Zatím žádná uložená verze
            </p>
          )}

          {!loading && !error && versions.length > 0 && (
            <ul className="space-y-1.5">
              {versions.map((version, i) => (
                <li
                  key={version.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <div className="text-sm text-foreground">
                    {formatDate(version.createdAt)}
                    {i === 0 && (
                      <span className="ml-2 text-[10px] text-emerald-400">
                        nejnovější
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-7 text-xs"
                    disabled={i === 0 || restoringId === version.id}
                    onClick={() => handleRestore(version.id)}
                  >
                    <RotateCcw className="h-3 w-3" />
                    {restoringId === version.id ? "Obnovování..." : "Obnovit"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
