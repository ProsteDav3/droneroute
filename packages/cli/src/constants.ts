/**
 * DJI controller paths and known device identifiers.
 */

/** Relative waypoint directory for DJI Fly (RC / RC 2 / RC Pro / RC-N1/N2). */
export const FLY_WAYPOINT_PATH = "Android/data/dji.go.v5/files/waypoint";

/** Absolute DJI Fly waypoint path as seen via adb shell. */
export const ADB_FLY_WAYPOINT_PATH = `/sdcard/${FLY_WAYPOINT_PATH}`;

/**
 * Relative mission-import directory for DJI Pilot 2 (the enterprise app
 * used by RC Plus / RC Plus 2 and similar controllers pairing with
 * M30/M300/M350/Matrice 4-series drones).
 *
 * Found by directly inspecting a DJI RC Plus 2's internal storage over
 * USB (`DJI/Mission/KML/`, marked with a `.nomedia` file — the standard
 * Android convention for "don't index this as media"). DJI hasn't
 * published this path, and the folder was empty at inspection time (no
 * existing mission to confirm the exact expected filename convention), so
 * treat this as a best-effort placement rather than a confirmed spec:
 * unlike DJI Fly's documented `<uuid>/<uuid>.KMZ` subfolder convention,
 * this places a flat, sanitized-name KMZ file directly in the folder.
 * Verify on real hardware before relying on it operationally.
 */
export const PILOT_MISSION_PATH = "DJI/Mission/KML";

/** Absolute DJI Pilot 2 mission path as seen via adb shell. */
export const ADB_PILOT_MISSION_PATH = `/sdcard/${PILOT_MISSION_PATH}`;

/**
 * Substrings that may appear in the `model:` or `device:` field of
 * `adb devices -l` output for known DJI RC controllers running DJI Fly.
 *
 * We intentionally keep this list broad — the real gate is whether the
 * waypoint directory exists on the device.
 */
export const DJI_FLY_MODEL_HINTS = [
  "DJI_RC",
  "RM500", // DJI RC
  "RM510", // DJI RC Motion
  "RM520", // DJI RC-N1
  "RM530", // DJI RC Pro
  "RC231", // DJI RC 2
  "RC232", // DJI RC Pro 2
  "RC-N1",
  "RC-N2",
];

/**
 * Substrings that may appear in the `model:`/`device:` field of
 * `adb devices -l` output for known DJI enterprise controllers running
 * DJI Pilot 2. Unverified against real `adb devices -l` output (no
 * confirmed model string for RC Plus 2 at the time this was written) —
 * kept broad for the same reason as `DJI_FLY_MODEL_HINTS`, and again, the
 * real gate is whether the mission directory exists on the device.
 */
export const DJI_PILOT2_MODEL_HINTS = ["RC PLUS", "RC-PLUS", "RCPLUS"];

/** File extension used by DJI Fly / DJI Pilot 2 for waypoint missions. */
export const KMZ_EXTENSION = ".KMZ";
