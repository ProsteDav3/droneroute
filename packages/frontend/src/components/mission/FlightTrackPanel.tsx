import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Square,
  Route,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react";
import { useMissionStore } from "@/store/missionStore";
import { useDjiCloudOpsStore } from "@/store/djiCloudOpsStore";
import { useFlightTrackStore } from "@/store/flightTrackStore";

function formatSessionTime(iso: string): string {
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

/** Records a device's live GPS trace while flying (this fleet has no DJI
 * Dock, so there is no after-the-fact flight history to import — see
 * flightTrack.ts's doc comment) and lists past recordings for the current
 * mission, so a pilot can compare where they actually flew against the plan.
 * Only meaningful once a device is focused (see DjiCloudOpsPanel's device
 * picker) — recording targets whichever device is currently focused. */
export function FlightTrackPanel() {
  const missionId = useMissionStore((s) => s.missionId);
  const focusedDeviceSn = useDjiCloudOpsStore((s) => s.focusedDeviceSn);
  const devices = useDjiCloudOpsStore((s) => s.devices);
  const telemetry = useDjiCloudOpsStore((s) => s.telemetry);
  const {
    recordingDeviceSn,
    recordingStarting,
    recordingError,
    startRecording,
    stopRecording,
    sessions,
    sessionsLoading,
    sessionsError,
    fetchSessions,
    deleteSession,
    selectedSessionId,
    loadSessionPoints,
    clearSelectedSession,
  } = useFlightTrackStore();
  const [expanded, setExpanded] = useState(false);

  // A single bound device is implicitly "the" device even without an
  // explicit focus pick (matches MissionProgressPanel's own fallback).
  const targetDeviceSn =
    focusedDeviceSn ?? (devices.length === 1 ? devices[0].device_sn : null);
  const targetOnline = targetDeviceSn
    ? (telemetry[targetDeviceSn]?.online ?? false)
    : false;

  useEffect(() => {
    if (expanded && missionId && sessions.length === 0 && !sessionsLoading) {
      void fetchSessions(missionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, missionId]);

  useEffect(() => {
    return () => clearSelectedSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!missionId) return null;

  const isRecording = recordingDeviceSn === targetDeviceSn && !!targetDeviceSn;

  return (
    <div className="pt-1 border-t border-border/50">
      <button
        type="button"
        className="flex items-center gap-1.5 w-full text-[10px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-300 transition-colors py-1"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        Záznam letu{sessions.length > 0 ? ` (${sessions.length})` : ""}
      </button>
      {expanded && (
        <div className="space-y-1.5 pl-1">
          {!targetDeviceSn ? (
            <p className="text-[10px] text-muted-foreground">
              Vyberte zařízení výše pro nahrávání skutečné trasy letu.
            </p>
          ) : (
            <button
              type="button"
              onClick={() =>
                isRecording
                  ? void stopRecording()
                  : void startRecording(targetDeviceSn, missionId)
              }
              disabled={recordingStarting || (!isRecording && !targetOnline)}
              className={`flex items-center gap-1.5 w-full text-left text-[11px] rounded px-1 py-0.5 -mx-1 disabled:opacity-50 ${
                isRecording
                  ? "text-red-400 hover:bg-red-500/10"
                  : "hover:bg-muted"
              }`}
              title={
                !targetOnline && !isRecording
                  ? "Zařízení musí být online"
                  : undefined
              }
            >
              {isRecording ? (
                <Square className="h-3 w-3 fill-current" />
              ) : (
                <Circle className="h-3 w-3 text-red-400 fill-current" />
              )}
              {isRecording
                ? "Zastavit nahrávání"
                : recordingStarting
                  ? "Spouštím..."
                  : "Začít nahrávat let"}
            </button>
          )}
          {recordingError && (
            <p className="text-[10px] text-red-400">{recordingError}</p>
          )}

          {sessionsLoading && sessions.length === 0 && (
            <p className="text-[10px] text-muted-foreground">Načítám...</p>
          )}
          {sessionsError && (
            <p className="text-[10px] text-red-400">{sessionsError}</p>
          )}
          {!sessionsLoading && !sessionsError && sessions.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              Zatím žádné záznamy letu k této misi
            </p>
          )}
          {sessions.map((session) => {
            const selected = selectedSessionId === session.id;
            return (
              <div
                key={session.id}
                className="flex items-center gap-1.5 text-[11px]"
              >
                <Route className="h-3 w-3 text-amber-400 shrink-0" />
                <span className="truncate flex-1" title={session.deviceSn}>
                  {formatSessionTime(session.startedAt)}
                  {!session.endedAt && (
                    <span className="text-red-400"> · nahrává se</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    selected
                      ? clearSelectedSession()
                      : void loadSessionPoints(session.id)
                  }
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  title={
                    selected
                      ? "Skrýt z mapy"
                      : "Zobrazit skutečnou trasu na mapě"
                  }
                >
                  {selected ? (
                    <EyeOff className="h-3 w-3" />
                  ) : (
                    <Eye className="h-3 w-3" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void deleteSession(session.id, missionId)}
                  className="text-muted-foreground hover:text-red-400 shrink-0"
                  title="Smazat záznam"
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
