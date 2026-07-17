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
  listWaylines,
  deleteWayline,
  listMediaFiles,
  getMediaFileDownloadUrl,
  listLiveCapacity,
  startLiveStream,
  stopLiveStream,
  linkDjiCloudAccount,
  unlinkDjiCloudAccount,
  getDjiCloudAccountStatus,
} from "../services/djiCloud.js";
import {
  ensureTelemetryBridgeConnected,
  getTelemetrySnapshot,
  onTelemetryUpdate,
} from "../services/mqttTelemetry.js";
import {
  startFlightTrackSession,
  stopFlightTrackSessionForDevice,
  isRecording,
  listFlightTrackSessions,
  getFlightTrackSession,
  getFlightTrackPoints,
  deleteFlightTrackSession,
} from "../services/flightTrack.js";
import { getDb } from "../models/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { globalLimiter, strictLimiter } from "../middleware/rateLimit.js";
import { validateMissionGeometry } from "../services/missionValidation.js";
import { logger } from "../lib/logger.js";

function isMissionOwnedByUser(missionId: string, userId: string): boolean {
  const mission = getDb()
    .prepare("SELECT user_id FROM missions WHERE id = ?")
    .get(missionId) as { user_id: string | null } | undefined;
  return !!mission && mission.user_id === userId;
}

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
        req.userId,
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
      const { count } = await uploadSegmentsToDjiCloud(kmzSegments, req.userId);

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
djiCloudRoutes.get(
  "/devices",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      if (!requireConfigured(res)) return;
      const devices = await listBoundDevices(req.userId);
      res.json({ devices });
    } catch (err) {
      logger.error({ err }, "DJI Cloud device list error");
      res.status(502).json({ error: "Načtení zařízení z DJI Cloud selhalo" });
    }
  },
);

// Recent Health Management System messages (aircraft-reported warnings).
djiCloudRoutes.get("/hms", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (!requireConfigured(res)) return;
    const messages = await listHmsMessages(req.userId);
    res.json({ messages });
  } catch (err) {
    logger.error({ err }, "DJI Cloud HMS error");
    res.status(502).json({ error: "Načtení HMS zpráv z DJI Cloud selhalo" });
  }
});

// Wayline job history/status. Note: this platform only supports remotely
// *triggering* a flight via a DJI Dock (autonomous drone-in-a-box hardware)
// — a handheld RC can't be commanded to take off — so this bridge exposes
// job history/progress, not job creation.
djiCloudRoutes.get("/jobs", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (!requireConfigured(res)) return;
    const jobs = await listWaylineJobs(req.userId);
    res.json({ jobs });
  } catch (err) {
    logger.error({ err }, "DJI Cloud jobs list error");
    res.status(502).json({ error: "Načtení úloh z DJI Cloud selhalo" });
  }
});

// Lists the KMZ files currently in the workspace's wayline library, for a
// management view (see listWaylines' own doc comment for the endpoint).
djiCloudRoutes.get(
  "/waylines",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      if (!requireConfigured(res)) return;
      const waylines = await listWaylines(req.userId);
      res.json({ waylines });
    } catch (err) {
      logger.error({ err }, "DJI Cloud waylines list error");
      res.status(502).json({ error: "Načtení waylines z DJI Cloud selhalo" });
    }
  },
);

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
      await deleteWayline(waylineId, req.userId);
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "DJI Cloud wayline delete error");
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

// Media files (photos/videos) already uploaded from a flight into the
// workspace's own storage — read-only, same as /devices and /waylines.
djiCloudRoutes.get("/media", authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (!requireConfigured(res)) return;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(
      50,
      Math.max(1, Number(req.query.pageSize) || 20),
    );
    const result = await listMediaFiles(page, pageSize, req.userId);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "DJI Cloud media list error");
    res.status(502).json({ error: "Načtení médií z DJI Cloud selhalo" });
  }
});

// Resolves one media file's download URL. Returns JSON (not a redirect)
// since the frontend just wants the URL to put in an <a href>, not to
// follow it server-side.
djiCloudRoutes.get(
  "/media/:fileId/url",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      if (!requireConfigured(res)) return;
      const fileId = req.params.fileId;
      if (typeof fileId !== "string" || !fileId) {
        res.status(400).json({ error: "Chybí ID souboru" });
        return;
      }
      const url = await getMediaFileDownloadUrl(fileId, req.userId);
      res.json({ url });
    } catch (err) {
      logger.error({ err }, "DJI Cloud media URL error");
      res.status(502).json({ error: "Načtení odkazu ke stažení selhalo" });
    }
  },
);

// Which devices/cameras can currently push a live feed — empty whenever
// nothing is online, same shape as /devices.
djiCloudRoutes.get(
  "/live/capacity",
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      if (!requireConfigured(res)) return;
      const devices = await listLiveCapacity(req.userId);
      res.json({ devices });
    } catch (err) {
      logger.error({ err }, "DJI Cloud live capacity error");
      res
        .status(502)
        .json({ error: "Načtení dostupných kamer z DJI Cloud selhalo" });
    }
  },
);

// Starts a live feed for the given video_id (see listLiveCapacity). The
// aircraft/RC pushes RTMP to this server's own relay — no external
// service/API key needed, unlike the platform's optional Agora option.
djiCloudRoutes.post(
  "/live/start",
  strictLimiter,
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      if (!requireConfigured(res)) return;
      const { videoId } = req.body;
      if (typeof videoId !== "string" || !videoId) {
        res.status(400).json({ error: "Chybí video_id" });
        return;
      }
      const { hlsUrl } = await startLiveStream(videoId, req.userId);
      res.json({ success: true, hlsUrl });
    } catch (err) {
      logger.error({ err }, "DJI Cloud live start error");
      res.status(502).json({ error: "Spuštění živého přenosu selhalo" });
    }
  },
);

djiCloudRoutes.post(
  "/live/stop",
  strictLimiter,
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      if (!requireConfigured(res)) return;
      const { videoId } = req.body;
      if (typeof videoId !== "string" || !videoId) {
        res.status(400).json({ error: "Chybí video_id" });
        return;
      }
      await stopLiveStream(videoId, req.userId);
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "DJI Cloud live stop error");
      res.status(502).json({ error: "Zastavení živého přenosu selhalo" });
    }
  },
);

// Flight track recording: this fleet has no DJI Dock, so there is no
// after-the-fact "wayline job" history to compare a plan against (see the
// /jobs route's doc comment) — instead the pilot starts recording before
// takeoff, the server appends live OSD telemetry points as they arrive, and
// stopping ends the session. The recorded points are then rendered as the
// "actually flown" path next to the planned route in the mission editor.
djiCloudRoutes.post(
  "/flight-track/start",
  strictLimiter,
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      if (!requireConfigured(res)) return;
      const { deviceSn, missionId } = req.body;
      if (typeof deviceSn !== "string" || !deviceSn) {
        res.status(400).json({ error: "Chybí deviceSn" });
        return;
      }
      if (missionId != null) {
        if (typeof missionId !== "string") {
          res.status(400).json({ error: "Neplatné missionId" });
          return;
        }
        if (!isMissionOwnedByUser(missionId, req.userId!)) {
          res.status(403).json({ error: "Nemáte oprávnění k této misi" });
          return;
        }
      }
      await ensureTelemetryBridgeConnected();
      const session = startFlightTrackSession(
        req.userId!,
        deviceSn,
        missionId ?? null,
      );
      res.json({ session });
    } catch (err) {
      logger.error({ err }, "Flight track start error");
      res.status(500).json({ error: "Spuštění nahrávání letu selhalo" });
    }
  },
);

djiCloudRoutes.post(
  "/flight-track/stop",
  strictLimiter,
  authMiddleware,
  (req: AuthRequest, res) => {
    const { deviceSn } = req.body;
    if (typeof deviceSn !== "string" || !deviceSn) {
      res.status(400).json({ error: "Chybí deviceSn" });
      return;
    }
    const activeSessionId = isRecording(deviceSn);
    if (!activeSessionId) {
      res.json({ success: true });
      return;
    }
    const session = getFlightTrackSession(activeSessionId);
    const owned = session
      ? session.missionId
        ? isMissionOwnedByUser(session.missionId, req.userId!)
        : session.userId === req.userId
      : false;
    if (!owned) {
      res.status(403).json({ error: "Nemáte oprávnění" });
      return;
    }
    stopFlightTrackSessionForDevice(deviceSn);
    res.json({ success: true });
  },
);

// Past recorded sessions for a mission (owner only).
djiCloudRoutes.get(
  "/flight-track/sessions",
  authMiddleware,
  (req: AuthRequest, res) => {
    const { missionId } = req.query;
    if (typeof missionId !== "string" || !missionId) {
      res.status(400).json({ error: "Parametr missionId je povinný" });
      return;
    }
    if (!isMissionOwnedByUser(missionId, req.userId!)) {
      res.status(403).json({ error: "Nemáte oprávnění k této misi" });
      return;
    }
    res.json({ sessions: listFlightTrackSessions(missionId) });
  },
);

// Track points for one recorded session (owner only, via the session's own
// mission ownership — sessions with no mission belong only to their creator).
djiCloudRoutes.get(
  "/flight-track/sessions/:id/points",
  authMiddleware,
  (req: AuthRequest, res) => {
    const sessionId = req.params.id;
    if (typeof sessionId !== "string" || !sessionId) {
      res.status(400).json({ error: "Chybí ID záznamu" });
      return;
    }
    const session = getFlightTrackSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "Záznam letu nebyl nalezen" });
      return;
    }
    const owned = session.missionId
      ? isMissionOwnedByUser(session.missionId, req.userId!)
      : session.userId === req.userId;
    if (!owned) {
      res.status(403).json({ error: "Nemáte oprávnění" });
      return;
    }
    res.json({ points: getFlightTrackPoints(session.id) });
  },
);

djiCloudRoutes.delete(
  "/flight-track/sessions/:id",
  strictLimiter,
  authMiddleware,
  (req: AuthRequest, res) => {
    const sessionId = req.params.id;
    if (typeof sessionId !== "string" || !sessionId) {
      res.status(400).json({ error: "Chybí ID záznamu" });
      return;
    }
    const session = getFlightTrackSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "Záznam letu nebyl nalezen" });
      return;
    }
    const owned = session.missionId
      ? isMissionOwnedByUser(session.missionId, req.userId!)
      : session.userId === req.userId;
    if (!owned) {
      res.status(403).json({ error: "Nemáte oprávnění" });
      return;
    }
    deleteFlightTrackSession(session.id);
    res.json({ success: true });
  },
);

// Personal DJI Cloud account linking: lets a SkyRoute user attribute their
// own uploads/actions to their own account on the platform instead of the
// one shared DJI_CLOUD_USERNAME service account (see djiCloud.ts's
// resolveConfig). Rate-limited like the other account-mutating auth routes
// — it's an authenticated call that attempts a real login against the
// platform on every call.
djiCloudRoutes.post(
  "/account/link",
  strictLimiter,
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      if (!requireConfigured(res)) return;
      const { username, password } = req.body;
      if (typeof username !== "string" || !username) {
        res.status(400).json({ error: "Chybí uživatelské jméno" });
        return;
      }
      if (typeof password !== "string" || !password) {
        res.status(400).json({ error: "Chybí heslo" });
        return;
      }
      await linkDjiCloudAccount(req.userId!, username, password);
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "DJI Cloud account link error");
      res.status(400).json({
        error:
          "Propojení s DJI Cloud selhalo — zkontrolujte přihlašovací údaje",
      });
    }
  },
);

djiCloudRoutes.delete(
  "/account/link",
  authMiddleware,
  (req: AuthRequest, res) => {
    unlinkDjiCloudAccount(req.userId!);
    res.json({ success: true });
  },
);

djiCloudRoutes.get("/account/link", authMiddleware, (req: AuthRequest, res) => {
  res.json(getDjiCloudAccountStatus(req.userId!));
});
