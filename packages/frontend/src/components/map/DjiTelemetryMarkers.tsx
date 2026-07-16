import { useEffect } from "react";
import { Marker } from "react-map-gl/mapbox";
import { Plane } from "lucide-react";
import { useConfigStore } from "@/store/configStore";
import { useDjiCloudOpsStore } from "@/store/djiCloudOpsStore";

/**
 * Renders a live marker for every online DJI Cloud device reporting a
 * position — this is what makes a "Cloud" mission actually show something
 * happening on the map, instead of just a file transfer confirmation.
 * Self-contained: only mounts the SSE subscription while djiCloudEnabled,
 * and unsubscribes on unmount.
 */
export function DjiTelemetryMarkers() {
  const djiCloudEnabled = useConfigStore((s) => s.djiCloudEnabled);
  const telemetry = useDjiCloudOpsStore((s) => s.telemetry);
  const startTelemetryStream = useDjiCloudOpsStore(
    (s) => s.startTelemetryStream,
  );

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
          rotation={device.attitudeHead ?? 0}
          rotationAlignment="map"
        >
          <div
            className="flex items-center justify-center h-8 w-8 rounded-full bg-[#00c2ff] border-2 border-white shadow-lg"
            title={`${device.deviceSn}${device.batteryPercent ? ` — ${device.batteryPercent}%` : ""}`}
          >
            <Plane className="h-4 w-4 text-white" />
          </div>
        </Marker>
      ))}
    </>
  );
}
