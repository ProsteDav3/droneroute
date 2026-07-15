import { select } from "@inquirer/prompts";
import { isAdbAvailable, getAdbDevices, hasRemoteDir } from "./adb.js";
import { findMountedDevices } from "./volumes.js";
import {
  DJI_FLY_MODEL_HINTS,
  DJI_PILOT2_MODEL_HINTS,
  ADB_FLY_WAYPOINT_PATH,
  ADB_PILOT_MISSION_PATH,
} from "./constants.js";

/** Which DJI app's mission storage convention a device uses. */
export type DjiAppKind = "fly" | "pilot2";

/** Unified representation of a detected DJI controller. */
export interface DjiDevice {
  type: "mounted" | "adb";
  /** Which DJI app's mission folder this device exposes. */
  appKind: DjiAppKind;
  label: string;
  /** For mounted devices: full path to the mission directory. */
  waypointPath?: string;
  /** For adb devices: serial number. */
  serial?: string;
}

/**
 * Detect all connected DJI controllers by scanning mounted volumes and
 * querying adb. Returns a merged, deduplicated list.
 */
export function detectDevices(): DjiDevice[] {
  const devices: DjiDevice[] = [];

  // 1. Mounted volumes (always available, no external tooling)
  for (const vol of findMountedDevices()) {
    devices.push({
      type: "mounted",
      appKind: vol.appKind,
      label: vol.label,
      waypointPath: vol.waypointPath,
    });
  }

  // 2. adb devices (only if adb is installed)
  if (isAdbAvailable()) {
    for (const dev of getAdbDevices()) {
      const matchesHint = (hints: string[]) =>
        hints.some(
          (hint) =>
            dev.model.toUpperCase().includes(hint.toUpperCase()) ||
            dev.device.toUpperCase().includes(hint.toUpperCase()) ||
            dev.product.toUpperCase().includes(hint.toUpperCase()),
        );

      const looksLikeFly = matchesHint(DJI_FLY_MODEL_HINTS);
      const looksLikePilot2 = matchesHint(DJI_PILOT2_MODEL_HINTS);

      // The real gate is whether the mission directory exists — model
      // hints only help label a device before we've confirmed that.
      const hasFlyDir = hasRemoteDir(dev.serial, ADB_FLY_WAYPOINT_PATH);
      const hasPilot2Dir = hasRemoteDir(dev.serial, ADB_PILOT_MISSION_PATH);

      let appKind: DjiAppKind | null = null;
      if (hasFlyDir) appKind = "fly";
      else if (hasPilot2Dir) appKind = "pilot2";
      else if (looksLikeFly) appKind = "fly";
      else if (looksLikePilot2) appKind = "pilot2";

      if (appKind) {
        const label = dev.model
          ? `${dev.model.replace(/_/g, " ")} (adb: ${dev.serial})`
          : `Android device (adb: ${dev.serial})`;

        devices.push({
          type: "adb",
          appKind,
          label,
          serial: dev.serial,
        });
      }
    }
  }

  return devices;
}

/**
 * If there's exactly one device, return it. Otherwise prompt the user
 * to pick one.
 */
export async function selectDevice(devices: DjiDevice[]): Promise<DjiDevice> {
  if (devices.length === 1) {
    return devices[0];
  }

  return select({
    message: "Multiple DJI controllers found. Select one:",
    choices: devices.map((d) => ({
      name: d.label,
      value: d,
    })),
  });
}
