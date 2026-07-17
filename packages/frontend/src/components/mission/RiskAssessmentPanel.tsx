import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMissionStore } from "@/store/missionStore";
import { api } from "@/lib/api";
import {
  MITIGATION_OPTIONS,
  RISK_CLASS_LABELS,
  type RiskClass,
} from "@/lib/preflightChecklist";

interface RiskAssessmentApi {
  groundRiskClass: RiskClass;
  airRiskClass: RiskClass;
  mitigations: string[];
  assessedAt: string;
}

/**
 * SORA-lite risk assessment questionnaire for the current (saved) mission —
 * ground/air risk class plus a mitigations checklist. Explicitly a
 * simplified planning aid, not an authoritative SORA submission; the field
 * set is kept modest on purpose.
 */
export function RiskAssessmentPanel() {
  const missionId = useMissionStore((s) => s.missionId);
  const [groundRiskClass, setGroundRiskClass] = useState<RiskClass>("low");
  const [airRiskClass, setAirRiskClass] = useState<RiskClass>("low");
  const [mitigations, setMitigations] = useState<Set<string>>(new Set());
  const [assessedAt, setAssessedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!missionId) return;
    setLoading(true);
    api
      .get<RiskAssessmentApi>(`/risk-assessments/${missionId}`)
      .then((data) => {
        setGroundRiskClass(data.groundRiskClass);
        setAirRiskClass(data.airRiskClass);
        setMitigations(new Set(data.mitigations));
        setAssessedAt(data.assessedAt);
      })
      .catch(() => {
        // No assessment yet — keep defaults.
      })
      .finally(() => setLoading(false));
  }, [missionId]);

  if (!missionId) {
    return (
      <div className="p-4 text-xs text-muted-foreground text-center">
        Uložte misi, abyste mohli vyplnit posouzení rizik.
      </div>
    );
  }

  const toggleMitigation = (value: string) => {
    setMitigations((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/risk-assessments/${missionId}`, {
        groundRiskClass,
        airRiskClass,
        mitigations: [...mitigations],
      });
      setAssessedAt(new Date().toISOString());
      toast.success("Posouzení rizik uloženo");
    } catch (err: any) {
      toast.error(`Uložení posouzení rizik selhalo: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-[10px] text-muted-foreground">
        Zjednodušený nástroj k orientaci (SORA-lite), nikoli oficiální SORA
        podání.
      </p>

      <div>
        <Label className="text-xs">
          Pozemní riziko (hustota obyvatel nad trasou letu)
        </Label>
        <Select
          value={groundRiskClass}
          onValueChange={(v) => setGroundRiskClass(v as RiskClass)}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(RISK_CLASS_LABELS) as RiskClass[]).map((k) => (
              <SelectItem key={k} value={k}>
                {RISK_CLASS_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">
          Vzdušné riziko (BVLOS/VLOS, maximální výška, blízkost řízeného
          prostoru)
        </Label>
        <Select
          value={airRiskClass}
          onValueChange={(v) => setAirRiskClass(v as RiskClass)}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(RISK_CLASS_LABELS) as RiskClass[]).map((k) => (
              <SelectItem key={k} value={k}>
                {RISK_CLASS_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">Opatření ke snížení rizika</Label>
        <div className="flex flex-col gap-1 mt-1">
          {MITIGATION_OPTIONS.map((m) => (
            <label
              key={m.value}
              className="flex items-center gap-2 text-xs cursor-pointer"
            >
              <input
                type="checkbox"
                checked={mitigations.has(m.value)}
                onChange={() => toggleMitigation(m.value)}
                className="h-3.5 w-3.5"
              />
              {m.label}
            </label>
          ))}
        </div>
      </div>

      <Button
        size="sm"
        onClick={handleSave}
        disabled={saving || loading}
        className="h-7 text-xs"
      >
        {saving ? "Ukládám..." : "Uložit posouzení rizik"}
      </Button>

      {assessedAt && (
        <p className="text-[10px] text-muted-foreground">
          Naposledy posouzeno: {new Date(assessedAt).toLocaleString("cs-CZ")}
        </p>
      )}
    </div>
  );
}
