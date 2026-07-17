import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plane, AlertTriangle } from "lucide-react";
import { useConfigStore } from "@/store/configStore";
import { useDjiCloudOpsStore } from "@/store/djiCloudOpsStore";

const LS_KEY = "djiCloudOpsPanelOpen";

/** Fleet status: bound devices (online/offline) and recent HMS warnings from
 * the configured DJI Cloud platform. Only rendered when djiCloudEnabled. */
export function DjiCloudOpsPanel() {
  const djiCloudEnabled = useConfigStore((s) => s.djiCloudEnabled);
  const { devices, hmsMessages, loading, error, fetchDevicesAndHms } =
    useDjiCloudOpsStore();
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(LS_KEY) !== "false",
  );

  useEffect(() => {
    if (djiCloudEnabled) void fetchDevicesAndHms();
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
          {devices.map((device) => (
            <div
              key={device.device_sn}
              className="flex items-center gap-2 text-[11px]"
            >
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
            </div>
          ))}
          {hmsMessages.length > 0 && (
            <div className="pt-1 space-y-1 border-t border-border/50">
              {hmsMessages.slice(0, 5).map((msg, i) => (
                <div
                  key={`${msg.device_sn}-${msg.key}-${i}`}
                  className="flex items-start gap-1.5 text-[10px] text-amber-400"
                >
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                  <span className="break-words">{msg.key}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
