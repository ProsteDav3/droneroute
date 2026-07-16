/**
 * Bridge to a DJI Cloud API platform (the self-hosted stack DJI Pilot 2
 * connects to via its "Open Platforms" cloud service) — uploads generated
 * mission KMZ files into the platform's wayline library so they appear in
 * the RC's Cloud tab without any manual file transfer.
 *
 * Configured entirely through environment variables; when they're absent
 * the feature is disabled and the UI hides its button:
 * - DJI_CLOUD_URL       e.g. https://dji-cloud.example.com (no trailing /)
 * - DJI_CLOUD_USERNAME  a web (user_type 1) account on the platform
 * - DJI_CLOUD_PASSWORD
 */

interface DjiCloudConfig {
  url: string;
  username: string;
  password: string;
}

/** Read at call time (not module load) so tests can stub the env. */
function readConfig(): DjiCloudConfig | null {
  const url = process.env.DJI_CLOUD_URL?.replace(/\/+$/, "");
  const username = process.env.DJI_CLOUD_USERNAME;
  const password = process.env.DJI_CLOUD_PASSWORD;
  if (!url || !username || !password) return null;
  return { url, username, password };
}

export function isDjiCloudConfigured(): boolean {
  return readConfig() !== null;
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
}

/**
 * Lists devices (aircraft + RCs) bound to the configured workspace, per the
 * platform's `/manage/api/v1/devices/{workspace_id}/devices/bound` endpoint
 * (paginated; a workspace realistically has a handful of devices, so the
 * first page is fetched with a generous size rather than implementing full
 * pagination here).
 */
export async function listBoundDevices(): Promise<DjiDeviceSummary[]> {
  const cfg = readConfig();
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
  device_sn: string;
  key: string;
  level: number;
  module: number;
  create_time: number;
  args?: Record<string, string>;
}

/**
 * Fetches recent Health Management System (HMS) messages for the
 * workspace's devices — aircraft-reported warnings/errors (e.g. gimbal
 * fault, low battery cell imbalance), surfaced so a pilot can see them
 * before a flight instead of only in DJI Pilot 2's own UI.
 */
export async function listHmsMessages(): Promise<DjiHmsMessage[]> {
  const cfg = readConfig();
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
export async function listWaylineJobs(): Promise<DjiWaylineJob[]> {
  const cfg = readConfig();
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
  const cfg = readConfig();
  if (!cfg) return null;
  const session = await login(cfg);
  if (!session.mqttUsername || !session.mqttPassword) return null;
  return {
    url: cfg.url,
    username: session.mqttUsername,
    password: session.mqttPassword,
  };
}

/**
 * Deletes a wayline file from the workspace's library (e.g. to clean up a
 * timestamped duplicate created by a retried upload, or a mission that's
 * no longer needed) — `/wayline/api/v1/workspaces/{workspace_id}/waylines/{id}`.
 */
export async function deleteWayline(waylineId: string): Promise<void> {
  const cfg = readConfig();
  if (!cfg) throw new Error("DJI Cloud není nakonfigurován");
  const { token, workspaceId } = await login(cfg);
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
 * Uploads one KMZ into an already-authenticated workspace, retrying once
 * under a timestamped name if the platform rejects the first attempt as a
 * duplicate (its object storage refuses to overwrite an existing file of
 * the same name). Returns the wayline name it was actually stored under.
 */
async function uploadOne(
  cfg: DjiCloudConfig,
  token: string,
  workspaceId: string,
  name: string,
  kmz: Buffer,
): Promise<string> {
  const baseName =
    name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "mission";

  const first = await uploadFile(
    cfg,
    token,
    workspaceId,
    `${baseName}.kmz`,
    kmz,
  );
  if (first.code === 0) return baseName;

  const retryName = `${baseName}-${timestampSuffix()}`;
  const second = await uploadFile(
    cfg,
    token,
    workspaceId,
    `${retryName}.kmz`,
    kmz,
  );
  if (second.code === 0) return retryName;

  throw new Error(`DJI Cloud upload selhal: ${second.message}`);
}

/**
 * Uploads a mission KMZ into the configured DJI Cloud workspace's wayline
 * library. Returns the wayline name it was stored under.
 */
export async function uploadMissionToDjiCloud(
  missionName: string,
  kmz: Buffer,
): Promise<{ waylineName: string }> {
  const cfg = readConfig();
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

/**
 * Uploads several segment KMZs into the workspace under a single login.
 * Segments are uploaded sequentially (the platform's object storage
 * duplicate-check isn't safe to hammer concurrently). If one fails partway
 * through, every segment already uploaded stays in the library and a
 * `PartialSegmentUploadError` carries the count that succeeded.
 */
export async function uploadSegmentsToDjiCloud(
  segments: { name: string; kmz: Buffer }[],
): Promise<{ count: number }> {
  const cfg = readConfig();
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
