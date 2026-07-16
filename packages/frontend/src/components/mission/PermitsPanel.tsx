import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMissionStore } from "@/store/missionStore";
import { api } from "@/lib/api";

interface Permit {
  id: string;
  missionId: string;
  description: string;
  referenceOrUrl: string | null;
  expiryDate: string | null;
  issuedBy: string | null;
  createdAt: string;
}

const EXPIRY_WARNING_DAYS = 14;

function expiryStatus(
  expiryDate: string | null,
): "expired" | "soon" | "ok" | "none" {
  if (!expiryDate) return "none";
  const days = Math.floor(
    (new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  if (days < 0) return "expired";
  if (days <= EXPIRY_WARNING_DAYS) return "soon";
  return "ok";
}

/**
 * Tracking for authorization/coordination documents (permits, local
 * authority approvals, etc.) attached to the current (saved) mission.
 * Simple CRUD, same restraint as the flight logbook — not a document
 * management system, just enough to notice an expired/expiring permit.
 */
export function PermitsPanel() {
  const missionId = useMissionStore((s) => s.missionId);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [loading, setLoading] = useState(false);
  const [description, setDescription] = useState("");
  const [referenceOrUrl, setReferenceOrUrl] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [issuedBy, setIssuedBy] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!missionId) {
      setPermits([]);
      return;
    }
    setLoading(true);
    api
      .get<Permit[]>(`/permits?missionId=${missionId}`)
      .then(setPermits)
      .catch(() => setPermits([]))
      .finally(() => setLoading(false));
  }, [missionId]);

  if (!missionId) {
    return (
      <div className="p-4 text-xs text-muted-foreground text-center">
        Uložte misi, abyste mohli evidovat povolení.
      </div>
    );
  }

  const handleAdd = async () => {
    if (!description.trim()) {
      toast.warning("Zadejte popis povolení");
      return;
    }
    setSaving(true);
    try {
      const created = await api.post<{ id: string }>("/permits", {
        missionId,
        description: description.trim(),
        referenceOrUrl: referenceOrUrl.trim() || undefined,
        expiryDate: expiryDate || undefined,
        issuedBy: issuedBy.trim() || undefined,
      });
      setPermits((prev) => [
        {
          id: created.id,
          missionId,
          description: description.trim(),
          referenceOrUrl: referenceOrUrl.trim() || null,
          expiryDate: expiryDate || null,
          issuedBy: issuedBy.trim() || null,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setDescription("");
      setReferenceOrUrl("");
      setExpiryDate("");
      setIssuedBy("");
    } catch (err: any) {
      toast.error(`Uložení povolení selhalo: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/permits/${id}`);
      setPermits((prev) => prev.filter((p) => p.id !== id));
    } catch (err: any) {
      toast.error(`Smazání povolení selhalo: ${err.message}`);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <Label className="text-xs">Popis povolení</Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Např. koordinace s místním úřadem"
          className="h-7 text-xs"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Reference / odkaz (volitelné)</Label>
          <Input
            value={referenceOrUrl}
            onChange={(e) => setReferenceOrUrl(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-xs">Datum expirace (volitelné)</Label>
          <Input
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
      </div>
      <div>
        <Label className="text-xs">Vydavatel (volitelné)</Label>
        <Input
          value={issuedBy}
          onChange={(e) => setIssuedBy(e.target.value)}
          className="h-7 text-xs"
        />
      </div>
      <Button
        size="sm"
        onClick={handleAdd}
        disabled={saving}
        className="h-7 text-xs"
      >
        {saving ? "Ukládám..." : "Přidat povolení"}
      </Button>

      <div className="flex flex-col gap-1 mt-1">
        {loading && <p className="text-xs text-muted-foreground">Načítám...</p>}
        {!loading && permits.length === 0 && (
          <div className="flex flex-col items-center justify-center p-4 text-center text-muted-foreground">
            <FileCheck className="h-6 w-6 mb-1 opacity-50" />
            <p className="text-xs">Zatím žádná evidovaná povolení</p>
          </div>
        )}
        {permits.map((permit) => {
          const status = expiryStatus(permit.expiryDate);
          const statusColor =
            status === "expired"
              ? "text-red-400"
              : status === "soon"
                ? "text-orange-400"
                : "text-muted-foreground";
          return (
            <div
              key={permit.id}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 border border-transparent hover:bg-secondary"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">
                  {permit.description}
                </div>
                {permit.expiryDate && (
                  <div className={`text-[10px] ${statusColor}`}>
                    {status === "expired"
                      ? `Vypršelo ${permit.expiryDate}`
                      : status === "soon"
                        ? `Brzy vyprší (${permit.expiryDate})`
                        : `Platné do ${permit.expiryDate}`}
                  </div>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(permit.id)}
                title="Smazat povolení"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
