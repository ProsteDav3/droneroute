/**
 * Client for `POST /api/dji-cloud/upload` on a SkyRoute server — pushes a
 * mission straight into the server's configured DJI Cloud API platform
 * instead of transferring a KMZ file over ADB/USB.
 */

/** Mission payload shape expected by the backend's `/api/dji-cloud/upload` route. */
export interface CloudMissionPayload {
  name: string;
  config: unknown;
  waypoints: unknown[];
  pois: unknown[];
}

export interface CloudUploadResult {
  waylineName: string;
}

/** Raised for every failure mode of `uploadMissionToCloud` — always has a user-facing message. */
export class CloudUploadError extends Error {}

/**
 * Guard for the "no cached/passed auth token" case, which must be checked
 * before ever calling `uploadMissionToCloud` (that function requires a
 * token string, not `string | undefined`). Kept here — not just inline in
 * the CLI entrypoint — so the exact message is unit-testable without
 * exercising `process.exit`.
 */
export function ensureToken(token: string | undefined): string {
  if (!token) {
    throw new CloudUploadError(
      "No SkyRoute login found. Run `droneroute login` first, or pass --token <jwt> explicitly.",
    );
  }
  return token;
}

function normalizeServerUrl(server: string): string {
  return server.replace(/\/+$/, "");
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * POST a mission to the SkyRoute server's DJI Cloud upload endpoint.
 *
 * Throws `CloudUploadError` with a clear, user-facing message for every
 * failure mode: the token is missing (caller should check before calling
 * this), the server can't be reached at all (network error), the server has
 * no DJI Cloud platform configured (503), auth is invalid/expired (401/403),
 * or the upstream DJI Cloud platform rejected the upload (502 and other
 * non-2xx statuses).
 */
export async function uploadMissionToCloud(
  server: string,
  token: string,
  payload: CloudMissionPayload,
): Promise<CloudUploadResult> {
  const url = `${normalizeServerUrl(server)}/api/dji-cloud/upload`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CloudUploadError(
      `Could not reach the SkyRoute server at ${server}: ${message}`,
    );
  }

  const body = await safeJson(response);
  const serverMessage = typeof body.error === "string" ? body.error : undefined;

  if (response.status === 503) {
    throw new CloudUploadError(
      serverMessage || "This server has no DJI Cloud platform configured",
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new CloudUploadError(
      "Authentication failed. Run `droneroute login` again to refresh your token.",
    );
  }

  if (!response.ok) {
    throw new CloudUploadError(
      serverMessage || `Cloud upload failed (HTTP ${response.status})`,
    );
  }

  const waylineName = body.waylineName;
  if (typeof waylineName !== "string") {
    throw new CloudUploadError("Unexpected response from the SkyRoute server");
  }

  return { waylineName };
}
