import { Router } from "express";
import { getDb } from "../models/db.js";
import { logger } from "../lib/logger.js";

export const healthRoutes = Router();

// GET /api/health — no auth, cheap enough for an external uptime monitor to
// poll every 1-5 minutes indefinitely. Always responds 200 (even when
// degraded) so the monitor can distinguish "unreachable" from "reachable but
// unhealthy" via the JSON body rather than the HTTP status.
healthRoutes.get("/health", (_req, res) => {
  let dbOk = true;
  try {
    getDb().prepare("SELECT 1").get();
  } catch (err) {
    logger.error({ err }, "Health check DB probe failed");
    dbOk = false;
  }
  const uptimeSeconds = Math.floor(process.uptime());
  res.json({
    status: dbOk ? "ok" : "degraded",
    uptimeSeconds,
    dbOk,
    timestamp: new Date().toISOString(),
  });
});
