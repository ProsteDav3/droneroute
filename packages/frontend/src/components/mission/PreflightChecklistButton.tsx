import { useState } from "react";
import { toast } from "sonner";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMissionStore } from "@/store/missionStore";
import { useAirspaceStore } from "@/store/airspaceStore";
import { useWeatherStore } from "@/store/weatherStore";
import { getObstacleWarnings, getAirspaceWarnings } from "@/lib/geo";
import { estimateFlightStats } from "@/lib/flightStats";
import { computeWeatherGoNoGo } from "@/lib/preflightChecklist";
import { api } from "@/lib/api";
import type {
  PreflightPermit,
  PreflightRiskAssessment,
} from "@/lib/preflightChecklistPdf";

/**
 * Self-contained "download preflight checklist" button. Not wired into
 * App.tsx's toolbar (out of scope for this branch — see the PR notes for
 * the one-line addition that would drop it in next to the existing
 * "Stáhnout PDF report" button). Gathers airspace conflicts, mission
 * validation warnings, weather go/no-go, and SORA-lite risk/permit status
 * straight from the relevant stores/API so it works as a drop-in without
 * needing extra props threaded through App.tsx.
 */
export function PreflightChecklistButton() {
  const [generating, setGenerating] = useState(false);
  const missionName = useMissionStore((s) => s.missionName);
  const missionId = useMissionStore((s) => s.missionId);
  const config = useMissionStore((s) => s.config);
  const waypoints = useMissionStore((s) => s.waypoints);
  const obstacles = useMissionStore((s) => s.obstacles);
  const airspaceZones = useAirspaceStore((s) => s.zones);
  const airspaceEnabled = useAirspaceStore((s) => s.enabled);
  const weatherForecast = useWeatherStore((s) => s.forecast);

  const handleDownload = async () => {
    if (waypoints.length < 2) {
      toast.warning("Pro kontrolní seznam je potřeba alespoň 2 body trasy");
      return;
    }

    setGenerating(true);
    try {
      const obstacleWarnings = getObstacleWarnings(waypoints, obstacles);
      const airspaceWarnings = airspaceEnabled
        ? getAirspaceWarnings(waypoints, airspaceZones)
        : [];
      const { timeS } = estimateFlightStats(waypoints, config.autoFlightSpeed);
      const batteryExceeded = timeS > config.maxBatteryMinutes * 60;

      // Nearest available forecast entry — a simple "first slot" pick; a
      // more precise "closest to planned flight time" lookup is left to the
      // weather epic if it wants to refine this later.
      const weather = computeWeatherGoNoGo(weatherForecast[0] ?? null);

      let riskAssessment: PreflightRiskAssessment | null = null;
      let permits: PreflightPermit[] = [];
      if (missionId) {
        riskAssessment = await api
          .get<PreflightRiskAssessment>(`/risk-assessments/${missionId}`)
          .catch(() => null);
        permits = await api
          .get<PreflightPermit[]>(`/permits?missionId=${missionId}`)
          .catch(() => []);
      }

      // Dynamically imported for the same reason as the existing mission
      // report: jsPDF + jspdf-autotable are excluded from the main bundle.
      const { generatePreflightChecklistPdf } =
        await import("@/lib/preflightChecklistPdf");
      const doc = generatePreflightChecklistPdf({
        missionName,
        obstacleWarnings,
        airspaceWarnings,
        batteryExceeded,
        flightTimeS: timeS,
        maxBatteryMinutes: config.maxBatteryMinutes,
        weather,
        riskAssessment,
        permits,
      });
      doc.save(`${missionName.replace(/[^a-zA-Z0-9_-]/g, "_")}-checklist.pdf`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Vytvoření kontrolního seznamu selhalo: ${message}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={generating || waypoints.length < 2}
      className="w-full text-xs h-7 border-[#00c2ff]/30 bg-[#00c2ff]/5 hover:bg-[#00c2ff]/15 hover:text-[#33cfff]"
      title={
        waypoints.length < 2
          ? "Pro kontrolní seznam přidejte alespoň 2 body trasy"
          : "Stáhnout předletovou kontrolu (vzdušný prostor, počasí, rizika, povolení)"
      }
    >
      <ClipboardCheck className="h-3 w-3" />
      {generating ? "..." : "Předletová kontrola"}
    </Button>
  );
}
