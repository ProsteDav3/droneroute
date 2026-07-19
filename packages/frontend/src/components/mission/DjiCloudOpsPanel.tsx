import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plane,
  Gamepad2,
  Box,
  AlertTriangle,
} from "lucide-react";
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

/** A domain-2 (RC/gateway) device with no platform-reported nickname or
 * device_name is, in practice, almost always a tablet/phone running the DJI
 * Pilot 2 app as the cloud gateway rather than a dedicated RC unit — a real
 * RC Plus/RC Pro identifies itself with a proper model name. Showing its raw
 * serial number in that case reads as an anonymous, unidentifiable device. */
function domainFallbackLabel(domain: number | undefined): string | undefined {
  return domain === 2 ? "DJI Pilot 2" : undefined;
}

/** Prefers the aircraft's own physical battery reading(s) over the
 * platform's aggregate `battery.capacity_percent` — real OSD payloads show
 * these can diverge by several points even for a single-battery aircraft
 * (the aggregate is a separate system-level estimate, not simply the
 * battery's own fuel-gauge value), and the divergent aggregate is NOT what
 * DJI Pilot 2's own flight screen displays. */
function resolveBatteryPercent(
  telemetry: DeviceTelemetry | undefined,
): number | undefined {
  if (!telemetry) return undefined;
  if (telemetry.batteryPercents && telemetry.batteryPercents.length > 0) {
    const sum = telemetry.batteryPercents.reduce((a, b) => a + b, 0);
    return Math.round(sum / telemetry.batteryPercents.length);
  }
  return telemetry.batteryPercent;
}

/** A workspace normally has both an aircraft and its remote controller (or
 * dock) bound, and they used to share the exact same plane icon in this
 * list — reading like two separate drones. Domain 0 is an aircraft; the
 * rest (2 = RC, 3 = dock) are ground-side gateway devices with their own,
 * visually distinct icon. */
function DeviceIcon({ domain }: { domain: number | undefined }) {
  if (domain === 2) {
    return <Gamepad2 className="h-3 w-3 text-muted-foreground shrink-0" />;
  }
  if (domain === 3) {
    return <Box className="h-3 w-3 text-muted-foreground shrink-0" />;
  }
  return <Plane className="h-3 w-3 text-muted-foreground shrink-0" />;
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

/** How long telemetry can go without a fresh OSD message before it's shown
 * as stale rather than confidently presented as current — the aircraft/RC
 * normally streams updates multiple times a second, so anything older than
 * this means the connection likely dropped silently (the bridge has no
 * timeout-based "went offline" detection of its own, so without this the
 * panel would otherwise keep showing a frozen last-known battery/position
 * indefinitely with no sign anything was wrong). */
const STALE_TELEMETRY_MS = 15_000;

/** Live HUD readout for one aircraft — signal, battery (its own and its
 * paired RC/dock's), altitude, distance from home, climb/flight speed, and
 * wind, mirroring the fields DJI Pilot's own flight screen shows. Pulls
 * straight from the store's SSE-fed `telemetry` map, so every field updates
 * in real time as new OSD messages arrive — no polling or manual refresh
 * involved. */
function DeviceTelemetryHud({
  telemetry,
  gatewayTelemetry,
}: {
  telemetry: DeviceTelemetry;
  gatewayTelemetry: DeviceTelemetry | undefined;
}) {
  const unitSystem = usePreferencesStore((s) => s.preferences.unitSystem);
  // Re-render every few seconds even with no new telemetry, purely so the
  // staleness check below actually notices time passing instead of only
  // re-evaluating whenever a new OSD message happens to arrive.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  const isStale = Date.now() - telemetry.updatedAt > STALE_TELEMETRY_MS;
  const signalQuality = gatewayTelemetry?.signalQuality;

  const batteryLabel =
    telemetry.batteryPercents && telemetry.batteryPercents.length > 0
      ? telemetry.batteryPercents.map((p) => `${p} %`).join(" / ")
      : typeof telemetry.batteryPercent === "number"
        ? `${telemetry.batteryPercent} %`
        : "—";

  const rows: [string, string][] = [
    ["Signál", typeof signalQuality === "number" ? `${signalQuality}/5` : "—"],
    ["Baterie (dron)", batteryLabel],
    [
      "Baterie (ovladač)",
      typeof gatewayTelemetry?.batteryPercent === "number"
        ? `${gatewayTelemetry.batteryPercent} %`
        : "—",
    ],
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
    <div className="pl-4 pt-1">
      {isStale && (
        <p className="text-[10px] text-amber-400 pb-1">
          Data neaktualizována přes {Math.round(STALE_TELEMETRY_MS / 1000)} s —
          spojení mohlo vypadnout, hodnoty níže nemusí odpovídat aktuálnímu
          stavu.
        </p>
      )}
      <div
        className={`grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] ${isStale ? "opacity-50" : ""}`}
      >
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{label}</span>
            <span className="tabular-nums">{value}</span>
          </div>
        ))}
      </div>
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

  // HMS history keeps every warning any device ever reported, with no way
  // to tell "still happening" from "resolved" — showing one for a device
  // that isn't even connected right now is actively misleading (it reads
  // as a live problem with equipment that's simply off), so only surface
  // warnings for a device that's currently online.
  const onlineDeviceSns = new Set(
    devices.filter((d) => d.status).map((d) => d.device_sn),
  );
  // Being online isn't enough on its own: a device's HMS history still
  // includes every warning from EVERY past connection, not just the current
  // one (e.g. a battery-critical code from two days ago sitting right next
  // to a fresh warning from this session). `login_time` resets each time a
  // device reconnects to the platform, so it's a reliable boundary for "this
  // session" — a warning that predates it is from a previous flight/power-on
  // and reads exactly like a live problem even though it's just history.
  const loginTimeMsByDeviceSn = new Map(
    devices.map((d) => [
      d.device_sn,
      d.login_time ? new Date(d.login_time).getTime() : undefined,
    ]),
  );
  const currentHmsMessages = hmsMessages.filter((msg) => {
    if (!onlineDeviceSns.has(msg.sn)) return false;
    const loginTimeMs = loginTimeMsByDeviceSn.get(msg.sn);
    if (!loginTimeMs || Number.isNaN(loginTimeMs)) return true;
    const msgTimeMs = new Date(msg.create_time).getTime();
    if (Number.isNaN(msgTimeMs)) return true;
    return msgTimeMs >= loginTimeMs;
  });

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
            const battery = resolveBatteryPercent(deviceTelemetry);
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
            const gatewayTelemetry = gatewaySn
              ? telemetry[gatewaySn]
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
                    <DeviceIcon domain={device.domain} />
                    <span className="truncate">
                      {realValue(device.nickname) ??
                        realValue(device.device_name) ??
                        domainFallbackLabel(device.domain) ??
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
                    gatewayTelemetry={gatewayTelemetry}
                  />
                )}
              </div>
            );
          })}
          {currentHmsMessages.length > 0 && (
            <div className="pt-1 space-y-1 border-t border-border/50">
              {dedupeConsecutiveHms(currentHmsMessages)
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
