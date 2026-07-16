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
} from "../services/djiCloud.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { strictLimiter } from "../middleware/rateLimit.js";
import { validateMissionGeometry } from "../services/missionValidation.js";

export const djiCloudRoutes = Router();

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
      console.error("DJI Cloud upload error:", err);
      res.status(502).json({ error: "Nahrání do DJI Cloud selhalo" });
    }
  },
);

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
      console.error("DJI Cloud segments upload error:", err);
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
