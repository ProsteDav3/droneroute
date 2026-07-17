import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plane, AlertTriangle } from "lucide-react";
import { useConfigStore } from "@/store/configStore";
import {
  useDjiCloudOpsStore,
  findPairedGatewaySn,
  type DeviceTelemetry,
  type DjiHmsMessage,
} from "@/store/djiCloudOpsStore";
import { usePreferencesStore } from "@/store/preferencesStore";
import { formatDistance, formatHeight } from "@/lib/units";
import { DjiMediaPanel } from "./DjiMediaPanel";
import { DjiLiveVideoPanel } from "./DjiLiveVideoPanel";
import { FlightTrackPanel } from "./FlightTrackPanel";

const LS_KEY = "djiCloudOpsPanelOpen";

/** Some platform responses store the literal string "undefined" (a client
 * that stringified a missing value before sending it) instead of actually
 * omitting the field — treat that the same as not having a value at all. */
function realValue(value: string | undefined | null): string | undefined {
  return value && value !== "undefined" ? value : undefined;
}

/** Short "před Xh/Xd" relative-time label from an ISO or DJI-formatted
 * ("2026-07-16 16:56:51") timestamp string. Used both for a device's last
 * login and an HMS warning's own timestamp — the platform's HMS history
 * keeps every warning ever recorded with no "resolved" concept, so without
 * this a code that fired once hours ago (e.g. during a cold-battery
 * self-test) reads exactly like it's happening right now. */
function formatRelativeTime(timeStr: string | undefined): string | null {
  if (!timeStr) return null;
  const then = new Date(timeStr).getTime();
  if (Number.isNaN(then)) return null;
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "právě teď";
  if (minutes < 60) return `před ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `před ${hours} h`;
  const days = Math.floor(hours / 24);
  return `před ${days} d`;
}

/** Formats a signed speed with one decimal, e.g. "+1.2 m/s" for climbing,
 * "-0.4 m/s" for descending — the sign carries real information here that
 * a plain magnitude would lose. */
function formatSignedSpeed(ms: number): string {
  const sign = ms > 0 ? "+" : "";
  return `${sign}${ms.toFixed(1)} m/s`;
}

/** Collapses immediately-repeated identical warnings (same device + code)
 * into a single entry. The platform's redis-backed dedup only suppresses a
 * re-insert while its own key is still fresh, so the same code re-appears
 * as a "new" row once that expires even though it's the same ongoing
 * condition — this keeps the panel from showing "Loading dynamic safety
 * database failed" twice in a row for what is, from a pilot's point of
 * view, one continuing issue. */
function dedupeConsecutiveHms(messages: DjiHmsMessage[]): DjiHmsMessage[] {
  const result: DjiHmsMessage[] = [];
  for (const msg of messages) {
    const prev = result[result.length - 1];
    if (prev && prev.sn === msg.sn && prev.key === msg.key) continue;
    result.push(msg);
  }
  return result;
}

/** Live HUD readout for one aircraft — signal, battery, altitude, distance
 * from home, climb/flight speed, and wind, mirroring the fields DJI
 * Pilot's own flight screen shows. Pulls straight from the store's
 * SSE-fed `telemetry` map, so every field updates in real time as new OSD
 * messages arrive — no polling or manual refresh involved. */
function DeviceTelemetryHud({
  telemetry,
  signalQuality,
}: {
  telemetry: DeviceTelemetry;
  signalQuality: number | undefined;
}) {
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);

  const batteryLabel =
    telemetry.batteryPercents && telemetry.batteryPercents.length > 1
      ? telemetry.batteryPercents.map((p) => `${p} %`).join(" / ")
      : typeof telemetry.batteryPercent === "number"
        ? `${telemetry.batteryPercent} %`
        : "—";

  const rows: [string, string][] = [
    ["Signál", typeof signalQuality === "number" ? `${signalQuality}/5` : "—"],
    ["Baterie", batteryLabel],
    [
      "ASL",
      typeof telemetry.elevation === "number"
        ? formatHeight(telemetry.elevation, unitSystem)
        : "—",
    ],
    [
      "ALT",
      typeof telemetry.height === "number"
        ? formatHeight(telemetry.height, unitSystem)
        : "—",
    ],
    [
      "Vzdálenost od domova",
      typeof telemetry.homeDistance === "number"
        ? formatDistance(telemetry.homeDistance, unitSystem)
        : "—",
    ],
    [
      "Rychlost stoupání",
      typeof telemetry.verticalSpeed === "number"
        ? formatSignedSpeed(telemetry.verticalSpeed)
        : "—",
    ],
    [
      "Rychlost letu",
      typeof telemetry.horizontalSpeed === "number"
        ? `${telemetry.horizontalSpeed.toFixed(1)} m/s`
        : "—",
    ],
    [
      "Vítr",
      typeof telemetry.windSpeed === "number"
        ? `${telemetry.windSpeed.toFixed(1)} m/s`
        : "—",
    ],
  ];

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 pl-4 pt-1 text-[10px]">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-2">
          <span className="text-muted-foreground">{label}</span>
          <span className="tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  );
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
            const deviceTelemetry = telemetry[device.device_sn];
            const battery = deviceTelemetry?.batteryPercent;
            const lastSeen = formatRelativeTime(device.login_time);
            const isFocused = focusedDeviceSn === device.device_sn;
            // domain 0 = aircraft — RC/dock entries (domain 2/3) report
            // their own OSD, not the aircraft's, so a HUD full of dashes
            // for them isn't useful. Devices from platforms that don't
            // populate `domain` still get the HUD (better to show it than
            // hide a working feature over a missing field).
            const isAircraft =
              device.domain === undefined || device.domain === 0;
            const showHud =
              isAircraft &&
              !!deviceTelemetry &&
              (devices.length < 2 || isFocused);
            const gatewaySn = showHud
              ? findPairedGatewaySn(devices, device.device_sn)
              : null;
            const signalQuality = gatewaySn
              ? telemetry[gatewaySn]?.signalQuality
              : undefined;
            return (
              <div key={device.device_sn}>
                <button
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
                      {realValue(device.nickname) ??
                        realValue(device.device_name) ??
                        device.device_sn}
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
                {showHud && deviceTelemetry && (
                  <DeviceTelemetryHud
                    telemetry={deviceTelemetry}
                    signalQuality={signalQuality}
                  />
                )}
              </div>
            );
          })}
          {hmsMessages.length > 0 && (
            <div className="pt-1 space-y-1 border-t border-border/50">
              {dedupeConsecutiveHms(hmsMessages)
                .slice(0, 5)
                .map((msg, i) => {
                  const relativeTime = formatRelativeTime(msg.create_time);
                  return (
                    <div
                      key={`${msg.sn}-${msg.key}-${i}`}
                      className="flex items-start gap-1.5 text-[10px] text-amber-400"
                    >
                      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                      <span className="break-words">
                        {msg.message_en || msg.message_zh || msg.key}
                        {relativeTime && (
                          <span className="text-amber-400/60">
                            {" "}
                            · {relativeTime}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
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
