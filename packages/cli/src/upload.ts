import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { adbMkdir, adbPush } from "./adb.js";
import {
  KMZ_EXTENSION,
  ADB_FLY_WAYPOINT_PATH,
  ADB_PILOT_MISSION_PATH,
} from "./constants.js";
import type { DjiDevice } from "./device.js";

export interface UploadResult {
  /** DJI Fly: the generated mission UUID. DJI Pilot 2: the destination filename. */
  uuid: string;
  remotePath: string;
}

/** Sanitize a filename for a Pilot 2 upload — keep the original name recognizable. */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

/**
 * Upload a KMZ file to the selected DJI controller.
 *
 * DJI Fly: creates a new UUID-named mission folder and places the KMZ
 * file inside it with the matching UUID filename, so DJI Fly picks it up
 * as a new mission — this convention is well-documented/reverse-engineered
 * by the community.
 *
 * DJI Pilot 2: places a flat, sanitized-name KMZ file directly in the
 * mission-import folder (see `PILOT_MISSION_PATH` in constants.ts for why
 * this convention is a best-effort guess, not a confirmed spec) — open the
 * file from Pilot 2's own import/route-library UI rather than expecting it
 * to appear automatically like DJI Fly's missions do.
 */
export function uploadKmz(device: DjiDevice, kmzPath: string): UploadResult {
  if (device.appKind === "pilot2") {
    const filename = sanitizeFilename(path.basename(kmzPath));

    if (device.type === "mounted") {
      const dest = path.join(device.waypointPath!, filename);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(kmzPath, dest);
      return { uuid: filename, remotePath: dest };
    }

    const remoteFile = `${ADB_PILOT_MISSION_PATH}/${filename}`;
    adbMkdir(device.serial!, ADB_PILOT_MISSION_PATH);
    adbPush(device.serial!, kmzPath, remoteFile);
    return { uuid: filename, remotePath: remoteFile };
  }

  // DJI Fly
  const uuid = randomUUID().toUpperCase();
  const filename = `${uuid}${KMZ_EXTENSION}`;

  if (device.type === "mounted") {
    const dir = path.join(device.waypointPath!, uuid);
    const dest = path.join(dir, filename);

    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(kmzPath, dest);

    return {
      uuid,
      remotePath: dest,
    };
  }

  // adb device
  const remoteDir = `${ADB_FLY_WAYPOINT_PATH}/${uuid}`;
  const remoteDest = `${remoteDir}/${filename}`;

  adbMkdir(device.serial!, remoteDir);
  adbPush(device.serial!, kmzPath, remoteDest);

  return {
    uuid,
    remotePath: remoteDest,
  };
}
