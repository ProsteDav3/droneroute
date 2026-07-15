import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../models/db.js";
import {
  authMiddleware,
  optionalAuth,
  type AuthRequest,
} from "../middleware/auth.js";
import type { Mission } from "@droneroute/shared";
import {
  validateMissionCreate,
  validateMissionUpdate,
} from "../services/missionValidation.js";
import { buildMissionSegments } from "../services/missionSegments.js";

export const missionRoutes = Router();

// List missions for authenticated user
missionRoutes.get("/", authMiddleware, (req: AuthRequest, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, name, config, waypoints, pois, obstacles, buildings, template_groups, share_token, created_at, updated_at FROM missions WHERE user_id = ? ORDER BY updated_at DESC",
    )
    .all(req.userId!) as any[];

  res.json(rows);
});

// Get single mission (owner only)
missionRoutes.get("/:id", authMiddleware, (req: AuthRequest, res) => {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM missions WHERE id = ?")
    .get(req.params.id) as any;

  if (!row) {
    res.status(404).json({ error: "Mise nebyla nalezena" });
    return;
  }

  if (row.user_id !== req.userId) {
    res.status(403).json({ error: "Nemáte oprávnění" });
    return;
  }

  const mission: Mission = {
    id: row.id,
    name: row.name,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    config: JSON.parse(row.config),
    waypoints: JSON.parse(row.waypoints),
    pois: JSON.parse(row.pois || "[]"),
    obstacles: JSON.parse(row.obstacles || "[]"),
    buildings: JSON.parse(row.buildings || "[]"),
    templateGroups: JSON.parse(row.template_groups || "{}"),
  };

  res.json(mission);
});

// Create mission
missionRoutes.post("/", optionalAuth, (req: AuthRequest, res) => {
  const {
    name,
    config,
    waypoints,
    pois,
    obstacles,
    buildings,
    templateGroups,
  } = req.body;
  if (!name || !config || !waypoints) {
    res
      .status(400)
      .json({ error: "Pole name, config a waypoints jsou povinná" });
    return;
  }

  const validationError = validateMissionCreate(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const db = getDb();
  const id = uuidv4();
  db.prepare(
    "INSERT INTO missions (id, name, user_id, config, waypoints, pois, obstacles, buildings, template_groups) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    name,
    req.userId || null,
    JSON.stringify(config),
    JSON.stringify(waypoints),
    JSON.stringify(pois || []),
    JSON.stringify(obstacles || []),
    JSON.stringify(buildings || []),
    JSON.stringify(templateGroups || {}),
  );

  res.status(201).json({ id, name });
});

// Split a mission into consecutive one-leg missions (WP1→WP2, WP2→WP3, ...)
// and save every leg as its own mission in the caller's account.
missionRoutes.post("/segments", authMiddleware, (req: AuthRequest, res) => {
  const {
    name,
    config,
    waypoints,
    pois,
    obstacles,
    buildings,
    templateGroups,
  } = req.body;
  if (!name || !config || !waypoints) {
    res
      .status(400)
      .json({ error: "Pole name, config a waypoints jsou povinná" });
    return;
  }
  if (waypoints.length < 2) {
    res.status(400).json({
      error: "Je vyžadováno alespoň 2 body trasy pro rozdělení na úseky",
    });
    return;
  }

  const validationError = validateMissionCreate(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const parentMission: Mission = {
    id: uuidv4(),
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    config,
    waypoints,
    pois: pois || [],
    obstacles: obstacles || [],
    buildings: buildings || [],
    templateGroups: templateGroups || {},
  };
  const segments = buildMissionSegments(parentMission);

  const db = getDb();
  const insert = db.prepare(
    "INSERT INTO missions (id, name, user_id, config, waypoints, pois, obstacles, buildings, template_groups) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const created: { id: string; name: string }[] = [];

  const insertAll = db.transaction((missionsToInsert: Mission[]) => {
    for (const segment of missionsToInsert) {
      const id = uuidv4();
      insert.run(
        id,
        segment.name,
        req.userId!,
        JSON.stringify(segment.config),
        JSON.stringify(segment.waypoints),
        JSON.stringify(segment.pois),
        JSON.stringify(segment.obstacles),
        JSON.stringify(segment.buildings),
        JSON.stringify(segment.templateGroups),
      );
      created.push({ id, name: segment.name });
    }
  });
  insertAll(segments);

  res.status(201).json(created);
});

// Update mission (owner only)
missionRoutes.put("/:id", authMiddleware, (req: AuthRequest, res) => {
  const {
    name,
    config,
    waypoints,
    pois,
    obstacles,
    buildings,
    templateGroups,
  } = req.body;
  const db = getDb();

  const existing = db
    .prepare("SELECT user_id FROM missions WHERE id = ?")
    .get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: "Mise nebyla nalezena" });
    return;
  }

  if (existing.user_id !== req.userId) {
    res.status(403).json({ error: "Nemáte oprávnění" });
    return;
  }

  const validationError = validateMissionUpdate(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (name !== undefined) {
    updates.push("name = ?");
    values.push(name);
  }
  if (config !== undefined) {
    updates.push("config = ?");
    values.push(JSON.stringify(config));
  }
  if (waypoints !== undefined) {
    updates.push("waypoints = ?");
    values.push(JSON.stringify(waypoints));
  }
  if (pois !== undefined) {
    updates.push("pois = ?");
    values.push(JSON.stringify(pois));
  }
  if (obstacles !== undefined) {
    updates.push("obstacles = ?");
    values.push(JSON.stringify(obstacles));
  }
  if (buildings !== undefined) {
    updates.push("buildings = ?");
    values.push(JSON.stringify(buildings));
  }
  if (templateGroups !== undefined) {
    updates.push("template_groups = ?");
    values.push(JSON.stringify(templateGroups));
  }

  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);

  db.prepare(`UPDATE missions SET ${updates.join(", ")} WHERE id = ?`).run(
    ...values,
  );

  res.json({ id: req.params.id, name });
});

// Delete mission
missionRoutes.delete("/:id", authMiddleware, (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db
    .prepare("SELECT user_id FROM missions WHERE id = ?")
    .get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: "Mise nebyla nalezena" });
    return;
  }
  if (existing.user_id !== req.userId) {
    res.status(403).json({ error: "Nemáte oprávnění" });
    return;
  }

  db.prepare("DELETE FROM missions WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});
