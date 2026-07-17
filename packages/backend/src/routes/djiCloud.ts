import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import type { Mission } from "@droneroute/shared";
import { generateKmzBuffer } from "../services/kmzGenerator.js";
import { buildMissionSegments } from "../services/missionSegments.js";
import {
  isDjiCloudConfigured,
  uploadMissionToDjiCloud,
  uploadSegmentsToDjiCloud,
  PartialSegmentUploadError,
  listBoundDevices,
  listHmsMessages,
  listWaylineJobs,
  deleteWayline,
} from "../services/djiCloud.js";
import {
  ensureTelemetryBridgeConnected,
  getTelemetrySnapshot,
  onTelemetryUpdate,
} from "../services/mqttTelemetry.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { globalLimiter, strictLimiter } from "../middleware/rateLimit.js";
import { validateMissionGeometry } from "../services/missionValidation.js";
import { logger } from "../lib/logger.js";

export const djiCloudRoutes = Router();

/** Shared "not configured" guard for every route below. */
function requireConfigured(res: import("express").Response): boolean {
  if (!isDjiCloudConfigured()) {
    res
      .status(503)
      .json({ error: "DJI Cloud není na tomto serveru nakonfigurován" });
    return false;
  }
  return true;
}

function buildMission(body: {
  name?: string;
  config: Mission["config"];
  waypoints: Mission["waypoints"];
  pois?: Mission["pois"];
}): Mission {
  return {
    id: uuidv4(),
    name: body.name || "mission",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    config: body.config,
    waypoints: body.waypoints,
    pois: body.pois || [],
    obstacles: [],
    buildings: [],
    templateGroups: {},
  };
}

/**
 * @openapi
 * /dji-cloud/upload:
 *   post:
 *     summary: Upload a mission directly into the configured DJI Cloud workspace
 *     description: >
 *       Requires sign-in — the server holds the cloud platform's service
 *       credentials, so an anonymous endpoint would let anyone fill the
 *       workspace with junk. Rate-limited (strictLimiter).
 *     tags: [DJI Cloud]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [config, waypoints]
 *             properties:
 *               name: { type: string }
 *               config: { type: object }
 *               waypoints:
 *                 type: array
 *                 minItems: 2
 *                 items: { type: object }
 *               pois: { type: array, items: { type: object } }
 *     responses:
 *       200:
 *         description: Uploaded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 waylineName: { type: string }
 *       400:
 *         description: Missing config/waypoints or invalid mission geometry
 *       502:
 *         description: Upload to the DJI Cloud platform failed
 *       503:
 *         description: DJI Cloud is not configured on this server
 */
// Upload the posted mission straight into the configured DJI Cloud
// workspace's wayline library (so it shows up in Pilot 2's Cloud tab).
// Requires login: the server holds service credentials for the cloud
// platform, and an anonymous endpoint would let anyone on the internet
// fill the workspace with junk.
djiCloudRoutes.post(
  "/upload",
  strictLimiter,
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      if (!isDjiCloudConfigured()) {
        res.status(503).json({
          error: "DJI Cloud není na tomto serveru nakonfigurován",
        });
        return;
      }

      const { name, config, waypoints, pois } = req.body;
      if (!config || !waypoints || waypoints.length < 2) {
        res
          .status(400)
          .json({ error: "Je vyžadována konfigurace a alespoň 2 body trasy" });
        return;
      }

      const geometryError = validateMissionGeometry({ waypoints, pois });
      if (geometryError) {
        res.status(400).json({ error: geometryError });
        return;
      }

      const mission = buildMission({ name, config, waypoints, pois });
      const buffer = await generateKmzBuffer(mission);
      const { waylineName } = await uploadMissionToDjiCloud(
        mission.name,
        buffer,
      );

      res.json({ waylineName });
    } catch (err) {
      // Full detail stays server-side only -- the upstream platform's raw
      // response text must never reach the client (AGENTS.md policy).
      logger.error({ err }, "DJI Cloud upload error");
      res.status(502).json({ error: "Nahrání do DJI Cloud selhalo" });
    }
  },
);

/**
 * @openapi
 * /dji-cloud/upload-segments:
 *   post:
 *     summary: Split a mission into one-leg segments and upload each as its own wayline
 *     description: >
 *       Same auth/config/validation contract as `/dji-cloud/upload`. On a
 *       partial failure, the error response includes how many legs already
 *       uploaded so the client doesn't blindly retry and duplicate them.
 *     tags: [DJI Cloud]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [config, waypoints]
 *             properties:
 *               name: { type: string }
 *               config: { type: object }
 *               waypoints:
 *                 type: array
 *                 minItems: 2
 *                 items: { type: object }
 *               pois: { type: array, items: { type: object } }
 *     responses:
 *       200:
 *         description: All segments uploaded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count: { type: integer }
 *       400:
 *         description: Missing config/waypoints or invalid mission geometry
 *       502:
 *         description: >
 *           Upload failed, possibly partially — response may include
 *           `uploaded` and `total` counts.
 *       503:
 *         description: DJI Cloud is not configured on this server
 */
// Split the mission into consecutive one-leg segments (WP1→WP2, ...) and
// upload every leg into the workspace as its own wayline — the cloud
// equivalent of the "Export segmentů" download. Same auth/config/validation
// contract as /upload.
djiCloudRoutes.post(
  "/upload-segments",
  strictLimiter,
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      if (!isDjiCloudConfigured()) {
        res.status(503).json({
          error: "DJI Cloud není na tomto serveru nakonfigurován",
        });
        return;
      }

      const { name, config, waypoints, pois } = req.body;
      if (!config || !waypoints || waypoints.length < 2) {
        res
          .status(400)
          .json({ error: "Je vyžadována konfigurace a alespoň 2 body trasy" });
        return;
      }

      const geometryError = validateMissionGeometry({ waypoints, pois });
      if (geometryError) {
        res.status(400).json({ error: geometryError });
        return;
      }

      const mission = buildMission({ name, config, waypoints, pois });
      const segments = buildMissionSegments(mission);
      const kmzSegments = await Promise.all(
        segments.map(async (segment) => ({
          name: segment.name,
          kmz: await generateKmzBuffer(segment),
        })),
      );
      const { count } = await uploadSegmentsToDjiCloud(kmzSegments);

      res.json({ count });
    } catch (err) {
      logger.error({ err }, "DJI Cloud segments upload error");
      // Surface a partial-success count so the user knows some legs are
      // already in the workspace (avoids a redundant re-upload) — but never
      // the upstream platform's raw message (AGENTS.md policy).
      if (err instanceof PartialSegmentUploadError) {
        res.status(502).json({
          error: "Nahrání segmentů do DJI Cloud se nezdařilo dokončit",
          uploaded: err.uploaded,
          total: err.total,
        });
        return;
      }
      res.status(502).json({ error: "Nahrání segmentů do DJI Cloud selhalo" });
    }
  },
);

// Devices bound to the workspace (aircraft/RCs) — read-only, so any signed-in
// user can see fleet status without needing admin rights.
djiCloudRoutes.get("/devices", authMiddleware, async (_req, res) => {
  try {
    if (!requireConfigured(res)) return;
    const devices = await listBoundDevices();
    res.json({ devices });
  } catch (err) {
    console.error("DJI Cloud device list error:", err);
    res.status(502).json({ error: "Načtení zařízení z DJI Cloud selhalo" });
  }
});

// Recent Health Management System messages (aircraft-reported warnings).
djiCloudRoutes.get("/hms", authMiddleware, async (_req, res) => {
  try {
    if (!requireConfigured(res)) return;
    const messages = await listHmsMessages();
    res.json({ messages });
  } catch (err) {
    console.error("DJI Cloud HMS error:", err);
    res.status(502).json({ error: "Načtení HMS zpráv z DJI Cloud selhalo" });
  }
});

// Wayline job history/status. Note: this platform only supports remotely
// *triggering* a flight via a DJI Dock (autonomous drone-in-a-box hardware)
// — a handheld RC can't be commanded to take off — so this bridge exposes
// job history/progress, not job creation.
djiCloudRoutes.get("/jobs", authMiddleware, async (_req, res) => {
  try {
    if (!requireConfigured(res)) return;
    const jobs = await listWaylineJobs();
    res.json({ jobs });
  } catch (err) {
    console.error("DJI Cloud jobs list error:", err);
    res.status(502).json({ error: "Načtení úloh z DJI Cloud selhalo" });
  }
});

// Removes a wayline from the workspace's library (e.g. a timestamped
// duplicate from a retried upload). Rate-limited like the upload routes —
// it's an authenticated, workspace-mutating call.
djiCloudRoutes.delete(
  "/waylines/:id",
  strictLimiter,
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      if (!requireConfigured(res)) return;
      const waylineId = req.params.id;
      if (typeof waylineId !== "string" || !waylineId) {
        res.status(400).json({ error: "Chybí ID wayline" });
        return;
      }
      await deleteWayline(waylineId);
      res.json({ success: true });
    } catch (err) {
      console.error("DJI Cloud wayline delete error:", err);
      res.status(502).json({ error: "Smazání z DJI Cloud selhalo" });
    }
  },
);

// Snapshot of every device's last-known telemetry (position/battery/status).
// Kicks off the MQTT bridge connection on first use rather than at server
// boot, so an unconfigured instance never opens an outbound connection.
djiCloudRoutes.get("/telemetry", authMiddleware, async (_req, res) => {
  if (!requireConfigured(res)) return;
  await ensureTelemetryBridgeConnected();
  res.json({ devices: getTelemetrySnapshot() });
});

// Server-Sent Events stream of live telemetry updates, so the map can show
// an aircraft moving in real time instead of only on manual refresh.
djiCloudRoutes.get(
  "/telemetry/stream",
  globalLimiter,
  authMiddleware,
  async (_req: AuthRequest, res) => {
    if (!requireConfigured(res)) return;
    await ensureTelemetryBridgeConnected();

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Send the current snapshot immediately so the client doesn't wait for
    // the next MQTT message to render anything.
    for (const device of getTelemetrySnapshot()) {
      res.write(`data: ${JSON.stringify(device)}\n\n`);
    }

    const unsubscribe = onTelemetryUpdate((record) => {
      res.write(`data: ${JSON.stringify(record)}\n\n`);
    });

    const heartbeat = setInterval(() => res.write(":\n\n"), 30_000);

    _req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  },
);
