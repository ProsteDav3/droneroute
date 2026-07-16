import { Router, type Response, type NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../models/db.js";
import { hashPassword } from "../services/authService.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

export const adminRoutes = Router();

/**
 * Record an admin action in the audit log. Never throws — a logging failure
 * must not block the admin action it's recording.
 */
function recordAuditLog(
  adminUserId: string,
  action: string,
  targetUserId: string | null,
  detail: string | null,
): void {
  try {
    getDb()
      .prepare(
        "INSERT INTO audit_log (id, admin_user_id, action, target_user_id, detail) VALUES (?, ?, ?, ?, ?)",
      )
      .run(uuidv4(), adminUserId, action, targetUserId, detail);
  } catch (err) {
    // Best-effort: the admin action itself already succeeded, so we log
    // server-side and move on rather than failing the request.
    logger.error({ err }, "Failed to write audit log entry");
  }
}

// Admin guard — reads env at request time to avoid module initialization issues
function adminGuard(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.userId) {
    res.status(401).json({ error: "Vyžadováno přihlášení" });
    return;
  }

  const db = getDb();
  const user = db
    .prepare("SELECT is_admin FROM users WHERE id = ?")
    .get(req.userId) as any;

  if (!user || !user.is_admin) {
    res.status(403).json({ error: "Vyžadován administrátorský přístup" });
    return;
  }

  next();
}

// All admin routes require auth + admin
adminRoutes.use(authMiddleware, adminGuard);

// POST /api/admin/users — admin creates an account directly (public
// self-registration is closed after the first/founder account).
adminRoutes.post("/users", (req: AuthRequest, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "E-mail a heslo jsou povinné" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Heslo musí mít alespoň 6 znaků" });
    return;
  }

  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(email);
  if (existing) {
    res.status(409).json({ error: "E-mail je již zaregistrovaný" });
    return;
  }

  const id = uuidv4();
  const passwordHash = hashPassword(password);
  db.prepare(
    "INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, 1)",
  ).run(id, email, passwordHash);

  recordAuditLog(req.userId!, "create_user", id, `Created account ${email}`);

  res.status(201).json({ id, email });
});

// GET /api/admin/users?page=1&perPage=10&search=&status=&sortBy=created_at&sortOrder=desc
adminRoutes.get("/users", (req: AuthRequest, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const perPage = Math.min(
    100,
    Math.max(1, parseInt(req.query.perPage as string) || 10),
  );
  const offset = (page - 1) * perPage;
  const search = (req.query.search as string) || "";
  const status = (req.query.status as string) || "";
  const sortBy = (req.query.sortBy as string) || "created_at";
  const sortOrder =
    (req.query.sortOrder as string)?.toLowerCase() === "asc" ? "ASC" : "DESC";

  // Validate sortBy to prevent SQL injection
  const allowedSortColumns: Record<string, string> = {
    email: "u.email",
    created_at: "u.created_at",
    last_login_at: "u.last_login_at",
    mission_count: "mission_count",
  };
  const sortColumn = allowedSortColumns[sortBy] || "u.created_at";

  const db = getDb();

  // Build WHERE clause
  const conditions: string[] = [];
  const params: any[] = [];

  if (search) {
    conditions.push("u.email LIKE ?");
    params.push(`%${search}%`);
  }

  if (status === "admin") {
    conditions.push("u.is_admin = 1");
  } else if (status === "banned") {
    conditions.push("u.is_banned = 1");
  } else if (status === "active") {
    conditions.push("u.is_admin = 0 AND u.is_banned = 0");
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (
    db
      .prepare(`SELECT COUNT(*) as count FROM users u ${whereClause}`)
      .get(...params) as any
  ).count;

  const users = db
    .prepare(
      `SELECT u.id, u.email, u.created_at, u.last_login_at, u.is_admin, u.is_banned,
              COUNT(m.id) as mission_count
       FROM users u
       LEFT JOIN missions m ON m.user_id = u.id
       ${whereClause}
       GROUP BY u.id
       ORDER BY ${sortColumn} ${sortOrder}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, perPage, offset) as any[];

  res.json({
    data: users.map((u) => ({
      id: u.id,
      email: u.email,
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at || null,
      isAdmin: !!u.is_admin,
      isBanned: !!u.is_banned,
      missionCount: u.mission_count,
    })),
    page,
    perPage,
    total,
  });
});

// POST /api/admin/users/:id/ban
adminRoutes.post("/users/:id/ban", (req: AuthRequest, res) => {
  if (req.params.id === req.userId) {
    res.status(400).json({ error: "Nelze zablokovat sám sebe" });
    return;
  }

  const db = getDb();
  const result = db
    .prepare("UPDATE users SET is_banned = 1 WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "Uživatel nenalezen" });
    return;
  }
  recordAuditLog(req.userId!, "ban_user", String(req.params.id), null);
  res.json({ message: "Uživatel zablokován" });
});

// POST /api/admin/users/:id/unban
adminRoutes.post("/users/:id/unban", (req: AuthRequest, res) => {
  if (req.params.id === req.userId) {
    res.status(400).json({ error: "Nelze odblokovat sám sebe" });
    return;
  }

  const db = getDb();
  const result = db
    .prepare("UPDATE users SET is_banned = 0 WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "Uživatel nenalezen" });
    return;
  }
  recordAuditLog(req.userId!, "unban_user", String(req.params.id), null);
  res.json({ message: "Uživatel odblokován" });
});

// POST /api/admin/users/:id/promote
adminRoutes.post("/users/:id/promote", (req: AuthRequest, res) => {
  if (req.params.id === req.userId) {
    res.status(400).json({ error: "Nelze povýšit sám sebe" });
    return;
  }

  const db = getDb();
  const result = db
    .prepare("UPDATE users SET is_admin = 1 WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "Uživatel nenalezen" });
    return;
  }
  recordAuditLog(req.userId!, "promote_user", String(req.params.id), null);
  res.json({ message: "Uživatel povýšen na administrátora" });
});

// POST /api/admin/users/:id/demote
adminRoutes.post("/users/:id/demote", (req: AuthRequest, res) => {
  if (req.params.id === req.userId) {
    res.status(400).json({ error: "Nelze odebrat práva sám sobě" });
    return;
  }

  const db = getDb();
  const result = db
    .prepare("UPDATE users SET is_admin = 0 WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "Uživatel nenalezen" });
    return;
  }
  recordAuditLog(req.userId!, "demote_user", String(req.params.id), null);
  res.json({ message: "Administrátorská práva odebrána" });
});

// GET /api/admin/audit-log?page=1&perPage=20
// Returns audit log entries with the acting admin's and target user's
// emails joined in (not just raw IDs), newest first.
adminRoutes.get("/audit-log", (req: AuthRequest, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const perPage = Math.min(
    100,
    Math.max(1, parseInt(req.query.perPage as string) || 20),
  );
  const offset = (page - 1) * perPage;

  const db = getDb();

  const total = (
    db.prepare("SELECT COUNT(*) as count FROM audit_log").get() as any
  ).count;

  const rows = db
    .prepare(
      `SELECT a.id, a.action, a.detail, a.created_at,
              a.admin_user_id, admin.email AS admin_email,
              a.target_user_id, target.email AS target_email
       FROM audit_log a
       LEFT JOIN users admin ON admin.id = a.admin_user_id
       LEFT JOIN users target ON target.id = a.target_user_id
       ORDER BY a.rowid DESC
       LIMIT ? OFFSET ?`,
    )
    .all(perPage, offset) as any[];

  res.json({
    data: rows.map((r) => ({
      id: r.id,
      action: r.action,
      detail: r.detail,
      createdAt: r.created_at,
      adminUserId: r.admin_user_id,
      adminEmail: r.admin_email || null,
      targetUserId: r.target_user_id,
      targetEmail: r.target_email || null,
    })),
    page,
    perPage,
    total,
  });
});
