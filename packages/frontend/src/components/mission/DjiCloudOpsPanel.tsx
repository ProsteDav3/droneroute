import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plane, AlertTriangle } from "lucide-react";
import { useConfigStore } from "@/store/configStore";
import { useDjiCloudOpsStore } from "@/store/djiCloudOpsStore";
import { DjiMediaPanel } from "./DjiMediaPanel";
import { DjiLiveVideoPanel } from "./DjiLiveVideoPanel";
import { FlightTrackPanel } from "./FlightTrackPanel";

const LS_KEY = "djiCloudOpsPanelOpen";

/** Short "naposledy přihlášen před Xh/Xd" label from an ISO timestamp — the
 * platform's device-list endpoint doesn't expose a true last-flight time, so
 * this (`login_time`) is the closest honest proxy for device recency. */
function formatLastSeen(isoTime: string | undefined): string | null {
  if (!isoTime) return null;
  const then = new Date(isoTime).getTime();
  if (Number.isNaN(then)) return null;
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "právě teď";
  if (minutes < 60) return `před ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `před ${hours} h`;
  const days = Math.floor(hours / 24);
  return `před ${days} d`;
}

/** Fleet status: bound devices (online/offline) and recent HMS warnings from
 * the configured DJI Cloud platform. Only rendered when djiCloudEnabled. */
export function DjiCloudOpsPanel() {
  const djiCloudEnabled = useConfigStore((s) => s.djiCloudEnabled);
  const {
    devices,
    hmsMessages,
    telemetry,
    loading,
    error,
    fetchDevicesAndHms,
    focusedDeviceSn,
    setFocusedDeviceSn,
  } = useDjiCloudOpsStore();
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(LS_KEY) !== "false",
  );

  useEffect(() => {
    if (!djiCloudEnabled) return;
    void fetchDevicesAndHms();
    // A device that connects after this panel already mounted (the common
    // case — a pilot binds/powers on the RC well after opening SkyRoute)
    // would otherwise never show up without a full page reload, since the
    // fetch above only runs once.
    const interval = setInterval(() => void fetchDevicesAndHms(), 20_000);
    return () => clearInterval(interval);
  }, [djiCloudEnabled, fetchDevicesAndHms]);

  if (!djiCloudEnabled) return null;

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(LS_KEY, String(next));
      return next;
    });
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
        DJI Cloud — zařízení
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {loading && (
            <p className="text-[10px] text-muted-foreground">Načítám...</p>
          )}
          {error && <p className="text-[10px] text-red-400">{error}</p>}
          {!loading && !error && devices.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              Žádné zařízení není ve workspace připojeno
            </p>
          )}
          {devices.length > 1 && (
            <p className="text-[10px] text-muted-foreground">
              Více zařízení svázáno — klikněte na jedno pro sledování v průběhu
              mise a telemetrii.
            </p>
          )}
          {devices.map((device) => {
            const battery = telemetry[device.device_sn]?.batteryPercent;
            const lastSeen = formatLastSeen(device.login_time);
            const isFocused = focusedDeviceSn === device.device_sn;
            return (
              <button
                key={device.device_sn}
                type="button"
                onClick={() =>
                  setFocusedDeviceSn(isFocused ? null : device.device_sn)
                }
                disabled={devices.length < 2}
                className={`w-full text-left text-[11px] rounded px-1 py-0.5 -mx-1 transition-colors ${
                  devices.length < 2
                    ? ""
                    : isFocused
                      ? "bg-[#00c2ff]/10 ring-1 ring-[#00c2ff]/40"
                      : "hover:bg-muted"
                }`}
                title={
                  devices.length < 2
                    ? undefined
                    : isFocused
                      ? "Sledováno — kliknutím zrušíte"
                      : "Kliknutím sledovat toto zařízení"
                }
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 ${
                      device.status ? "bg-emerald-400" : "bg-zinc-600"
                    }`}
                    title={device.status ? "Online" : "Offline"}
                  />
                  <Plane className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="truncate">
                    {device.nickname || device.device_name || device.device_sn}
                  </span>
                  {typeof battery === "number" && (
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {battery}%
                    </span>
                  )}
                </div>
                {(device.device_model_key || lastSeen) && (
                  <p className="pl-4 text-[10px] text-muted-foreground truncate">
                    {[device.device_model_key, lastSeen]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </button>
            );
          })}
          {hmsMessages.length > 0 && (
            <div className="pt-1 space-y-1 border-t border-border/50">
              {hmsMessages.slice(0, 5).map((msg, i) => (
                <div
                  key={`${msg.sn}-${msg.key}-${i}`}
                  className="flex items-start gap-1.5 text-[10px] text-amber-400"
                >
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                  <span className="break-words">
                    {msg.message_en || msg.message_zh || msg.key}
                  </span>
                </div>
              ))}
            </div>
          )}
          <DjiMediaPanel />
          <DjiLiveVideoPanel />
          <FlightTrackPanel />
        </div>
      )}
    </div>
  );
}
