import { useEffect } from "react";
import { Marker } from "react-map-gl/mapbox";
import { Plane, BatteryFull, BatteryLow, BatteryWarning } from "lucide-react";
import { useConfigStore } from "@/store/configStore";
import { useDjiCloudOpsStore } from "@/store/djiCloudOpsStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { formatHeight, formatSpeed } from "@/lib/units";

function BatteryIcon({ percent }: { percent: number }) {
  if (percent <= 15) return <BatteryWarning className="h-3 w-3 text-red-400" />;
  if (percent <= 35) return <BatteryLow className="h-3 w-3 text-amber-400" />;
  return <BatteryFull className="h-3 w-3 text-emerald-400" />;
}

/**
 * Renders a live marker for every online DJI Cloud device reporting a
 * position — this is what makes a "Cloud" mission actually show something
 * happening on the map, instead of just a file transfer confirmation.
 * Self-contained: only mounts the SSE subscription while djiCloudEnabled,
 * and unsubscribes on unmount.
 *
 * Below the aircraft icon, a small readout shows altitude, horizontal
 * speed, and battery — the actual point of "live telemetry" beyond just a
 * moving dot. The icon rotates to the reported heading; the readout label
 * deliberately does NOT (it's applied to an inner element, not the
 * Marker's own `rotation`), so the text stays upright and legible.
 */
export function DjiTelemetryMarkers() {
  const djiCloudEnabled = useConfigStore((s) => s.djiCloudEnabled);
  const telemetry = useDjiCloudOpsStore((s) => s.telemetry);
  const startTelemetryStream = useDjiCloudOpsStore(
    (s) => s.startTelemetryStream,
  );
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);

  useEffect(() => {
    if (!djiCloudEnabled) return;
    const stop = startTelemetryStream();
    return stop;
  }, [djiCloudEnabled, startTelemetryStream]);

  if (!djiCloudEnabled) return null;

  const devices = Object.values(telemetry).filter(
    (d) =>
      d.online &&
      typeof d.latitude === "number" &&
      typeof d.longitude === "number",
  );

  return (
    <>
      {devices.map((device) => (
        <Marker
          key={device.deviceSn}
          longitude={device.longitude!}
          latitude={device.latitude!}
        >
          <div className="flex flex-col items-center gap-1">
            <div
              className="flex items-center justify-center h-8 w-8 rounded-full bg-[#00c2ff] border-2 border-white shadow-lg"
              style={{ transform: `rotate(${device.attitudeHead ?? 0}deg)` }}
              title={device.deviceSn}
            >
              <Plane className="h-4 w-4 text-white" />
            </div>
            <div className="flex items-center gap-1.5 rounded bg-background/90 border border-border px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow whitespace-nowrap">
              {typeof device.height === "number" && (
                <span>{formatHeight(device.height, unitSystem)}</span>
              )}
              {typeof device.horizontalSpeed === "number" && (
                <span>{formatSpeed(device.horizontalSpeed, unitSystem)}</span>
              )}
              {typeof device.batteryPercent === "number" && (
                <span className="flex items-center gap-0.5">
                  <BatteryIcon percent={device.batteryPercent} />
                  {device.batteryPercent}%
                </span>
              )}
            </div>
          </div>
        </Marker>
      ))}
    </>
  );
}
