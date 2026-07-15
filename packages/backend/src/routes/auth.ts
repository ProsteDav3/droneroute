import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../models/db.js";
import {
  hashPassword,
  comparePassword,
  generateToken,
  verifyGoogleToken,
} from "../services/authService.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";

export const authRoutes = Router();

const isSelfHosted = () => (process.env.SELF_HOSTED ?? "true") === "true";

// Registration is a one-time bootstrap: the first account ever created
// becomes the admin, and every account after that must be created by an
// admin via /api/admin/users. This keeps the deployment private by default
// instead of publicly self-service.
const isRegistrationOpen = () =>
  (getDb().prepare("SELECT COUNT(*) as count FROM users").get() as any)
    .count === 0;

// Optional extra gate on the bootstrap window itself: with no secret
// involved, whoever's request reaches a freshly-deployed instance first
// becomes admin, which is a real risk if the instance is reachable before
// the operator has a chance to sign in. Setting BOOTSTRAP_TOKEN closes that
// window — only the operator (who knows the token) can complete the first
// registration.
const bootstrapToken = () => process.env.BOOTSTRAP_TOKEN || null;

// Rely on the app-wide globalLimiter here rather than authLimiter: this
// route always returns 200, and authLimiter's skipSuccessfulRequests would
// make it exempt from any real limiting.
authRoutes.get("/status", (_req, res) => {
  const open = isSelfHosted() && isRegistrationOpen();
  res.json({
    registrationOpen: open,
    requiresBootstrapToken: open && !!bootstrapToken(),
  });
});

// ---------------------------------------------------------------------------
// Google OAuth sign-in (cloud mode only)
// ---------------------------------------------------------------------------
authRoutes.post("/google", authLimiter, async (req, res) => {
  if (isSelfHosted()) {
    res.status(404).json({
      error: "Google authentication is not available in self-hosted mode",
    });
    return;
  }

  const { credential } = req.body;
  if (!credential) {
    res.status(400).json({ error: "Missing Google credential" });
    return;
  }

  let verified;
  try {
    verified = await verifyGoogleToken(credential);
  } catch {
    res.status(500).json({ error: "Google authentication is not configured" });
    return;
  }

  if (!verified) {
    res.status(401).json({ error: "Invalid Google credential" });
    return;
  }

  const { email, googleId } = verified;
  const db = getDb();

  // Check if a user with this google_id already exists
  const existingByGoogle = db
    .prepare(
      "SELECT id, email, is_admin, is_banned FROM users WHERE google_id = ?",
    )
    .get(googleId) as any;

  if (existingByGoogle) {
    if (existingByGoogle.is_banned) {
      res
        .status(403)
        .json({ error: "Your account has been suspended", banned: true });
      return;
    }
    db.prepare(
      "UPDATE users SET last_login_at = datetime('now') WHERE id = ?",
    ).run(existingByGoogle.id);
    const token = generateToken(
      existingByGoogle.id,
      !!existingByGoogle.is_admin,
    );
    res.json({
      token,
      userId: existingByGoogle.id,
      email: existingByGoogle.email,
      isAdmin: !!existingByGoogle.is_admin,
    });
    return;
  }

  // Check if a user with this email exists (existing user linking Google account)
  const existingByEmail = db
    .prepare(
      "SELECT id, email, is_admin, is_banned FROM users WHERE LOWER(email) = LOWER(?)",
    )
    .get(email) as any;

  if (existingByEmail) {
    if (existingByEmail.is_banned) {
      res
        .status(403)
        .json({ error: "Your account has been suspended", banned: true });
      return;
    }
    // Link Google account and verify email
    db.prepare(
      "UPDATE users SET google_id = ?, email_verified = 1, last_login_at = datetime('now') WHERE id = ?",
    ).run(googleId, existingByEmail.id);

    const token = generateToken(existingByEmail.id, !!existingByEmail.is_admin);
    res.json({
      token,
      userId: existingByEmail.id,
      email: existingByEmail.email,
      isAdmin: !!existingByEmail.is_admin,
    });
    return;
  }

  // New user — create account with Google info (no password)
  const id = uuidv4();
  let isAdmin = false;
  const adminEmail = process.env.ADMIN_EMAIL || "";
  if (adminEmail && email.toLowerCase() === adminEmail.toLowerCase()) {
    isAdmin = true;
  }

  db.prepare(
    "INSERT INTO users (id, email, password_hash, google_id, email_verified, is_admin, last_login_at) VALUES (?, ?, '', ?, 1, ?, datetime('now'))",
  ).run(id, email, googleId, isAdmin ? 1 : 0);

  const token = generateToken(id, isAdmin);
  res.status(201).json({ token, userId: id, email, isAdmin });
});

// ---------------------------------------------------------------------------
// Password-based routes (self-hosted mode only)
// ---------------------------------------------------------------------------
authRoutes.post("/register", authLimiter, (req, res) => {
  if (!isSelfHosted()) {
    res.status(410).json({
      error: "Password registration is disabled. Use Google sign-in.",
    });
    return;
  }

  const { email, password, bootstrapToken: providedToken } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  const requiredToken = bootstrapToken();
  if (requiredToken && providedToken !== requiredToken) {
    res.status(403).json({ error: "Invalid bootstrap token" });
    return;
  }

  const db = getDb();
  const id = uuidv4();
  const passwordHash = hashPassword(password);

  // Wrap the open-check and the insert in an IMMEDIATE transaction, which
  // takes SQLite's write lock up front. That closes a cross-process race
  // (two machines both seeing an empty table and both inserting a
  // "founder" admin) that a plain check-then-insert would leave open if
  // this is ever scaled beyond a single process sharing one DB file.
  const registerFounder = db.transaction((): boolean => {
    if (!isRegistrationOpen()) {
      return false;
    }
    db.prepare(
      "INSERT INTO users (id, email, password_hash, email_verified, is_admin) VALUES (?, ?, ?, 1, 1)",
    ).run(id, email, passwordHash);
    return true;
  });

  if (!registerFounder.immediate()) {
    res.status(403).json({
      error: "Registration is closed. Ask the site owner for an account.",
    });
    return;
  }

  const token = generateToken(id, true);
  res.status(201).json({ token, userId: id, email, isAdmin: true });
});

authRoutes.post("/login", authLimiter, (req, res) => {
  if (!isSelfHosted()) {
    res
      .status(410)
      .json({ error: "Password login is disabled. Use Google sign-in." });
    return;
  }

  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const db = getDb();
  const user = db
    .prepare(
      "SELECT id, email, password_hash, is_admin, is_banned FROM users WHERE email = ?",
    )
    .get(email) as any;

  if (
    !user ||
    !user.password_hash ||
    !comparePassword(password, user.password_hash)
  ) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (user.is_banned) {
    res
      .status(403)
      .json({ error: "Your account has been suspended", banned: true });
    return;
  }

  // Recovery path for self-hosted installs that already have users but no
  // admin (e.g. upgraded from before is_admin existed, or the founder
  // account was lost) — ADMIN_EMAIL grants admin on login, mirroring the
  // same mechanism already used for cloud-mode Google sign-in.
  const adminEmail = process.env.ADMIN_EMAIL || "";
  if (
    adminEmail &&
    !user.is_admin &&
    user.email.toLowerCase() === adminEmail.toLowerCase()
  ) {
    db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(user.id);
    user.is_admin = 1;
  }

  db.prepare(
    "UPDATE users SET last_login_at = datetime('now') WHERE id = ?",
  ).run(user.id);
  const token = generateToken(user.id, !!user.is_admin);
  res.json({
    token,
    userId: user.id,
    email: user.email,
    isAdmin: !!user.is_admin,
  });
});

authRoutes.post(
  "/change-password",
  authLimiter,
  authMiddleware,
  (req: AuthRequest, res) => {
    if (!isSelfHosted()) {
      res
        .status(410)
        .json({ error: "Password management is disabled in cloud mode." });
      return;
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res
        .status(400)
        .json({ error: "Current password and new password are required" });
      return;
    }
    if (newPassword.length < 6) {
      res
        .status(400)
        .json({ error: "New password must be at least 6 characters" });
      return;
    }

    const db = getDb();
    const user = db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(req.userId) as any;

    if (
      !user ||
      !user.password_hash ||
      !comparePassword(currentPassword, user.password_hash)
    ) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    const newHash = hashPassword(newPassword);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      newHash,
      req.userId,
    );

    res.json({ message: "Password updated" });
  },
);
