import { useMemo } from "react";
import { Navigation2, Clock } from "lucide-react";
import { useMissionStore } from "@/store/missionStore";
import { useConfigStore } from "@/store/configStore";
import { useDjiCloudOpsStore } from "@/store/djiCloudOpsStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { computeMissionProgress } from "@/lib/missionProgress";
import { formatDistance } from "@/lib/units";

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours} h ${remMinutes} min`;
}

/**
 * Floating "flight in progress" readout — percent complete and ETA to the
 * final waypoint, derived by matching the live DJI Cloud telemetry position
 * against this mission's own flight path (see lib/missionProgress.ts).
 * Only renders while a device is actually online and reporting a position;
 * silent otherwise so it doesn't clutter the map when nothing is flying.
 */
export function MissionProgressPanel() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const djiCloudEnabled = useConfigStore((s) => s.djiCloudEnabled);
  const telemetry = useDjiCloudOpsStore((s) => s.telemetry);
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);

  const progress = useMemo(() => {
    if (!djiCloudEnabled) return null;
    const flying = Object.values(telemetry).find(
      (d) =>
        d.online &&
        typeof d.latitude === "number" &&
        typeof d.longitude === "number",
    );
    if (!flying) return null;
    return computeMissionProgress(
      waypoints,
      { lat: flying.latitude!, lng: flying.longitude! },
      flying.horizontalSpeed,
    );
  }, [djiCloudEnabled, telemetry, waypoints]);

  if (!progress) return null;

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 rounded-lg bg-background/95 border border-border shadow-lg px-3 py-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <Navigation2 className="h-3.5 w-3.5 text-[#00c2ff]" />
        Průběh mise: {Math.round(progress.percentComplete)} %
      </div>
      <div className="h-3 w-px bg-border" />
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        {progress.etaSeconds !== null
          ? `ETA ${formatEta(progress.etaSeconds)}`
          : "ETA neznámá"}
      </div>
      {progress.distanceRemainingM > 0 && (
        <div className="text-xs text-muted-foreground">
          zbývá {formatDistance(progress.distanceRemainingM, unitSystem)}
        </div>
      )}
    </div>
  );
}
