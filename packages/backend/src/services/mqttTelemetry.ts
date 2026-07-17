import mqtt, { type MqttClient } from "mqtt";
import { EventEmitter } from "events";
import { getMqttSessionCredentials } from "./djiCloud.js";

/**
 * Live telemetry bridge: subscribes to the DJI Cloud platform's MQTT broker
 * (the same one DJI Pilot 2 and the platform's own backend use) so SkyRoute
 * can show an aircraft's live position/battery/status on the map without
 * any manual refresh — this is what actually makes "Cloud" missions useful
 * beyond just file transfer.
 *
 * Deliberately a thin, in-memory cache over the broker's `sys/product/+/status`
 * (online/offline) and `thing/product/+/osd` (position/battery/speed) topics,
 * not a general-purpose MQTT client — every consumer (the SSE route, future
 * features) reads from `getSnapshot()`/`onUpdate()` rather than opening its
 * own broker connection.
 */

export interface DeviceTelemetry {
  deviceSn: string;
  online: boolean;
  latitude?: number;
  longitude?: number;
  /** Height above takeoff point, meters. */
  height?: number;
  /** Height above the WGS84 ellipsoid, meters, when the platform reports it. */
  elevation?: number;
  horizontalSpeed?: number;
  verticalSpeed?: number;
  attitudeHead?: number;
  /** Aircraft's own aggregate battery reading. */
  batteryPercent?: number;
  /** Per-cell percentages for a dual-battery aircraft (e.g. Matrice 4 series),
   * in the same order the platform reports them — when present, this is what
   * DJI Pilot's own HUD actually shows (two separate numbers), not the single
   * aggregate `batteryPercent`. */
  batteryPercents?: number[];
  gpsQuality?: number;
  /** Straight-line distance from the aircraft's home/launch point, meters. */
  homeDistance?: number;
  /** Wind speed at the aircraft's position, m/s. */
  windSpeed?: number;
  /** Uplink/downlink signal quality (0-5 scale), reported by the paired RC
   * or dock's own OSD topic — not the aircraft's, so this only ends up
   * populated on the RC/dock's own telemetry record, not the aircraft's. */
  signalQuality?: number;
  /** ms since epoch this record was last updated. */
  updatedAt: number;
}

const telemetry = new Map<string, DeviceTelemetry>();
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

let client: MqttClient | null = null;
let connecting = false;

function topicDeviceSn(topic: string): string | null {
  // sys/product/{sn}/status  |  thing/product/{sn}/osd
  const match = topic.match(/^(?:sys|thing)\/product\/([^/]+)\//);
  return match ? match[1] : null;
}

function upsert(deviceSn: string, partial: Partial<DeviceTelemetry>): void {
  const existing = telemetry.get(deviceSn);
  // A given MQTT message only carries the fields it actually has — fields
  // this particular message doesn't mention come through as `undefined` and
  // must NOT overwrite a previously-known good value (object spread assigns
  // `undefined` keys too, so a naive `{ ...existing, ...partial }` would
  // erase e.g. longitude every time a message updates only height).
  const defined = Object.fromEntries(
    Object.entries(partial).filter(([, v]) => v !== undefined),
  );
  const next: DeviceTelemetry = {
    deviceSn,
    online: existing?.online ?? true,
    ...existing,
    ...defined,
    updatedAt: Date.now(),
  };
  telemetry.set(deviceSn, next);
  emitter.emit("update", next);
}

/** Exported for testing — feeds a raw MQTT message through the same parsing
 * path a real broker message would take, without needing a live broker. */
export function handleMessage(topic: string, payload: Buffer): void {
  const deviceSn = topicDeviceSn(topic);
  if (!deviceSn) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString("utf8"));
  } catch {
    return; // malformed/binary payload — ignore rather than crash the bridge
  }
  if (typeof parsed !== "object" || parsed === null) return;
  const body = parsed as Record<string, unknown>;

  if (topic.includes("/status")) {
    const online = readBool(body, ["data", "online"]) ?? true;
    upsert(deviceSn, { online });
    return;
  }

  // OSD payloads nest the actual telemetry under `data`.
  const data = (body.data as Record<string, unknown>) ?? body;
  const battery = data.battery as Record<string, unknown> | undefined;
  const batteries = battery?.batteries;
  const positionState = data.position_state as
    | Record<string, unknown>
    | undefined;
  const wirelessLink = data.wireless_link as
    | Record<string, unknown>
    | undefined;

  upsert(deviceSn, {
    online: true,
    latitude: readNumber(data, "latitude"),
    longitude: readNumber(data, "longitude"),
    height: readNumber(data, "height"),
    elevation: readNumber(data, "elevation"),
    horizontalSpeed: readNumber(data, "horizontal_speed"),
    verticalSpeed: readNumber(data, "vertical_speed"),
    attitudeHead: readNumber(data, "attitude_head"),
    // The aircraft nests this under a `battery` object; an RC or dock
    // reports its own battery as a flat top-level `capacity_percent`
    // instead — without the fallback, an RC/dock's battery was invisible
    // to this bridge entirely (not wrong, just never captured), which read
    // exactly like a stale/incorrect reading once shown next to the
    // aircraft's own number.
    batteryPercent: battery
      ? readNumber(battery, "capacity_percent")
      : readNumber(data, "capacity_percent"),
    batteryPercents: Array.isArray(batteries)
      ? batteries
          .map((b) =>
            typeof b === "object" && b !== null
              ? readNumber(b as Record<string, unknown>, "capacity_percent")
              : undefined,
          )
          .filter((v): v is number => v !== undefined)
      : undefined,
    // Older/simpler payloads (or a subset of devices) can put gps_number
    // directly on `data`; the platform's own schema nests it under
    // `position_state` — check both rather than assume one shape.
    gpsQuality:
      (positionState ? readNumber(positionState, "gps_number") : undefined) ??
      readNumber(data, "gps_number") ??
      readNumber(data, "gear"),
    homeDistance: readNumber(data, "home_distance"),
    windSpeed: readNumber(data, "wind_speed"),
    // Only the RC/dock's own OSD carries this — an aircraft message simply
    // won't have a `wireless_link` object, so this is a no-op for it.
    signalQuality: wirelessLink
      ? (readNumber(wirelessLink, "sdr_quality") ??
        readNumber(wirelessLink, "4g_quality"))
      : undefined,
  });
}

function readNumber(
  obj: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = obj[key];
  return typeof v === "number" ? v : undefined;
}

function readBool(
  obj: Record<string, unknown>,
  path: string[],
): boolean | undefined {
  let cur: unknown = obj;
  for (const key of path) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "boolean" ? cur : undefined;
}

async function connect(): Promise<void> {
  if (client || connecting) return;
  connecting = true;
  try {
    const creds = await getMqttSessionCredentials();
    if (!creds) return; // not configured — bridge stays idle

    const brokerUrl = creds.url.replace(/^https?:\/\//, "mqtts://");
    const url = new URL(brokerUrl);
    url.protocol = "mqtts:";
    url.port = "8883";

    client = mqtt.connect(url.toString(), {
      username: creds.username,
      password: creds.password,
      reconnectPeriod: 10_000,
      connectTimeout: 15_000,
      clientId: `skyroute-bridge-${Math.random().toString(16).slice(2, 10)}`,
    });

    client.on("connect", () => {
      client?.subscribe(
        ["sys/product/+/status", "thing/product/+/osd"],
        (err) => {
          if (err) console.error("MQTT telemetry subscribe failed:", err);
        },
      );
    });

    client.on("message", handleMessage);

    client.on("error", (err) => {
      console.error("DJI Cloud MQTT telemetry bridge error:", err);
    });

    client.on("close", () => {
      // mqtt.js retries on its own reconnectPeriod; if the session
      // credentials themselves expired, a fresh login is needed instead of
      // endlessly retrying with a stale password — tear down and let the
      // next getSnapshot()/ensureConnected() call re-establish a session.
      client?.end(true);
      client = null;
    });
  } catch (err) {
    console.error("DJI Cloud MQTT telemetry bridge failed to start:", err);
    client = null;
  } finally {
    connecting = false;
  }
}

/** Ensures a connection attempt has been made (idempotent, safe to call often). */
export async function ensureTelemetryBridgeConnected(): Promise<void> {
  await connect();
}

/** Current known state of every device the bridge has heard from. */
export function getTelemetrySnapshot(): DeviceTelemetry[] {
  return Array.from(telemetry.values());
}

/** Subscribes to live updates; returns an unsubscribe function. */
export function onTelemetryUpdate(
  handler: (record: DeviceTelemetry) => void,
): () => void {
  emitter.on("update", handler);
  return () => emitter.off("update", handler);
}

/** Test/shutdown helper — closes the broker connection and clears state. */
export function stopTelemetryBridge(): void {
  client?.end(true);
  client = null;
  telemetry.clear();
}
