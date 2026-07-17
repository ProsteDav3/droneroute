import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../models/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateFlightLogCreate } from "../services/complianceValidation.js";

export const flightLogRoutes = Router();

interface FlightLogRow {
  id: string;
  mission_id: string | null;
  user_id: string;
  flown_at: string;
  duration_minutes: number;
  notes: string | null;
  created_at: string;
}

function toApi(row: FlightLogRow) {
  return {
    id: row.id,
    missionId: row.mission_id,
    flownAt: row.flown_at,
    durationMinutes: row.duration_minutes,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

/** Verify a mission id belongs to the requesting user. Returns an error message, or null when OK (including when missionId is absent). */
function checkMissionOwnership(
  db: ReturnType<typeof getDb>,
  missionId: unknown,
  userId: string,
): string | null {
  if (missionId === undefined || missionId === null || missionId === "") {
    return null;
  }
  const mission = db
    .prepare("SELECT user_id FROM missions WHERE id = ?")
    .get(missionId) as { user_id: string | null } | undefined;
  if (!mission) return "Mise nebyla nalezena";
  if (mission.user_id !== userId) return "Nemáte oprávnění k této misi";
  return null;
}

// List the authenticated user's flight logs, optionally filtered by mission.
flightLogRoutes.get("/", authMiddleware, (req: AuthRequest, res) => {
  const db = getDb();
  const { missionId } = req.query;

  const rows =
    typeof missionId === "string" && missionId.length > 0
      ? (db
          .prepare(
            "SELECT * FROM flight_logs WHERE user_id = ? AND mission_id = ? ORDER BY flown_at DESC",
          )
          .all(req.userId!, missionId) as FlightLogRow[])
      : (db
          .prepare(
            "SELECT * FROM flight_logs WHERE user_id = ? ORDER BY flown_at DESC",
          )
          .all(req.userId!) as FlightLogRow[]);

  res.json(rows.map(toApi));
});

// Create a flight log entry for the authenticated user. `userId` is always
// taken from the JWT — never accepted from the client body.
flightLogRoutes.post("/", authMiddleware, (req: AuthRequest, res) => {
  const validationError = validateFlightLogCreate(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const db = getDb();
  const { missionId, flownAt, durationMinutes, notes } = req.body;

  const ownershipError = checkMissionOwnership(db, missionId, req.userId!);
  if (ownershipError) {
    res.status(403).json({ error: ownershipError });
    return;
  }

  const id = uuidv4();
  db.prepare(
    "INSERT INTO flight_logs (id, mission_id, user_id, flown_at, duration_minutes, notes) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    missionId || null,
    req.userId!,
    flownAt,
    durationMinutes,
    notes || null,
  );

  res.status(201).json({ id });
});

// Delete a flight log entry (owner only).
flightLogRoutes.delete("/:id", authMiddleware, (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db
    .prepare("SELECT user_id FROM flight_logs WHERE id = ?")
    .get(req.params.id) as { user_id: string } | undefined;

  if (!existing) {
    res.status(404).json({ error: "Záznam nebyl nalezen" });
    return;
  }
  if (existing.user_id !== req.userId) {
    res.status(403).json({ error: "Nemáte oprávnění" });
    return;
  }

  db.prepare("DELETE FROM flight_logs WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});
