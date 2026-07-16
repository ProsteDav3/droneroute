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
}

interface DjiApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

async function login(
  cfg: DjiCloudConfig,
): Promise<{ token: string; workspaceId: string }> {
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
  return { token: body.data.access_token, workspaceId: body.data.workspace_id };
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

/**
 * Uploads a mission KMZ into the configured DJI Cloud workspace's wayline
 * library. Returns the wayline name it was stored under — normally the
 * sanitized mission name, with a time suffix appended only if the platform
 * rejects the first attempt as a duplicate (its object storage refuses to
 * overwrite an existing file of the same name).
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

  const baseName =
    missionName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "mission";

  const first = await uploadFile(
    cfg,
    token,
    workspaceId,
    `${baseName}.kmz`,
    kmz,
  );
  if (first.code === 0) {
    return { waylineName: baseName };
  }

  // Duplicate name (or any first-attempt rejection with a retryable
  // message) — retry once under a timestamped name so re-uploading an
  // updated mission never dead-ends on the previous upload.
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
  const retryName = `${baseName}-${stamp}`;
  const second = await uploadFile(
    cfg,
    token,
    workspaceId,
    `${retryName}.kmz`,
    kmz,
  );
  if (second.code === 0) {
    return { waylineName: retryName };
  }
  throw new Error(`DJI Cloud upload selhal: ${second.message}`);
}
