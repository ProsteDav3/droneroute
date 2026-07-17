import { Router, type Response } from "express";
import { getDb } from "../models/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateRiskAssessment } from "../services/complianceValidation.js";

export const riskAssessmentRoutes = Router();

interface RiskAssessmentRow {
  mission_id: string;
  ground_risk_class: string;
  air_risk_class: string;
  mitigations: string;
  assessed_at: string;
}

function toApi(row: RiskAssessmentRow) {
  return {
    missionId: row.mission_id,
    groundRiskClass: row.ground_risk_class,
    airRiskClass: row.air_risk_class,
    mitigations: JSON.parse(row.mitigations || "[]"),
    assessedAt: row.assessed_at,
  };
}

/** Look up a mission and verify it belongs to the requesting user. Returns the mission row, or sends an error response and returns null. */
function requireOwnedMission(
  db: ReturnType<typeof getDb>,
  missionId: string,
  userId: string,
  res: Response,
): boolean {
  const mission = db
    .prepare("SELECT user_id FROM missions WHERE id = ?")
    .get(missionId) as { user_id: string | null } | undefined;
  if (!mission) {
    res.status(404).json({ error: "Mise nebyla nalezena" });
    return false;
  }
  if (mission.user_id !== userId) {
    res.status(403).json({ error: "Nemáte oprávnění k této misi" });
    return false;
  }
  return true;
}

// Get the risk assessment for a mission (owner only). 404 if none exists yet.
riskAssessmentRoutes.get(
  "/:missionId",
  authMiddleware,
  (req: AuthRequest, res) => {
    const db = getDb();
    if (
      !requireOwnedMission(db, String(req.params.missionId), req.userId!, res)
    ) {
      return;
    }

    const row = db
      .prepare("SELECT * FROM mission_risk_assessments WHERE mission_id = ?")
      .get(req.params.missionId) as RiskAssessmentRow | undefined;

    if (!row) {
      res.status(404).json({ error: "Posouzení rizik dosud nebylo vytvořeno" });
      return;
    }

    res.json(toApi(row));
  },
);

// Create or update the risk assessment for a mission (owner only) — one row
// per mission, so PUT is a natural upsert.
riskAssessmentRoutes.put(
  "/:missionId",
  authMiddleware,
  (req: AuthRequest, res) => {
    const db = getDb();
    if (
      !requireOwnedMission(db, String(req.params.missionId), req.userId!, res)
    ) {
      return;
    }

    const validationError = validateRiskAssessment(req.body);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const { groundRiskClass, airRiskClass, mitigations } = req.body;

    db.prepare(
      `INSERT INTO mission_risk_assessments (mission_id, ground_risk_class, air_risk_class, mitigations, assessed_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(mission_id) DO UPDATE SET
         ground_risk_class = excluded.ground_risk_class,
         air_risk_class = excluded.air_risk_class,
         mitigations = excluded.mitigations,
         assessed_at = excluded.assessed_at`,
    ).run(
      req.params.missionId,
      groundRiskClass,
      airRiskClass,
      JSON.stringify(mitigations || []),
    );

    res.json({ missionId: req.params.missionId });
  },
);

// Delete the risk assessment for a mission (owner only).
riskAssessmentRoutes.delete(
  "/:missionId",
  authMiddleware,
  (req: AuthRequest, res) => {
    const db = getDb();
    if (
      !requireOwnedMission(db, String(req.params.missionId), req.userId!, res)
    ) {
      return;
    }

    db.prepare("DELETE FROM mission_risk_assessments WHERE mission_id = ?").run(
      req.params.missionId,
    );
    res.json({ success: true });
  },
);
