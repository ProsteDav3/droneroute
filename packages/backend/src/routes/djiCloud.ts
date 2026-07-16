import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import type { Mission } from "@droneroute/shared";
import { generateKmzBuffer } from "../services/kmzGenerator.js";
import {
  isDjiCloudConfigured,
  uploadMissionToDjiCloud,
} from "../services/djiCloud.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { strictLimiter } from "../middleware/rateLimit.js";
import { validateMissionGeometry } from "../services/missionValidation.js";

export const djiCloudRoutes = Router();

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

      const mission: Mission = {
        id: uuidv4(),
        name: name || "mission",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        config,
        waypoints,
        pois: pois || [],
        obstacles: [],
        buildings: [],
        templateGroups: {},
      };

      const buffer = await generateKmzBuffer(mission);
      const { waylineName } = await uploadMissionToDjiCloud(
        mission.name,
        buffer,
      );

      res.json({ waylineName });
    } catch (err) {
      console.error("DJI Cloud upload error:", err);
      res.status(502).json({
        error:
          err instanceof Error ? err.message : "Nahrání do DJI Cloud selhalo",
      });
    }
  },
);
