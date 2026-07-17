import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../models/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import {
  validateTemplatePresetCreate,
  validateTemplatePresetUpdate,
} from "../services/templatePresetValidation.js";

export const templatePresetRoutes = Router();

/**
 * @openapi
 * /template-presets:
 *   get:
 *     summary: List the current user's saved template presets
 *     tags: [Template presets]
 *     responses:
 *       200:
 *         description: Presets
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   name: { type: string }
 *                   type: { type: string }
 *                   params: { type: object }
 *                   createdAt: { type: string }
 */
// List the current user's presets
templatePresetRoutes.get("/", authMiddleware, (req: AuthRequest, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, name, type, params, created_at FROM template_presets WHERE user_id = ? ORDER BY created_at DESC",
    )
    .all(req.userId!) as any[];

  res.json(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      params: JSON.parse(row.params),
      createdAt: row.created_at,
    })),
  );
});

/**
 * @openapi
 * /template-presets:
 *   post:
 *     summary: Create a template preset
 *     tags: [Template presets]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, type, params]
 *             properties:
 *               name: { type: string }
 *               type: { type: string }
 *               params: { type: object }
 *     responses:
 *       201:
 *         description: Created
 *       400:
 *         description: Validation error
 */
// Create a preset
templatePresetRoutes.post("/", authMiddleware, (req: AuthRequest, res) => {
  const validationError = validateTemplatePresetCreate(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const { name, type, params } = req.body;
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    "INSERT INTO template_presets (id, user_id, name, type, params) VALUES (?, ?, ?, ?, ?)",
  ).run(id, req.userId!, name, type, JSON.stringify(params));

  res.status(201).json({ id, name, type, params });
});

// Rename a preset or update its params (owner only)
templatePresetRoutes.put("/:id", authMiddleware, (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db
    .prepare("SELECT user_id FROM template_presets WHERE id = ?")
    .get(req.params.id) as any;

  if (!existing) {
    res.status(404).json({ error: "Šablona nebyla nalezena" });
    return;
  }
  if (existing.user_id !== req.userId) {
    res.status(403).json({ error: "Nemáte oprávnění" });
    return;
  }

  const validationError = validateTemplatePresetUpdate(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const { name, params } = req.body;
  const updates: string[] = [];
  const values: any[] = [];
  if (name !== undefined) {
    updates.push("name = ?");
    values.push(name);
  }
  if (params !== undefined) {
    updates.push("params = ?");
    values.push(JSON.stringify(params));
  }

  if (updates.length > 0) {
    values.push(req.params.id);
    db.prepare(
      `UPDATE template_presets SET ${updates.join(", ")} WHERE id = ?`,
    ).run(...values);
  }

  res.json({ id: req.params.id });
});

// Delete a preset (owner only)
templatePresetRoutes.delete("/:id", authMiddleware, (req: AuthRequest, res) => {
  const db = getDb();
  const existing = db
    .prepare("SELECT user_id FROM template_presets WHERE id = ?")
    .get(req.params.id) as any;

  if (!existing) {
    res.status(404).json({ error: "Šablona nebyla nalezena" });
    return;
  }
  if (existing.user_id !== req.userId) {
    res.status(403).json({ error: "Nemáte oprávnění" });
    return;
  }

  db.prepare("DELETE FROM template_presets WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});
