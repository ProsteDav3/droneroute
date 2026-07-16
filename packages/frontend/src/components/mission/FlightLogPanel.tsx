import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plane, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMissionStore } from "@/store/missionStore";
import { api } from "@/lib/api";

interface FlightLog {
  id: string;
  missionId: string | null;
  flownAt: string;
  durationMinutes: number;
  notes: string | null;
  createdAt: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Simple flight logbook against the current (saved) mission — date,
 * duration, free-text notes. Deliberately modest: this is basic
 * record-keeping, not a full EU-compliant logbook with every regulatory
 * field (pilot license, drone registration, incident fields, etc.) — a
 * possible future enhancement.
 */
export function FlightLogPanel() {
  const missionId = useMissionStore((s) => s.missionId);
  const [logs, setLogs] = useState<FlightLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [flownAt, setFlownAt] = useState(todayIso());
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!missionId) {
      setLogs([]);
      return;
    }
    setLoading(true);
    api
      .get<FlightLog[]>(`/flight-logs?missionId=${missionId}`)
      .then(setLogs)
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, [missionId]);

  if (!missionId) {
    return (
      <div className="p-4 text-xs text-muted-foreground text-center">
        Uložte misi, abyste mohli evidovat lety.
      </div>
    );
  }

  const handleAdd = async () => {
    setSaving(true);
    try {
      const created = await api.post<{ id: string }>("/flight-logs", {
        missionId,
        flownAt,
        durationMinutes,
        notes: notes.trim() || undefined,
      });
      setLogs((prev) => [
        {
          id: created.id,
          missionId,
          flownAt,
          durationMinutes,
          notes: notes.trim() || null,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setNotes("");
    } catch (err: any) {
      toast.error(`Uložení letu selhalo: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/flight-logs/${id}`);
      setLogs((prev) => prev.filter((l) => l.id !== id));
    } catch (err: any) {
      toast.error(`Smazání záznamu selhalo: ${err.message}`);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Datum letu</Label>
          <Input
            type="date"
            value={flownAt}
            onChange={(e) => setFlownAt(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-xs">Doba letu (min)</Label>
          <Input
            type="number"
            min={0}
            step={0.5}
            value={durationMinutes}
            onChange={(e) =>
              setDurationMinutes(Math.max(0, parseFloat(e.target.value) || 0))
            }
            className="h-7 text-xs"
          />
        </div>
      </div>
      <div>
        <Label className="text-xs">Poznámka (volitelné)</Label>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Např. podmínky, incidenty, poznámky pro klienta"
          className="h-7 text-xs"
        />
      </div>
      <Button
        size="sm"
        onClick={handleAdd}
        disabled={saving}
        className="h-7 text-xs"
      >
        {saving ? "Ukládám..." : "Přidat záznam o letu"}
      </Button>

      <div className="flex flex-col gap-1 mt-1">
        {loading && <p className="text-xs text-muted-foreground">Načítám...</p>}
        {!loading && logs.length === 0 && (
          <div className="flex flex-col items-center justify-center p-4 text-center text-muted-foreground">
            <Plane className="h-6 w-6 mb-1 opacity-50" />
            <p className="text-xs">Zatím žádné evidované lety</p>
          </div>
        )}
        {logs.map((log) => (
          <div
            key={log.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 border border-transparent hover:bg-secondary"
          >
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium">
                {log.flownAt} — {log.durationMinutes} min
              </div>
              {log.notes && (
                <div className="text-[10px] text-muted-foreground truncate">
                  {log.notes}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => handleDelete(log.id)}
              title="Smazat záznam"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
