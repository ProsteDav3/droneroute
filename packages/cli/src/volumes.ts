import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { DjiAppKind } from "./device.js";
import { FLY_WAYPOINT_PATH, PILOT_MISSION_PATH } from "./constants.js";

/** A DJI controller detected via a mounted filesystem. */
export interface MountedDevice {
  /** Human-readable label, e.g. "SD card (/Volumes/DJI_RC)". */
  label: string;
  /** Which DJI app's mission folder was found. */
  appKind: DjiAppKind;
  /** Full path to the mission directory on the mounted volume. */
  waypointPath: string;
  /** Mount point root. */
  mountPoint: string;
}

/** Candidate mission directories to probe, in priority order, per app. */
const CANDIDATE_PATHS: { appKind: DjiAppKind; relPath: string }[] = [
  { appKind: "fly", relPath: FLY_WAYPOINT_PATH },
  { appKind: "pilot2", relPath: PILOT_MISSION_PATH },
];

/**
 * Scan all plausible mount points for volumes that contain a known DJI
 * mission directory structure (DJI Fly or DJI Pilot 2).
 */
export function findMountedDevices(): MountedDevice[] {
  const roots = getMountRoots();
  const devices: MountedDevice[] = [];

  for (const root of roots) {
    for (const { appKind, relPath } of CANDIDATE_PATHS) {
      const waypointPath = path.join(root, relPath);

      try {
        const stat = fs.statSync(waypointPath);
        if (stat.isDirectory()) {
          const name = path.basename(root);
          devices.push({
            label: `${name} (${root})`,
            appKind,
            waypointPath,
            mountPoint: root,
          });
          // A mount root belongs to one connected app at a time — don't
          // also probe the other candidate path once one has matched.
          break;
        }
      } catch {
        // Path doesn't exist — try the next candidate
      }
    }
  }

  return devices;
}

/**
 * Return a list of mount-point roots to probe, depending on the platform.
 */
function getMountRoots(): string[] {
  const platform = os.platform();

  if (platform === "darwin") {
    return listSubdirs("/Volumes");
  }

  if (platform === "linux") {
    const user = os.userInfo().username;
    return [
      ...listSubdirs("/media"),
      ...listSubdirs(`/media/${user}`),
      ...listSubdirs("/mnt"),
      ...listSubdirs(`/run/media/${user}`),
    ];
  }

  if (platform === "win32") {
    // Check drive letters D: through Z:. Note: a controller connected in
    // MTP mode (the default for most DJI RC units, including DJI RC Plus
    // 2 in our own testing) does NOT get a drive letter on Windows at
    // all — it only shows up under "This PC" via the MTP shell namespace,
    // which Node's fs module can't read directly. On Windows, adb
    // detection (see device.ts) is the reliable path for those
    // controllers; this drive-letter scan only helps when a controller
    // mounts as plain USB mass storage (e.g. an inserted SD card via a
    // card reader) or exposes a mass-storage mode.
    const drives: string[] = [];
    for (let code = 68; code <= 90; code++) {
      const letter = `${String.fromCharCode(code)}:\\`;
      try {
        fs.accessSync(letter, fs.constants.R_OK);
        drives.push(letter);
      } catch {
        // Drive not available
      }
    }
    return drives;
  }

  return [];
}

/**
 * List immediate subdirectories of a directory, returning their full paths.
 * Returns an empty array if the directory doesn't exist.
 */
function listSubdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d: fs.Dirent) => d.isDirectory() || d.isSymbolicLink())
      .map((d: fs.Dirent) => path.join(dir, d.name));
  } catch {
    return [];
  }
}
