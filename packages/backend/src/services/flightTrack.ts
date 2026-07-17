import { v4 as uuidv4 } from "uuid";
import { getDb } from "../models/db.js";
import { onTelemetryUpdate, type DeviceTelemetry } from "./mqttTelemetry.js";

/** How often a telemetry update is allowed to add a new track point, in ms.
 * OSD messages can arrive faster than 1/s; storing every one of them would
 * bloat the table for no benefit — a point every couple of seconds is
 * already denser than the waypoint spacing pilots plan against. */
const MIN_POINT_INTERVAL_MS = 2000;

export interface FlightTrackSession {
  id: string;
  missionId: string | null;
  userId: string;
  deviceSn: string;
  startedAt: string;
  endedAt: string | null;
}

export interface FlightTrackPoint {
  recordedAt: number;
  latitude: number;
  longitude: number;
  height: number | null;
  horizontalSpeed: number | null;
  batteryPercent: number | null;
}

interface SessionRow {
  id: string;
  mission_id: string | null;
  user_id: string;
  device_sn: string;
  started_at: string;
  ended_at: string | null;
}

function toApiSession(row: SessionRow): FlightTrackSession {
  return {
    id: row.id,
    missionId: row.mission_id,
    userId: row.user_id,
    deviceSn: row.device_sn,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

// deviceSn -> active session id. Recording state lives in-memory (like the
// telemetry bridge itself) since it only matters for the current process's
// live MQTT connection — a restart naturally ends any in-progress recording,
// which is also the safe behavior (no orphaned "still recording" session).
const activeSessionsByDevice = new Map<string, string>();
const lastPointAtBySession = new Map<string, number>();
let unsubscribeTelemetry: (() => void) | null = null;

function ensureSubscribed(): void {
  if (unsubscribeTelemetry) return;
  unsubscribeTelemetry = onTelemetryUpdate(handleTelemetryUpdate);
}

function handleTelemetryUpdate(record: DeviceTelemetry): void {
  const sessionId = activeSessionsByDevice.get(record.deviceSn);
  if (!sessionId) return;
  if (
    typeof record.latitude !== "number" ||
    typeof record.longitude !== "number"
  ) {
    return;
  }

  const now = Date.now();
  const lastAt = lastPointAtBySession.get(sessionId) ?? 0;
  if (now - lastAt < MIN_POINT_INTERVAL_MS) return;
  lastPointAtBySession.set(sessionId, now);

  getDb()
    .prepare(
      `INSERT INTO flight_track_points
        (session_id, recorded_at, latitude, longitude, height, horizontal_speed, battery_percent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      now,
      record.latitude,
      record.longitude,
      record.height ?? null,
      record.horizontalSpeed ?? null,
      record.batteryPercent ?? null,
    );
}

/** Starts recording a device's live telemetry into a new session. Only one
 * active session per device at a time — starting again while one is already
 * recording for that device just returns the existing session id. */
export function startFlightTrackSession(
  userId: string,
  deviceSn: string,
  missionId: string | null,
): FlightTrackSession {
  ensureSubscribed();

  const existingId = activeSessionsByDevice.get(deviceSn);
  if (existingId) {
    const existing = getDb()
      .prepare("SELECT * FROM flight_track_sessions WHERE id = ?")
      .get(existingId) as SessionRow;
    return toApiSession(existing);
  }

  const id = uuidv4();
  getDb()
    .prepare(
      `INSERT INTO flight_track_sessions (id, mission_id, user_id, device_sn) VALUES (?, ?, ?, ?)`,
    )
    .run(id, missionId, userId, deviceSn);
  activeSessionsByDevice.set(deviceSn, id);

  const row = getDb()
    .prepare("SELECT * FROM flight_track_sessions WHERE id = ?")
    .get(id) as SessionRow;
  return toApiSession(row);
}

/** Stops whichever session is currently recording for this device, if any. */
export function stopFlightTrackSessionForDevice(deviceSn: string): void {
  const sessionId = activeSessionsByDevice.get(deviceSn);
  if (!sessionId) return;
  activeSessionsByDevice.delete(deviceSn);
  lastPointAtBySession.delete(sessionId);
  getDb()
    .prepare(
      `UPDATE flight_track_sessions SET ended_at = datetime('now') WHERE id = ?`,
    )
    .run(sessionId);
}

export function isRecording(deviceSn: string): string | null {
  return activeSessionsByDevice.get(deviceSn) ?? null;
}

export function listFlightTrackSessions(
  missionId: string,
): FlightTrackSession[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM flight_track_sessions WHERE mission_id = ? ORDER BY started_at DESC",
    )
    .all(missionId) as SessionRow[];
  return rows.map(toApiSession);
}

export function getFlightTrackSession(
  sessionId: string,
): FlightTrackSession | null {
  const row = getDb()
    .prepare("SELECT * FROM flight_track_sessions WHERE id = ?")
    .get(sessionId) as SessionRow | undefined;
  return row ? toApiSession(row) : null;
}

interface PointRow {
  recorded_at: number;
  latitude: number;
  longitude: number;
  height: number | null;
  horizontal_speed: number | null;
  battery_percent: number | null;
}

export function getFlightTrackPoints(sessionId: string): FlightTrackPoint[] {
  const rows = getDb()
    .prepare(
      "SELECT recorded_at, latitude, longitude, height, horizontal_speed, battery_percent FROM flight_track_points WHERE session_id = ? ORDER BY recorded_at ASC",
    )
    .all(sessionId) as PointRow[];
  return rows.map((r) => ({
    recordedAt: r.recorded_at,
    latitude: r.latitude,
    longitude: r.longitude,
    height: r.height,
    horizontalSpeed: r.horizontal_speed,
    batteryPercent: r.battery_percent,
  }));
}

export function deleteFlightTrackSession(sessionId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM flight_track_points WHERE session_id = ?").run(
    sessionId,
  );
  db.prepare("DELETE FROM flight_track_sessions WHERE id = ?").run(sessionId);
}

/** Test-only reset of in-memory recording state. */
export function resetFlightTrackState(): void {
  activeSessionsByDevice.clear();
  lastPointAtBySession.clear();
  unsubscribeTelemetry?.();
  unsubscribeTelemetry = null;
}
