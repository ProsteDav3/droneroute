import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import type Database from "better-sqlite3";
import { getDb } from "../models/db.js";
import {
  authMiddleware,
  optionalAuth,
  type AuthRequest,
} from "../middleware/auth.js";
import type { Mission, MissionVersionSnapshot } from "@droneroute/shared";
import {
  validateMissionCreate,
  validateMissionUpdate,
} from "../services/missionValidation.js";
import { buildMissionSegments } from "../services/missionSegments.js";

export const missionRoutes = Router();

/** How many of the most recent snapshots are kept per mission — older rows are pruned in the same transaction as the insert. */
const MAX_VERSIONS_PER_MISSION = 20;

/** Escape LIKE wildcard characters so a free-text search behaves like a literal substring match rather than a pattern. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Insert a version snapshot for a mission and prune older rows beyond
 * `MAX_VERSIONS_PER_MISSION`, atomically. Called after every mission
 * create/update/restore so history never grows unbounded.
 */
function saveMissionVersion(
  db: Database.Database,
  missionId: string,
  snapshot: MissionVersionSnapshot,
): void {
  const insertVersion = db.prepare(
    "INSERT INTO mission_versions (id, mission_id, snapshot) VALUES (?, ?, ?)",
  );
  // `created_at` is `datetime('now')` (second resolution), so rapid saves
  // within the same second can tie on it — `rowid` (SQLite's implicit,
  // strictly insertion-ordered column) breaks the tie deterministically in
  // true insertion order, unlike the UUID `id` which sorts arbitrarily.
  const pruneOld = db.prepare(
    `DELETE FROM mission_versions
     WHERE mission_id = ?
       AND id NOT IN (
         SELECT id FROM mission_versions
         WHERE mission_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?
       )`,
  );
  const run = db.transaction(() => {
    insertVersion.run(uuidv4(), missionId, JSON.stringify(snapshot));
    pruneOld.run(missionId, missionId, MAX_VERSIONS_PER_MISSION);
  });
  run();
}

/** Read back a mission row's full editable content as a version snapshot. */
function snapshotFromRow(row: any): MissionVersionSnapshot {
  return {
    name: row.name,
    client: row.client ?? null,
    folder: row.folder ?? null,
    config: JSON.parse(row.config),
    waypoints: JSON.parse(row.waypoints),
    pois: JSON.parse(row.pois || "[]"),
    obstacles: JSON.parse(row.obstacles || "[]"),
    buildings: JSON.parse(row.buildings || "[]"),
    templateGroups: JSON.parse(row.template_groups || "{}"),
  };
}

/**
 * @openapi
 * /missions:
 *   get:
 *     summary: List the current user's saved missions
 *     description: Optionally filtered by folder (exact match) and/or a free-text search over the mission name.
 *     tags: [Missions]
 *     responses:
 *       200:
 *         description: Array of mission summaries (config/waypoints/pois are JSON-decoded)
 *       401:
 *         description: Missing/invalid auth token
 */
// List missions for authenticated user — optionally filtered by folder
// (exact match) and/or a free-text search over the mission name.
missionRoutes.get("/", authMiddleware, (req: AuthRequest, res) => {
  const db = getDb();
  const { folder, search } = req.query;

  let sql =
    "SELECT id, name, client, folder, config, waypoints, pois, obstacles, buildings, template_groups, share_token, created_at, updated_at FROM missions WHERE user_id = ?";
  const params: unknown[] = [req.userId!];

  if (typeof folder === "string" && folder.length > 0) {
    sql += " AND folder = ?";
    params.push(folder);
  }

  if (typeof search === "string" && search.trim().length > 0) {
    sql += " AND name LIKE ? ESCAPE '\\'";
    params.push(`%${escapeLikePattern(search.trim())}%`);
  }

  sql += " ORDER BY updated_at DESC";

  const rows = db.prepare(sql).all(...params) as any[];
  res.json(rows);
});

/**
 * @openapi
 * /missions/{id}:
 *   get:
 *     summary: Get a single saved mission (owner only)
 *     tags: [Missions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The mission, fully decoded (config, waypoints, pois, obstacles, buildings, templateGroups)
 *       403:
 *         description: Not the mission owner
 *       404:
 *         description: Mission not found
 */
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
    client: row.client ?? null,
    folder: row.folder ?? null,
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

/**
 * @openapi
 * /missions:
 *   post:
 *     summary: Create a mission
 *     description: >
 *       Auth is optional — an anonymous mission is saved with no owner
 *       (used by flows that don't require sign-in, e.g. quick exports).
 *     tags: [Missions]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, config, waypoints]
 *             properties:
 *               name: { type: string }
 *               client: { type: string, nullable: true }
 *               config: { type: object }
 *               waypoints: { type: array, items: { type: object } }
 *               pois: { type: array, items: { type: object } }
 *               obstacles: { type: array, items: { type: object } }
 *               buildings: { type: array, items: { type: object } }
 *               templateGroups: { type: object }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 name: { type: string }
 *       400:
 *         description: Missing required fields or invalid mission geometry
 */
// Create mission
missionRoutes.post("/", optionalAuth, (req: AuthRequest, res) => {
  const {
    name,
    client,
    folder,
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
    "INSERT INTO missions (id, name, client, folder, user_id, config, waypoints, pois, obstacles, buildings, template_groups) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    name,
    client || null,
    folder || null,
    req.userId || null,
    JSON.stringify(config),
    JSON.stringify(waypoints),
    JSON.stringify(pois || []),
    JSON.stringify(obstacles || []),
    JSON.stringify(buildings || []),
    JSON.stringify(templateGroups || {}),
  );

  if (req.userId) {
    saveMissionVersion(db, id, {
      name,
      client: client || null,
      folder: folder || null,
      config,
      waypoints,
      pois: pois || [],
      obstacles: obstacles || [],
      buildings: buildings || [],
      templateGroups: templateGroups || {},
    });
  }

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

/**
 * @openapi
 * /missions/{id}:
 *   put:
 *     summary: Update a mission (owner only, partial update)
 *     tags: [Missions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Any subset of the mission's fields — only provided fields are updated.
 *     responses:
 *       200:
 *         description: Updated
 *       403:
 *         description: Not the mission owner
 *       404:
 *         description: Mission not found
 */
// Update mission (owner only)
missionRoutes.put("/:id", authMiddleware, (req: AuthRequest, res) => {
  const {
    name,
    client,
    folder,
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
  if (client !== undefined) {
    updates.push("client = ?");
    values.push(client || null);
  }
  if (folder !== undefined) {
    updates.push("folder = ?");
    values.push(folder || null);
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

  const updatedRow = db
    .prepare("SELECT * FROM missions WHERE id = ?")
    .get(req.params.id) as any;
  saveMissionVersion(db, String(req.params.id), snapshotFromRow(updatedRow));

  res.json({ id: req.params.id, name });
});

/**
 * @openapi
 * /missions/{id}:
 *   delete:
 *     summary: Delete a mission (owner only)
 *     tags: [Missions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 *       403:
 *         description: Not the mission owner
 *       404:
 *         description: Mission not found
 */
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

// Duplicate a mission (owner only) — a clean, independent copy: fresh id,
// name suffixed with " (kopie)", all editable content copied, but the
// share token, comments, and version history are intentionally NOT carried
// over (the copy starts unshared with its own blank history).
missionRoutes.post(
  "/:id/duplicate",
  authMiddleware,
  (req: AuthRequest, res) => {
    const db = getDb();
    const existing = db
      .prepare("SELECT * FROM missions WHERE id = ?")
      .get(req.params.id) as any;

    if (!existing) {
      res.status(404).json({ error: "Mise nebyla nalezena" });
      return;
    }
    if (existing.user_id !== req.userId) {
      res.status(403).json({ error: "Nemáte oprávnění" });
      return;
    }

    const id = uuidv4();
    const name = `${existing.name} (kopie)`;

    db.prepare(
      "INSERT INTO missions (id, name, client, folder, user_id, config, waypoints, pois, obstacles, buildings, template_groups) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      name,
      existing.client ?? null,
      existing.folder ?? null,
      req.userId!,
      existing.config,
      existing.waypoints,
      existing.pois || "[]",
      existing.obstacles || "[]",
      existing.buildings || "[]",
      existing.template_groups || "{}",
    );

    saveMissionVersion(db, id, {
      name,
      client: existing.client ?? null,
      folder: existing.folder ?? null,
      config: JSON.parse(existing.config),
      waypoints: JSON.parse(existing.waypoints),
      pois: JSON.parse(existing.pois || "[]"),
      obstacles: JSON.parse(existing.obstacles || "[]"),
      buildings: JSON.parse(existing.buildings || "[]"),
      templateGroups: JSON.parse(existing.template_groups || "{}"),
    });

    res.status(201).json({ id, name });
  },
);

// List version snapshots for a mission (owner only) — newest first, no
// snapshot payload (restore a specific version to apply it).
missionRoutes.get("/:id/versions", authMiddleware, (req: AuthRequest, res) => {
  const db = getDb();
  const mission = db
    .prepare("SELECT user_id FROM missions WHERE id = ?")
    .get(req.params.id) as any;

  if (!mission) {
    res.status(404).json({ error: "Mise nebyla nalezena" });
    return;
  }
  if (mission.user_id !== req.userId) {
    res.status(403).json({ error: "Nemáte oprávnění" });
    return;
  }

  const versions = db
    .prepare(
      "SELECT id, created_at FROM mission_versions WHERE mission_id = ? ORDER BY created_at DESC, rowid DESC",
    )
    .all(req.params.id) as any[];

  res.json(versions.map((v) => ({ id: v.id, createdAt: v.created_at })));
});

// Restore a mission to a previous version snapshot (owner only). Overwrites
// the mission's current content with the snapshot, then records the
// restore itself as a new version so history is never destroyed.
missionRoutes.post(
  "/:id/versions/:versionId/restore",
  authMiddleware,
  (req: AuthRequest, res) => {
    const db = getDb();
    const mission = db
      .prepare("SELECT user_id FROM missions WHERE id = ?")
      .get(req.params.id) as any;

    if (!mission) {
      res.status(404).json({ error: "Mise nebyla nalezena" });
      return;
    }
    if (mission.user_id !== req.userId) {
      res.status(403).json({ error: "Nemáte oprávnění" });
      return;
    }

    const version = db
      .prepare(
        "SELECT snapshot FROM mission_versions WHERE id = ? AND mission_id = ?",
      )
      .get(req.params.versionId, req.params.id) as any;

    if (!version) {
      res.status(404).json({ error: "Verze nebyla nalezena" });
      return;
    }

    const snapshot: MissionVersionSnapshot = JSON.parse(version.snapshot);

    db.prepare(
      `UPDATE missions
       SET name = ?, client = ?, folder = ?, config = ?, waypoints = ?, pois = ?, obstacles = ?, buildings = ?, template_groups = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      snapshot.name,
      snapshot.client,
      snapshot.folder,
      JSON.stringify(snapshot.config),
      JSON.stringify(snapshot.waypoints),
      JSON.stringify(snapshot.pois),
      JSON.stringify(snapshot.obstacles),
      JSON.stringify(snapshot.buildings),
      JSON.stringify(snapshot.templateGroups),
      req.params.id,
    );

    saveMissionVersion(db, String(req.params.id), snapshot);

    res.json({ id: req.params.id, name: snapshot.name });
  },
);
