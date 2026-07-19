/**
 * Bridge to a DJI Cloud API platform (the self-hosted stack DJI Pilot 2
 * connects to via its "Open Platforms" cloud service) — uploads generated
 * mission KMZ files into the platform's wayline library so they appear in
 * the RC's Cloud tab without any manual file transfer.
 *
 * The server-wide bridge is configured through environment variables; when
 * they're absent the feature is disabled entirely and the UI hides its
 * button:
 * - DJI_CLOUD_URL       e.g. https://dji-cloud.example.com (no trailing /)
 * - DJI_CLOUD_USERNAME  a web (user_type 1) account on the platform
 * - DJI_CLOUD_PASSWORD
 *
 * Individual SkyRoute users can additionally link their own DJI Cloud web
 * account (see linkDjiCloudAccount below) so their uploads/actions are
 * attributed to them on the platform instead of the one shared service
 * account — every function below takes an optional `userId` and prefers
 * that user's own linked credentials when present, falling back to the
 * server-wide service account otherwise.
 */

import { getDb } from "../models/db.js";
import { encryptSecret, decryptSecret } from "../lib/encryption.js";

interface DjiCloudConfig {
  url: string;
  username: string;
  password: string;
}

/** Server-wide service-account config, read at call time (not module load)
 * so tests can stub the env. */
function readServiceConfig(): DjiCloudConfig | null {
  const url = process.env.DJI_CLOUD_URL?.replace(/\/+$/, "");
  const username = process.env.DJI_CLOUD_USERNAME;
  const password = process.env.DJI_CLOUD_PASSWORD;
  if (!url || !username || !password) return null;
  return { url, username, password };
}

interface DjiCloudAccountRow {
  dji_username: string;
  dji_password_encrypted: string;
}

/** Resolves which credentials to authenticate a call with: the given
 * user's own linked DJI Cloud account if they have one, otherwise the
 * server-wide service account. The platform URL always comes from the
 * server-wide config — a linked account is just a different login on the
 * same configured platform, not a way to point at a different server. */
function resolveConfig(userId?: string): DjiCloudConfig | null {
  const serviceConfig = readServiceConfig();
  if (!serviceConfig) return null;
  if (!userId) return serviceConfig;

  const row = getDb()
    .prepare(
      "SELECT dji_username, dji_password_encrypted FROM dji_cloud_accounts WHERE user_id = ?",
    )
    .get(userId) as DjiCloudAccountRow | undefined;
  if (!row) return serviceConfig;

  return {
    url: serviceConfig.url,
    username: row.dji_username,
    password: decryptSecret(row.dji_password_encrypted),
  };
}

export function isDjiCloudConfigured(): boolean {
  return readServiceConfig() !== null;
}

/** Verifies the given credentials against the configured platform (a real
 * login attempt) and, on success, stores them encrypted for this user —
 * replacing any previously linked account. Throws the same way `login`
 * does if the credentials are rejected, so the route can surface a clear
 * error instead of silently storing something that doesn't work. */
export async function linkDjiCloudAccount(
  userId: string,
  username: string,
  password: string,
): Promise<void> {
  const serviceConfig = readServiceConfig();
  if (!serviceConfig) throw new Error("DJI Cloud není nakonfigurován");
  await login({ url: serviceConfig.url, username, password });

  getDb()
    .prepare(
      `INSERT INTO dji_cloud_accounts (user_id, dji_username, dji_password_encrypted, linked_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         dji_username = excluded.dji_username,
         dji_password_encrypted = excluded.dji_password_encrypted,
         linked_at = excluded.linked_at`,
    )
    .run(userId, username, encryptSecret(password));
}

export function unlinkDjiCloudAccount(userId: string): void {
  getDb()
    .prepare("DELETE FROM dji_cloud_accounts WHERE user_id = ?")
    .run(userId);
}

export function getDjiCloudAccountStatus(
  userId: string,
): { linked: true; username: string; linkedAt: string } | { linked: false } {
  const row = getDb()
    .prepare(
      "SELECT dji_username, linked_at FROM dji_cloud_accounts WHERE user_id = ?",
    )
    .get(userId) as { dji_username: string; linked_at: string } | undefined;
  if (!row) return { linked: false };
  return { linked: true, username: row.dji_username, linkedAt: row.linked_at };
}

interface DjiLoginData {
  access_token: string;
  workspace_id: string;
  mqtt_username?: string;
  mqtt_password?: string;
}

interface DjiApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

interface DjiSession {
  token: string;
  workspaceId: string;
  mqttUsername?: string;
  mqttPassword?: string;
}

async function login(cfg: DjiCloudConfig): Promise<DjiSession> {
  const res = await fetch(`${cfg.url}/manage/api/v1/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: cfg.username,
      password: cfg.password,
      // flag = account type; 1 = web account (the DJI reference platform's
      // own admin UI logs in the same way).
      flag: 1,
    }),
  });
  if (!res.ok) {
    throw new Error(`DJI Cloud login selhal (HTTP ${res.status})`);
  }
  const body = (await res.json()) as DjiApiResponse<DjiLoginData>;
  if (body.code !== 0 || !body.data?.access_token) {
    throw new Error(`DJI Cloud login selhal: ${body.message}`);
  }
  return {
    token: body.data.access_token,
    workspaceId: body.data.workspace_id,
    mqttUsername: body.data.mqtt_username,
    mqttPassword: body.data.mqtt_password,
  };
}

async function authedGet<T>(
  cfg: DjiCloudConfig,
  token: string,
  path: string,
): Promise<T> {
  const res = await fetch(`${cfg.url}${path}`, {
    headers: { "x-auth-token": token },
  });
  if (!res.ok) {
    throw new Error(`DJI Cloud požadavek selhal (HTTP ${res.status})`);
  }
  const body = (await res.json()) as DjiApiResponse<T>;
  if (body.code !== 0) {
    throw new Error(`DJI Cloud požadavek selhal: ${body.message}`);
  }
  return body.data;
}

export interface DjiDeviceSummary {
  device_sn: string;
  nickname: string;
  device_name: string;
  device_model_key?: string;
  bound_status: boolean;
  login_time?: string;
  bound_time?: string;
  workspace_id?: string;
  domain?: number;
  status?: boolean;
  /** SN of the aircraft this device (an RC or dock) controls — set on the
   * gateway's own record, used to find which RC/dock a given aircraft's
   * signal-quality telemetry (reported on the gateway's OSD, not the
   * aircraft's own) actually comes from. */
  child_device_sn?: string;
  /** SN of the gateway (RC/dock) controlling this device — set on the
   * aircraft's own record, the reverse direction of `child_device_sn`. */
  parent_sn?: string;
}

/**
 * Lists devices (aircraft + RCs) bound to the configured workspace, per the
 * platform's `/manage/api/v1/devices/{workspace_id}/devices/bound` endpoint
 * (paginated; a workspace realistically has a handful of devices, so the
 * first page is fetched with a generous size rather than implementing full
 * pagination here).
 */
export async function listBoundDevices(
  userId?: string,
): Promise<DjiDeviceSummary[]> {
  const cfg = resolveConfig(userId);
  if (!cfg) throw new Error("DJI Cloud není nakonfigurován");
  const { token, workspaceId } = await login(cfg);
  const data = await authedGet<{ list: DjiDeviceSummary[] }>(
    cfg,
    token,
    `/manage/api/v1/devices/${workspaceId}/devices/bound?page=1&page_size=50`,
  );
  return data.list;
}

export interface DjiHmsMessage {
  /** The platform's actual field name is `sn`, not `device_sn`. */
  sn: string;
  key: string;
  level: number;
  module: number;
  /** Formatted string ("2026-07-16 16:56:51"), not an epoch. */
  create_time: string;
  message_zh: string;
  message_en: string;
}

/**
 * Fetches recent Health Management System (HMS) messages for the
 * workspace's devices — aircraft-reported warnings/errors (e.g. gimbal
 * fault, low battery cell imbalance), surfaced so a pilot can see them
 * before a flight instead of only in DJI Pilot 2's own UI.
 */
export async function listHmsMessages(
  userId?: string,
): Promise<DjiHmsMessage[]> {
  const cfg = resolveConfig(userId);
  if (!cfg) throw new Error("DJI Cloud není nakonfigurován");
  const { token, workspaceId } = await login(cfg);
  const data = await authedGet<{ list: DjiHmsMessage[] }>(
    cfg,
    token,
    `/manage/api/v1/devices/${workspaceId}/devices/hms?page=1&page_size=50`,
  );
  return data.list;
}

export interface DjiWaylineJob {
  job_id: string;
  job_name: string;
  file_id: string;
  dock_sn?: string;
  status: string;
  progress?: { percent?: number };
  create_time: number;
}

/**
 * Lists wayline execution jobs (flight history/progress) for the workspace
 * — `/wayline/api/v1/workspaces/{workspace_id}/jobs`. Scheduling a *new*
 * job this way requires a DJI Dock (autonomous drone-in-a-box hardware);
 * a handheld RC + aircraft combo can't be remotely triggered to take off,
 * so this bridge only exposes job *history/status*, not creation — see the
 * changelog for why "remote flight task dispatch" is narrower in scope
 * than originally imagined.
 */
export async function listWaylineJobs(
  userId?: string,
): Promise<DjiWaylineJob[]> {
  const cfg = resolveConfig(userId);
  if (!cfg) throw new Error("DJI Cloud není nakonfigurován");
  const { token, workspaceId } = await login(cfg);
  const data = await authedGet<{ list: DjiWaylineJob[] }>(
    cfg,
    token,
    `/wayline/api/v1/workspaces/${workspaceId}/jobs?page=1&page_size=50&order_by=create_time%20desc`,
  );
  return data.list;
}

/**
 * Returns the MQTT credentials issued by the platform's own login response
 * (the same account the KMZ-upload bridge already authenticates as) so the
 * live-telemetry bridge (see `mqttTelemetry.ts`) can subscribe without
 * needing a separate, statically-configured MQTT user.
 */
export async function getMqttSessionCredentials(): Promise<{
  url: string;
  username: string;
  password: string;
} | null> {
  // Always the server-wide service account, not a per-user one: this feeds
  // a single, process-wide MQTT bridge connection (mqttTelemetry.ts) shared
  // by every request, not a per-call authenticated action.
  const cfg = readServiceConfig();
  if (!cfg) return null;
  const session = await login(cfg);
  if (!session.mqttUsername || !session.mqttPassword) return null;
  return {
    url: cfg.url,
    username: session.mqttUsername,
    password: session.mqttPassword,
  };
}

export interface DjiWaylineSummary {
  id: string;
  name: string;
  user_name?: string;
  create_time?: number;
  update_time?: number;
}

/**
 * Lists KMZ files currently in the workspace's wayline library —
 * `GET /wayline/api/v1/workspaces/{workspace_id}/waylines`, the list
 * counterpart of the delete endpoint just below. Used both to power a
 * library-management view and, in `uploadOne`, to detect a same-name
 * collision so an upload can overwrite instead of piling up timestamped
 * duplicates.
 */
export async function listWaylines(
  userId?: string,
): Promise<DjiWaylineSummary[]> {
  const cfg = resolveConfig(userId);
  if (!cfg) throw new Error("DJI Cloud není nakonfigurován");
  const { token, workspaceId } = await login(cfg);
  const data = await authedGet<{ list: DjiWaylineSummary[] }>(
    cfg,
    token,
    `/wayline/api/v1/workspaces/${workspaceId}/waylines?page=1&page_size=50&order_by=update_time%20desc`,
  );
  return data.list;
}

async function deleteWaylineAuthed(
  cfg: DjiCloudConfig,
  token: string,
  workspaceId: string,
  waylineId: string,
): Promise<void> {
  const res = await fetch(
    `${cfg.url}/wayline/api/v1/workspaces/${workspaceId}/waylines/${encodeURIComponent(waylineId)}`,
    { method: "DELETE", headers: { "x-auth-token": token } },
  );
  if (!res.ok) {
    throw new Error(`DJI Cloud smazání selhalo (HTTP ${res.status})`);
  }
  const body = (await res.json()) as DjiApiResponse<unknown>;
  if (body.code !== 0) {
    throw new Error(`DJI Cloud smazání selhalo: ${body.message}`);
  }
}

/**
 * Deletes a wayline file from the workspace's library (e.g. to clean up a
 * timestamped duplicate created by a retried upload, or a mission that's
 * no longer needed) — `/wayline/api/v1/workspaces/{workspace_id}/waylines/{id}`.
 */
export async function deleteWayline(
  waylineId: string,
  userId?: string,
): Promise<void> {
  const cfg = resolveConfig(userId);
  if (!cfg) throw new Error("DJI Cloud není nakonfigurován");
  const { token, workspaceId } = await login(cfg);
  await deleteWaylineAuthed(cfg, token, workspaceId, waylineId);
}

async function uploadFile(
  cfg: DjiCloudConfig,
  token: string,
  workspaceId: string,
  filename: string,
  kmz: Buffer,
): Promise<DjiApiResponse<unknown>> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(kmz)], { type: "application/zip" }),
    filename,
  );
  const res = await fetch(
    `${cfg.url}/wayline/api/v1/workspaces/${workspaceId}/waylines/file/upload`,
    {
      method: "POST",
      headers: { "x-auth-token": token },
      body: form,
    },
  );
  if (!res.ok) {
    throw new Error(`DJI Cloud upload selhal (HTTP ${res.status})`);
  }
  return (await res.json()) as DjiApiResponse<unknown>;
}

function timestampSuffix(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
}

/**
 * Best-effort lookup of an existing wayline by (case-insensitive, extension-
 * stripped) name match. Swallows any error — a library listing failure just
 * means the overwrite path in `uploadOne` can't find anything to delete, not
 * that the upload itself should fail.
 */
async function findExistingWaylineByName(
  cfg: DjiCloudConfig,
  token: string,
  workspaceId: string,
  baseName: string,
): Promise<string | null> {
  try {
    const data = await authedGet<{ list: DjiWaylineSummary[] }>(
      cfg,
      token,
      `/wayline/api/v1/workspaces/${workspaceId}/waylines?page=1&page_size=50`,
    );
    const match = data.list.find(
      (w) =>
        w.name.replace(/\.kmz$/i, "").toLowerCase() === baseName.toLowerCase(),
    );
    return match?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Uploads one KMZ into an already-authenticated workspace. The happy path
 * (no name collision) is a single upload call, same as before — the
 * overwrite machinery below only kicks in when the platform actually
 * rejects the name as a duplicate, so a normal upload's fetch-call sequence
 * is unchanged.
 *
 * On a duplicate-name rejection: looks up the existing wayline by name and
 * deletes it, then retries under the SAME name (an in-place overwrite,
 * rather than the old behavior of always minting a new timestamped file).
 * If that still fails — the lookup came up empty, the delete raced with
 * something else, whatever — falls back to the timestamped name as a last
 * resort so the upload doesn't fail outright. Returns the wayline name it
 * was actually stored under.
 */
/**
 * DJI Cloud rejects wayline names containing `< > : " / | ? * . _ \` (its own
 * validation regex is `^[^<>:"/|?*._\\]+$` — note that includes underscore
 * and dot, not just filesystem-unsafe characters). A name that slips past
 * upload with one of these characters still gets stored, but then breaks
 * the *whole workspace's* wayline-library listing the next time anything
 * tries to read it back (Pilot 2's Cloud tab and our own `listWaylines`
 * both fail outright on the first offending entry) — so this has to reject
 * the same characters DJI does, not just filesystem-unsafe ones.
 */
function sanitizeWaylineName(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*._]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "mission"
  );
}

async function uploadOne(
  cfg: DjiCloudConfig,
  token: string,
  workspaceId: string,
  name: string,
  kmz: Buffer,
): Promise<string> {
  const baseName = sanitizeWaylineName(name);

  const first = await uploadFile(
    cfg,
    token,
    workspaceId,
    `${baseName}.kmz`,
    kmz,
  );
  if (first.code === 0) return baseName;

  const existingId = await findExistingWaylineByName(
    cfg,
    token,
    workspaceId,
    baseName,
  );
  if (existingId) {
    try {
      await deleteWaylineAuthed(cfg, token, workspaceId, existingId);
      const overwrite = await uploadFile(
        cfg,
        token,
        workspaceId,
        `${baseName}.kmz`,
        kmz,
      );
      if (overwrite.code === 0) return baseName;
    } catch {
      // Deletion or the overwrite retry failed — fall through to the
      // timestamped fallback below rather than giving up.
    }
  }

  const retryName = `${baseName}-${timestampSuffix()}`;
  const fallback = await uploadFile(
    cfg,
    token,
    workspaceId,
    `${retryName}.kmz`,
    kmz,
  );
  if (fallback.code === 0) return retryName;

  throw new Error(`DJI Cloud upload selhal: ${fallback.message}`);
}

/**
 * Uploads a mission KMZ into the configured DJI Cloud workspace's wayline
 * library. Returns the wayline name it was stored under.
 */
export async function uploadMissionToDjiCloud(
  missionName: string,
  kmz: Buffer,
  userId?: string,
): Promise<{ waylineName: string }> {
  const cfg = resolveConfig(userId);
  if (!cfg) {
    throw new Error("DJI Cloud není nakonfigurován");
  }
  const { token, workspaceId } = await login(cfg);
  const waylineName = await uploadOne(
    cfg,
    token,
    workspaceId,
    missionName,
    kmz,
  );
  return { waylineName };
}

/**
 * Thrown when a segment upload fails partway through, carrying how many
 * segments already made it into the workspace so the caller can tell the
 * user (e.g. "3 of 5 uploaded before the failure") instead of implying
 * nothing happened — which would invite a redundant re-upload.
 */
export class PartialSegmentUploadError extends Error {
  constructor(
    public readonly uploaded: number,
    public readonly total: number,
  ) {
    super(
      `DJI Cloud segment upload selhal: nahráno ${uploaded} z ${total} segmentů`,
    );
    this.name = "PartialSegmentUploadError";
  }
}

export interface DjiMediaFile {
  file_id: string;
  file_name: string;
  create_time: number;
  tiny_fingerprint?: string;
  metadata?: {
    shoot_time?: string;
    drone_model_key?: string;
    payload_model_key?: string;
    gps_longitude?: number;
    gps_latitude?: number;
  };
}

/**
 * Lists media files (photos/videos) the aircraft/RC has already uploaded
 * into the workspace's own object storage — `GET
 * media/api/v1/files/{workspace_id}/files`. This is a read of state the
 * platform already has; SkyRoute never receives or stores the files
 * itself, it just surfaces what's there so a pilot doesn't have to open
 * the platform's own console separately after a flight.
 */
export async function listMediaFiles(
  page = 1,
  pageSize = 20,
  userId?: string,
): Promise<{ list: DjiMediaFile[]; total: number }> {
  const cfg = resolveConfig(userId);
  if (!cfg) throw new Error("DJI Cloud není nakonfigurován");
  const { token, workspaceId } = await login(cfg);
  const data = await authedGet<{
    list: DjiMediaFile[];
    pagination: { total: number };
  }>(
    cfg,
    token,
    `/media/api/v1/files/${workspaceId}/files?page=${page}&page_size=${pageSize}`,
  );
  return { list: data.list, total: data.pagination?.total ?? data.list.length };
}

/**
 * Resolves a media file's actual download URL. The platform's own endpoint
 * (`GET media/api/v1/files/{workspace_id}/file/{file_id}/url`) responds
 * with an HTTP redirect rather than a JSON body — fetched here with
 * redirects disabled so the `Location` header (the real, presigned object
 * URL) can be handed back to the frontend to link to directly instead of
 * proxying the file's bytes through this server.
 */
export async function getMediaFileDownloadUrl(
  fileId: string,
  userId?: string,
): Promise<string> {
  const cfg = resolveConfig(userId);
  if (!cfg) throw new Error("DJI Cloud není nakonfigurován");
  const { token, workspaceId } = await login(cfg);
  const res = await fetch(
    `${cfg.url}/media/api/v1/files/${workspaceId}/file/${encodeURIComponent(fileId)}/url`,
    { headers: { "x-auth-token": token }, redirect: "manual" },
  );
  const location = res.headers.get("location");
  if (!location) {
    throw new Error("DJI Cloud nevrátil URL pro stažení souboru");
  }
  return location;
}

/** One selectable video feed (a specific lens on a specific camera). Neither
 * `id` nor `index` is a usable stream identifier: `id` is a fresh random
 * UUID the platform's own reference backend fills in on every capacity
 * report, unrelated to the actual video, and `index` is reported identically
 * for every lens on a payload (e.g. an M4T's wide and normal entries both
 * come back `"normal-0"`) — only `type` actually distinguishes them. The
 * real `video_id` `startLiveStream`/`stopLiveStream` expect is
 * `{droneSn}/{payloadIndex}/{videoType}-0` (see `VideoId.java`'s
 * constructor), assembled by the frontend from the parent device's `sn`,
 * the parent camera's `index`, and this video's own `type` field. */
export interface DjiLiveVideo {
  id: string;
  index: string;
  type: string;
}

export interface DjiLiveCapableCamera {
  id: string;
  device_sn: string;
  name: string;
  index: string;
  type: string;
  videos_list: DjiLiveVideo[];
}

export interface DjiLiveCapacityDevice {
  sn: string;
  name: string;
  cameras_list: DjiLiveCapableCamera[];
}

/**
 * Lists which of the workspace's devices can currently push a live video
 * feed, and the exact `video_id` values `startLiveStream` needs — the
 * platform derives this from which devices are online, so it's empty
 * whenever nothing is connected. `GET manage/api/v1/live/capacity`.
 */
export async function listLiveCapacity(
  userId?: string,
): Promise<DjiLiveCapacityDevice[]> {
  const cfg = resolveConfig(userId);
  if (!cfg) throw new Error("DJI Cloud není nakonfigurován");
  const { token, workspaceId } = await login(cfg);
  return authedGet<DjiLiveCapacityDevice[]>(
    cfg,
    token,
    `/manage/api/v1/live/capacity?workspace_id=${workspaceId}`,
  );
}

async function authedPost(
  cfg: DjiCloudConfig,
  token: string,
  path: string,
  body: unknown,
): Promise<void> {
  const res = await fetch(`${cfg.url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-auth-token": token },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`DJI Cloud požadavek selhal (HTTP ${res.status})`);
  }
  const responseBody = (await res.json()) as DjiApiResponse<unknown>;
  if (responseBody.code !== 0) {
    throw new Error(`DJI Cloud požadavek selhal: ${responseBody.message}`);
  }
}

/**
 * Builds the browser-playable HLS URL for a stream, IF the deployment has
 * `DJI_CLOUD_LIVE_HLS_BASE_URL` configured — pointing at an RTMP-in/HLS-out
 * relay (this project's own hetzner-ml test stack runs MediaMTX for this;
 * see its docker-compose notes) that the aircraft's RTMP push lands on.
 * Optional and separate from the three required DJI_CLOUD_* vars: starting
 * a live feed still works without it (the aircraft still gets commanded to
 * push video), there's just no URL here for the frontend to play — a
 * self-hosted deployment without the same relay add-on degrades to "the
 * feed exists somewhere" rather than crashing.
 *
 * The path segment (`{droneSn}-{payloadIndex}`) must exactly match how the
 * DJI Cloud platform itself builds the RTMP push URL server-side
 * (`LiveStreamServiceImpl`: `rtmpUrl + droneSn + "-" + payloadIndex`) — the
 * aircraft is pushing to that path on the relay, so this has to construct
 * the identical stream key or it'd be watching an unrelated (nonexistent)
 * stream.
 */
function buildHlsUrl(videoId: string): string | null {
  const base = process.env.DJI_CLOUD_LIVE_HLS_BASE_URL?.replace(/\/+$/, "");
  if (!base) return null;
  const [droneSn, payloadIndex] = videoId.split("/");
  if (!droneSn || !payloadIndex) return null;
  return `${base}/${droneSn}-${payloadIndex}/index.m3u8`;
}

/**
 * True for the platform's own reference server bug where a live-start
 * command the aircraft genuinely accepted (its MQTT `services_reply` reports
 * `result: 0`, success) still fails at the REST layer, because the same
 * server crashes trying to deserialize part of that reply into its response
 * DTO — confirmed live: the aircraft's raw reply was `{"result":0,"output":
 * {"origin_video_id":[]}}`, and the platform's own logs show this exact
 * Jackson error immediately afterward, on the same request. The command
 * already reached the aircraft and it's already pushing RTMP to the relay
 * by the time this response arrives broken — failing the whole call here
 * would report "start failed" for a stream that's actually live. This
 * string is specific enough (Jackson's own internal wording) that it won't
 * false-positive on an unrelated real failure.
 */
function isKnownLiveStartReplyDeserializationBug(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("Cannot deserialize value of type") &&
    message.includes("START_OBJECT")
  );
}

/**
 * Starts pushing a live feed from the given camera to this server's own
 * relay (see docker-compose's `livestream.url.rtmp` config on the DJI
 * Cloud platform side — the aircraft/RC pushes RTMP to that fixed URL, not
 * one supplied per-call). `videoId` is the `{droneSn}/{payloadIndex}/{videoType}-0`
 * string the frontend assembles from a `listLiveCapacity` entry — see
 * `DjiLiveVideo`'s doc comment for why it can't just be one of the response's
 * own fields. `POST manage/api/v1/live/streams/start`.
 */
export async function startLiveStream(
  videoId: string,
  userId?: string,
): Promise<{ hlsUrl: string | null }> {
  const cfg = resolveConfig(userId);
  if (!cfg) throw new Error("DJI Cloud není nakonfigurován");
  const { token } = await login(cfg);
  try {
    await authedPost(cfg, token, "/manage/api/v1/live/streams/start", {
      video_id: videoId,
      url_type: 1, // RTMP (UrlTypeEnum: 0=Agora, 1=RTMP, 2=RTSP, 3=GB28181, 4=WHIP) — see the note above about the relay's fixed push URL
      video_quality: 0, // VideoQualityEnum.AUTO
    });
  } catch (err) {
    if (!isKnownLiveStartReplyDeserializationBug(err)) throw err;
  }
  return { hlsUrl: buildHlsUrl(videoId) };
}

/** Stops a live feed previously started with `startLiveStream`. `POST manage/api/v1/live/streams/stop`. */
export async function stopLiveStream(
  videoId: string,
  userId?: string,
): Promise<void> {
  const cfg = resolveConfig(userId);
  if (!cfg) throw new Error("DJI Cloud není nakonfigurován");
  const { token } = await login(cfg);
  await authedPost(cfg, token, "/manage/api/v1/live/streams/stop", {
    video_id: videoId,
  });
}

/**
 * Uploads several segment KMZs into the workspace under a single login.
 * Segments are uploaded sequentially (the platform's object storage
 * duplicate-check isn't safe to hammer concurrently). If one fails partway
 * through, every segment already uploaded stays in the library and a
 * `PartialSegmentUploadError` carries the count that succeeded.
 */
export async function uploadSegmentsToDjiCloud(
  segments: { name: string; kmz: Buffer }[],
  userId?: string,
): Promise<{ count: number }> {
  const cfg = resolveConfig(userId);
  if (!cfg) {
    throw new Error("DJI Cloud není nakonfigurován");
  }
  const { token, workspaceId } = await login(cfg);

  let count = 0;
  for (const segment of segments) {
    try {
      await uploadOne(cfg, token, workspaceId, segment.name, segment.kmz);
    } catch (err) {
      // A failure after the first segment means some legs are already in
      // the library — surface how many so the caller doesn't imply a
      // clean no-op. A failure on the very first segment (count === 0)
      // rethrows as-is: nothing uploaded, no partial state to report.
      if (count === 0) throw err;
      throw new PartialSegmentUploadError(count, segments.length);
    }
    count++;
  }
  return { count };
}
