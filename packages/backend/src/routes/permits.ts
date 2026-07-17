import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../models/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validatePermitCreate } from "../services/complianceValidation.js";

export const permitRoutes = Router();

interface PermitRow {
  id: string;
  mission_id: string;
  description: string;
  reference_or_url: string | null;
  expiry_date: string | null;
  issued_by: string | null;
  created_at: string;
}

function toApi(row: PermitRow) {
  return {
    id: row.id,
    missionId: row.mission_id,
    description: row.description,
    referenceOrUrl: row.reference_or_url,
    expiryDate: row.expiry_date,
    issuedBy: row.issued_by,
    createdAt: row.created_at,
  };
}

function isMissionOwnedByUser(
  db: ReturnType<typeof getDb>,
  missionId: string,
  userId: string,
): boolean {
  const mission = db
    .prepare("SELECT user_id FROM missions WHERE id = ?")
    .get(missionId) as { user_id: string | null } | undefined;
  return !!mission && mission.user_id === userId;
}

// List permits for a mission (owner only). `missionId` query param required —
// this endpoint is scoped per-mission, not a global permit inbox.
permitRoutes.get("/", authMiddleware, (req: AuthRequest, res) => {
  const { missionId } = req.query;
  if (typeof missionId !== "string" || missionId.length === 0) {
    res.status(400).json({ error: "Parametr missionId je povinný" });
    return;
  }

  const db = getDb();
  if (!isMissionOwnedByUser(db, missionId, req.userId!)) {
    res.status(403).json({ error: "Nemáte oprávnění k této misi" });
    return;
  }

  const rows = db
    .prepare(
      "SELECT * FROM mission_permits WHERE mission_id = ? ORDER BY expiry_date IS NULL, expiry_date ASC",
    )
    .all(missionId) as PermitRow[];

  res.json(rows.map(toApi));
});

// Create a permit record for a mission (owner only).
permitRoutes.post("/", authMiddleware, (req: AuthRequest, res) => {
  const validationError = validatePermitCreate(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const db = getDb();
  const { missionId, description, referenceOrUrl, expiryDate, issuedBy } =
    req.body;

  if (!isMissionOwnedByUser(db, missionId, req.userId!)) {
    res.status(403).json({ error: "Nemáte oprávnění k této misi" });
    return;
  }

  const id = uuidv4();
  db.prepare(
    "INSERT INTO mission_permits (id, mission_id, description, reference_or_url, expiry_date, issued_by) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    missionId,
    description,
    referenceOrUrl || null,
    expiryDate || null,
    issuedBy || null,
  );

  res.status(201).json({ id });
});

// Delete a permit record (owner only, via its mission's ownership).
permitRoutes.delete("/:id", authMiddleware, (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db
    .prepare("SELECT mission_id FROM mission_permits WHERE id = ?")
    .get(req.params.id) as { mission_id: string } | undefined;

  if (!existing) {
    res.status(404).json({ error: "Povolení nebylo nalezeno" });
    return;
  }
  if (!isMissionOwnedByUser(db, existing.mission_id, req.userId!)) {
    res.status(403).json({ error: "Nemáte oprávnění" });
    return;
  }

  db.prepare("DELETE FROM mission_permits WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});
