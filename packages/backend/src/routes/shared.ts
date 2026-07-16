import { Router } from "express";
import { randomBytes } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../models/db.js";
import {
  authMiddleware,
  optionalAuth,
  type AuthRequest,
} from "../middleware/auth.js";
import { commentLimiter } from "../middleware/rateLimit.js";
import { validateMissionComment } from "../services/missionValidation.js";
import type {
  SharedMission,
  EmbedMission,
  MissionComment,
} from "@droneroute/shared";

export const sharedRoutes = Router();

/** Cap on comments returned per shared mission — a public read-only page has no pagination UI, so this just bounds the response size for a mission with an unusually long comment thread. */
const MAX_COMMENTS_RETURNED = 500;

// Enable sharing for a mission (generates share token)
sharedRoutes.post(
  "/missions/:id/share",
  authMiddleware,
  (req: AuthRequest, res) => {
    const db = getDb();
    const mission = db
      .prepare("SELECT id, user_id, share_token FROM missions WHERE id = ?")
      .get(req.params.id) as any;

    if (!mission) {
      res.status(404).json({ error: "Mise nebyla nalezena" });
      return;
    }

    if (mission.user_id !== req.userId) {
      res.status(403).json({ error: "Nemáte oprávnění" });
      return;
    }

    // If already shared, return existing token
    if (mission.share_token) {
      const shareUrl = `${req.protocol}://${req.get("host")}/shared/${mission.share_token}`;
      res.json({ shareToken: mission.share_token, shareUrl });
      return;
    }

    // Generate a URL-safe random token
    const shareToken = randomBytes(16).toString("base64url");
    db.prepare("UPDATE missions SET share_token = ? WHERE id = ?").run(
      shareToken,
      req.params.id,
    );

    const shareUrl = `${req.protocol}://${req.get("host")}/shared/${shareToken}`;
    res.json({ shareToken, shareUrl });
  },
);

// Revoke sharing for a mission
sharedRoutes.delete(
  "/missions/:id/share",
  authMiddleware,
  (req: AuthRequest, res) => {
    const db = getDb();
    const mission = db
      .prepare("SELECT id, user_id FROM missions WHERE id = ?")
      .get(req.params.id) as any;

    if (!mission) {
      res.status(404).json({ error: "Mise nebyla nalezena" });
      return;
    }

    if (mission.user_id !== req.userId) {
      res.status(403).json({ error: "Nemáte oprávnění" });
      return;
    }

    db.prepare("UPDATE missions SET share_token = NULL WHERE id = ?").run(
      req.params.id,
    );
    res.json({ success: true });
  },
);

// Get a shared mission by token (public, no auth required)
sharedRoutes.get("/shared/:token", (req, res) => {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT m.id, m.name, m.config, m.waypoints, m.pois, m.obstacles, m.share_token, m.created_at, m.updated_at, u.email
       FROM missions m
       LEFT JOIN users u ON m.user_id = u.id
       WHERE m.share_token = ?`,
    )
    .get(req.params.token) as any;

  if (!row) {
    res.status(404).json({ error: "Sdílená mise nebyla nalezena" });
    return;
  }

  const mission: SharedMission = {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    shareToken: row.share_token,
    ownerEmail: row.email || undefined,
    config: JSON.parse(row.config),
    waypoints: JSON.parse(row.waypoints),
    pois: JSON.parse(row.pois || "[]"),
    obstacles: JSON.parse(row.obstacles || "[]"),
  };

  res.json(mission);
});

// Clone a shared mission to the authenticated user's account
sharedRoutes.post(
  "/shared/:token/clone",
  authMiddleware,
  (req: AuthRequest, res) => {
    const db = getDb();
    const row = db
      .prepare(
        "SELECT name, config, waypoints, pois, obstacles FROM missions WHERE share_token = ?",
      )
      .get(req.params.token) as any;

    if (!row) {
      res.status(404).json({ error: "Sdílená mise nebyla nalezena" });
      return;
    }

    const id = uuidv4();
    const name = `${row.name} (kopie)`;

    db.prepare(
      "INSERT INTO missions (id, name, user_id, config, waypoints, pois, obstacles) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      name,
      req.userId!,
      row.config,
      row.waypoints,
      row.pois || "[]",
      row.obstacles || "[]",
    );

    res.status(201).json({ id, name });
  },
);

// List comments on a publicly shared mission (public, no auth required).
// Resolves straight from the denormalized share_token on mission_comments,
// so this never needs to join through missions or expose ownership.
sharedRoutes.get("/shared/:token/comments", (req, res) => {
  const db = getDb();

  // A 404 for an unknown/revoked token keeps this consistent with
  // GET /shared/:token instead of silently returning an empty list.
  const mission = db
    .prepare("SELECT id FROM missions WHERE share_token = ?")
    .get(req.params.token) as any;
  if (!mission) {
    res.status(404).json({ error: "Sdílená mise nebyla nalezena" });
    return;
  }

  // `created_at` is `datetime('now')` (second resolution) — `rowid`
  // (SQLite's implicit, strictly insertion-ordered column) breaks ties
  // between comments posted within the same second in true post order,
  // unlike the UUID `id` which would sort arbitrarily.
  const rows = db
    .prepare(
      `SELECT id, author_name, text, created_at FROM mission_comments
       WHERE share_token = ?
       ORDER BY created_at ASC, rowid ASC
       LIMIT ?`,
    )
    .all(req.params.token, MAX_COMMENTS_RETURNED) as any[];

  const comments: MissionComment[] = rows.map((row) => ({
    id: row.id,
    authorName: row.author_name,
    text: row.text,
    createdAt: row.created_at,
  }));

  res.json(comments);
});

// Post a comment on a publicly shared mission (public, no auth required —
// just a display name + text). Rate-limited and length-bounded since this
// is anonymous input.
sharedRoutes.post("/shared/:token/comments", commentLimiter, (req, res) => {
  const db = getDb();

  const mission = db
    .prepare("SELECT id FROM missions WHERE share_token = ?")
    .get(req.params.token) as any;
  if (!mission) {
    res.status(404).json({ error: "Sdílená mise nebyla nalezena" });
    return;
  }

  const validationError = validateMissionComment(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const { authorName, text } = req.body as {
    authorName: string;
    text: string;
  };

  const id = uuidv4();
  db.prepare(
    "INSERT INTO mission_comments (id, mission_id, share_token, author_name, text) VALUES (?, ?, ?, ?, ?)",
  ).run(id, mission.id, req.params.token, authorName.trim(), text.trim());

  const created = db
    .prepare(
      "SELECT id, author_name, text, created_at FROM mission_comments WHERE id = ?",
    )
    .get(id) as any;

  const comment: MissionComment = {
    id: created.id,
    authorName: created.author_name,
    text: created.text,
    createdAt: created.created_at,
  };

  res.status(201).json(comment);
});

// Minimal read-only mission data for the public embed widget (public, no
// auth required) — deliberately excludes the owner's email, the mission's
// DB id, and the share token itself (the caller already has the token).
sharedRoutes.get("/embed/:token", (req, res) => {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT name, config, waypoints, pois, obstacles FROM missions WHERE share_token = ?",
    )
    .get(req.params.token) as any;

  if (!row) {
    res.status(404).json({ error: "Sdílená mise nebyla nalezena" });
    return;
  }

  const mission: EmbedMission = {
    name: row.name,
    config: JSON.parse(row.config),
    waypoints: JSON.parse(row.waypoints),
    pois: JSON.parse(row.pois || "[]"),
    obstacles: JSON.parse(row.obstacles || "[]"),
  };

  res.json(mission);
});
