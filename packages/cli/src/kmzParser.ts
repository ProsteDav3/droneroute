import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

/**
 * Minimal, CLI-local port of the backend's KMZ → mission-JSON parser
 * (packages/backend/src/services/kmzParser.ts). Duplicated rather than
 * imported because `@droneroute/shared` and the backend package are
 * private workspace-only packages — the CLI is published standalone to
 * npm (`@prostedav3/droneroute`) and can't depend on them at install time.
 *
 * Only the fields the `/api/dji-cloud/upload` endpoint actually reads
 * (config, waypoints, pois) are reproduced here. Keep this in sync with
 * the backend parser if the WPML fields it reads change.
 */

export interface ParsedWaypoint {
  index: number;
  name: string;
  latitude: number;
  longitude: number;
  height: number;
  speed: number;
  useGlobalSpeed: boolean;
  useGlobalHeight: boolean;
  useGlobalHeadingParam: boolean;
  useGlobalTurnParam: boolean;
  gimbalPitchAngle: number;
  headingMode?: string;
  headingAngle?: number;
  turnMode?: string;
  turnDampingDist?: number;
  poiId?: string;
  actions: Array<{ actionId: number; actionType: string; params: unknown }>;
}

export interface ParsedPoi {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  height: number;
}

export interface ParsedMissionConfig {
  droneEnumValue: number;
  droneSubEnumValue: number;
  payloadEnumValue: number;
  flyToWaylineMode: string;
  finishAction: string;
  exitOnRCLost: string;
  executeRCLostAction: string;
  takeOffSecurityHeight: number;
  globalTransitionalSpeed: number;
  autoFlightSpeed: number;
  heightMode: string;
  globalHeadingMode: string;
  globalTurnMode: string;
  gimbalPitchMode: string;
}

export interface ParsedKmz {
  config: ParsedMissionConfig;
  waypoints: ParsedWaypoint[];
  pois: ParsedPoi[];
}

/**
 * Maximum accepted size for the raw (compressed) KMZ file, and independently
 * for each decompressed zip entry we read. Matches the server's multer
 * upload limit (packages/backend/src/routes/kmz.ts) for consistency.
 *
 * Before this parser existed, the CLI never decompressed KMZ contents — it
 * just streamed the raw bytes over ADB. Since `--cloud` is the first code
 * path that inflates archive entries into memory, a crafted KMZ with a tiny
 * compressed size but a huge declared/actual decompressed size (a zip bomb)
 * could otherwise OOM the user's own machine. Both the whole-file size and
 * each entry's actual decompressed byte count (checked while streaming, not
 * trusted from zip metadata) are capped below.
 */
export const MAX_KMZ_FILE_SIZE = 50 * 1024 * 1024;

/** Raised when the input file or a decompressed zip entry exceeds `MAX_KMZ_FILE_SIZE`. */
export class KmzTooLargeError extends Error {}

const DEFAULT_CONFIG: ParsedMissionConfig = {
  droneEnumValue: 99,
  droneSubEnumValue: 1,
  payloadEnumValue: 89,
  flyToWaylineMode: "safely",
  finishAction: "goHome",
  exitOnRCLost: "executeLostAction",
  executeRCLostAction: "goBack",
  takeOffSecurityHeight: 20,
  globalTransitionalSpeed: 10,
  autoFlightSpeed: 7,
  heightMode: "aboveGroundLevel",
  globalHeadingMode: "followWayline",
  globalTurnMode: "toPointAndStopWithDiscontinuityCurvature",
  gimbalPitchMode: "usePointSetting",
};

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: false,
  isArray: (name) =>
    name === "Placemark" ||
    name === "wpml:actionGroup" ||
    name === "wpml:action",
});

function extractCoords(coordStr: string): {
  longitude: number;
  latitude: number;
} {
  const parts = coordStr.split(",").map((s) => parseFloat(s.trim()));
  return { longitude: parts[0], latitude: parts[1] };
}

/**
 * Read a zip entry as UTF-8 text, aborting once the decompressed byte count
 * exceeds `maxBytes`. Streams rather than trusting the zip's declared
 * uncompressed size (which a malicious archive could misreport) — the cap
 * is enforced against bytes actually produced by the decompressor.
 */
function readZipEntryText(
  entry: JSZip.JSZipObject,
  maxBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const stream = entry.nodeStream();

    stream.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        // JSZip types `nodeStream()` as the minimal `NodeJS.ReadableStream`
        // interface, which doesn't declare `destroy()` — but the concrete
        // object returned at runtime is a real `stream.Readable`, which does.
        (stream as unknown as { destroy: () => void }).destroy();
        reject(
          new KmzTooLargeError(
            `KMZ entry "${entry.name}" exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB decompressed size limit`,
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", (err: Error) => reject(err));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

function parseActions(placemark: any): ParsedWaypoint["actions"] {
  const groups = placemark["wpml:actionGroup"];
  if (!groups) return [];

  const actions: ParsedWaypoint["actions"] = [];
  for (const group of groups) {
    const groupActions = group["wpml:action"] || [];
    for (const action of groupActions) {
      actions.push({
        actionId: parseInt(action["wpml:actionId"] || "0"),
        actionType: action["wpml:actionActuatorFunc"],
        params: action["wpml:actionActuatorFuncParam"] || {},
      });
    }
  }
  return actions;
}

/**
 * Parse a DJI WPML KMZ file's buffer into the mission JSON shape the
 * backend's `/api/dji-cloud/upload` endpoint expects (`config`, `waypoints`,
 * `pois`). Throws if the KMZ is missing its `template.kml` entry.
 */
export async function parseKmzToMissionJson(
  buffer: Buffer,
): Promise<ParsedKmz> {
  if (buffer.byteLength > MAX_KMZ_FILE_SIZE) {
    throw new KmzTooLargeError(
      `KMZ file is too large (max ${Math.round(MAX_KMZ_FILE_SIZE / 1024 / 1024)} MB)`,
    );
  }

  const zip = await JSZip.loadAsync(buffer);

  const templateFile =
    zip.file("template.kml") || zip.file("wpmz/template.kml");
  if (!templateFile) {
    throw new Error("Invalid KMZ: missing template.kml");
  }

  const templateXml = await readZipEntryText(templateFile, MAX_KMZ_FILE_SIZE);
  const parsed = parser.parse(templateXml);
  const doc = parsed.kml.Document;

  const mc = doc["wpml:missionConfig"] || {};
  const droneInfo = mc["wpml:droneInfo"] || {};
  const payloadInfo = mc["wpml:payloadInfo"] || {};

  const config: ParsedMissionConfig = {
    ...DEFAULT_CONFIG,
    droneEnumValue: parseInt(
      droneInfo["wpml:droneEnumValue"] || String(DEFAULT_CONFIG.droneEnumValue),
    ),
    droneSubEnumValue: parseInt(
      droneInfo["wpml:droneSubEnumValue"] ||
        String(DEFAULT_CONFIG.droneSubEnumValue),
    ),
    payloadEnumValue: parseInt(
      payloadInfo["wpml:payloadEnumValue"] ||
        String(DEFAULT_CONFIG.payloadEnumValue),
    ),
    flyToWaylineMode:
      mc["wpml:flyToWaylineMode"] || DEFAULT_CONFIG.flyToWaylineMode,
    finishAction: mc["wpml:finishAction"] || DEFAULT_CONFIG.finishAction,
    exitOnRCLost: mc["wpml:exitOnRCLost"] || DEFAULT_CONFIG.exitOnRCLost,
    executeRCLostAction:
      mc["wpml:executeRCLostAction"] || DEFAULT_CONFIG.executeRCLostAction,
    takeOffSecurityHeight: parseFloat(
      mc["wpml:takeOffSecurityHeight"] ||
        String(DEFAULT_CONFIG.takeOffSecurityHeight),
    ),
    globalTransitionalSpeed: parseFloat(
      mc["wpml:globalTransitionalSpeed"] ||
        String(DEFAULT_CONFIG.globalTransitionalSpeed),
    ),
  };

  let folder = doc.Folder;

  if (!folder) {
    const waylinesFile =
      zip.file("waylines.wpml") || zip.file("wpmz/waylines.wpml");
    if (waylinesFile) {
      const waylinesXml = await readZipEntryText(
        waylinesFile,
        MAX_KMZ_FILE_SIZE,
      );
      const waylinesParsed = parser.parse(waylinesXml);
      folder = waylinesParsed.kml?.Document?.Folder;
    }
  }

  if (folder) {
    config.autoFlightSpeed = parseFloat(
      folder["wpml:autoFlightSpeed"] || String(DEFAULT_CONFIG.autoFlightSpeed),
    );
    config.gimbalPitchMode =
      folder["wpml:gimbalPitchMode"] || config.gimbalPitchMode;
    config.globalTurnMode =
      folder["wpml:globalWaypointTurnMode"] || config.globalTurnMode;

    const headingParam = folder["wpml:globalWaypointHeadingParam"];
    if (headingParam) {
      config.globalHeadingMode =
        headingParam["wpml:waypointHeadingMode"] || config.globalHeadingMode;
    }

    const coordSys = folder["wpml:waylineCoordinateSysParam"];
    if (coordSys?.["wpml:heightMode"]) {
      config.heightMode = coordSys["wpml:heightMode"];
    } else if (folder["wpml:executeHeightMode"]) {
      config.heightMode = folder["wpml:executeHeightMode"];
    }
  }

  const placemarks: any[] = folder?.Placemark || [];
  const poiMap = new Map<string, ParsedPoi>();

  const waypoints: ParsedWaypoint[] = placemarks.map((pm: any, i: number) => {
    if (!pm.Point?.coordinates) {
      throw new Error(
        `Invalid KMZ: waypoint ${i + 1} is missing its <Point> coordinates`,
      );
    }
    const coords = extractCoords(pm.Point.coordinates);
    const actions = parseActions(pm);

    const headingParam = pm["wpml:waypointHeadingParam"];
    let headingMode: string | undefined;
    let headingAngle: number | undefined;
    let poiId: string | undefined;

    if (headingParam) {
      headingMode = headingParam["wpml:waypointHeadingMode"];
      headingAngle =
        headingParam["wpml:waypointHeadingAngle"] != null
          ? parseFloat(headingParam["wpml:waypointHeadingAngle"])
          : undefined;
      const poiPoint = headingParam["wpml:waypointPoiPoint"];
      if (headingMode === "towardPOI" && poiPoint) {
        const poiKey = String(poiPoint);
        if (!poiMap.has(poiKey)) {
          const parts = poiKey.split(",").map((s) => parseFloat(s.trim()));
          poiMap.set(poiKey, {
            id: randomUUID(),
            name: `POI ${poiMap.size + 1}`,
            latitude: parts[0],
            longitude: parts[1],
            height: Math.round(parts[2] || 0),
          });
        }
        poiId = poiMap.get(poiKey)!.id;
      }
    }

    const turnParam = pm["wpml:waypointTurnParam"];
    const turnMode = turnParam?.["wpml:waypointTurnMode"];
    const turnDampingDist =
      turnParam?.["wpml:waypointTurnDampingDist"] != null
        ? parseFloat(turnParam["wpml:waypointTurnDampingDist"])
        : undefined;

    const height = Math.round(
      parseFloat(
        pm["wpml:executeHeight"] ||
          pm["wpml:height"] ||
          pm["wpml:ellipsoidHeight"] ||
          "50",
      ),
    );

    let gimbalPitchAngle =
      pm["wpml:gimbalPitchAngle"] != null
        ? parseFloat(pm["wpml:gimbalPitchAngle"])
        : undefined;
    if (gimbalPitchAngle == null) {
      const gimbalAction = actions.find((a) => a.actionType === "gimbalRotate");
      const gimbalParams = gimbalAction?.params as any;
      if (gimbalParams?.["wpml:gimbalPitchRotateAngle"] != null) {
        gimbalPitchAngle = parseFloat(
          gimbalParams["wpml:gimbalPitchRotateAngle"],
        );
      }
    }

    const wpIndex = pm["wpml:index"] != null ? parseInt(pm["wpml:index"]) : i;

    return {
      index: wpIndex,
      name: `Waypoint ${wpIndex + 1}`,
      latitude: coords.latitude,
      longitude: coords.longitude,
      height,
      speed: parseFloat(
        pm["wpml:waypointSpeed"] || String(config.autoFlightSpeed),
      ),
      useGlobalSpeed:
        pm["wpml:useGlobalSpeed"] === "1" || pm["wpml:useGlobalSpeed"] === 1,
      useGlobalHeight:
        pm["wpml:useGlobalHeight"] === "1" || pm["wpml:useGlobalHeight"] === 1,
      useGlobalHeadingParam:
        pm["wpml:useGlobalHeadingParam"] === "1" ||
        pm["wpml:useGlobalHeadingParam"] === 1,
      useGlobalTurnParam:
        pm["wpml:useGlobalTurnParam"] === "1" ||
        pm["wpml:useGlobalTurnParam"] === 1,
      gimbalPitchAngle: gimbalPitchAngle ?? -45,
      headingMode,
      headingAngle,
      turnMode,
      turnDampingDist,
      poiId,
      actions,
    };
  });

  const pois = Array.from(poiMap.values());

  return { config, waypoints, pois };
}
