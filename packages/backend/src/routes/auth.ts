import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../models/db.js";
import {
  hashPassword,
  comparePassword,
  generateToken,
  verifyGoogleToken,
  generateResetToken,
  hashResetToken,
  resetTokenExpiresAt,
  generateTwoFactorChallengeToken,
  verifyTwoFactorChallengeToken,
  generateTotpSecret,
  totpKeyUri,
  verifyTotpCode,
} from "../services/authService.js";
import {
  isEmailConfigured,
  sendPasswordResetEmail,
} from "../services/emailService.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { logger } from "../lib/logger.js";
import { setAuthCookie, clearAuthCookie } from "../lib/authCookie.js";

export const authRoutes = Router();

const isSelfHosted = () => (process.env.SELF_HOSTED ?? "true") === "true";

/**
 * Base URL to build the password-reset link against. Deliberately does NOT
 * fall back to the incoming request's `Host` header — that header is
 * attacker-controlled (there's no reverse-proxy validation pinning it), so
 * trusting it here would let an attacker "poison" a reset link into
 * pointing at a phishing host. `APP_URL` must be set for password reset to
 * work; `null` means "not configured", handled by the caller.
 */
function resolveAppUrl(): string | null {
  return process.env.APP_URL || null;
}

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

/**
 * @openapi
 * /auth/status:
 *   get:
 *     summary: Check whether registration is open
 *     description: >
 *       Self-hosted deployments bootstrap a single founder/admin account:
 *       registration is open only until the very first account is created.
 *     tags: [Auth]
 *     security: []
 *     responses:
 *       200:
 *         description: Registration status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 registrationOpen:
 *                   type: boolean
 *                 requiresBootstrapToken:
 *                   type: boolean
 */
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

/**
 * @openapi
 * /auth/google:
 *   post:
 *     summary: Sign in with Google (cloud mode only)
 *     description: >
 *       Verifies the Google ID token, then links/creates the local account.
 *       Returns 404 when the deployment runs in self-hosted mode.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [credential]
 *             properties:
 *               credential:
 *                 type: string
 *                 description: The Google ID token from `@react-oauth/google`.
 *     responses:
 *       200:
 *         description: Signed in to an existing account
 *       201:
 *         description: New account created and signed in
 *       401:
 *         description: Invalid Google credential
 *       403:
 *         description: Account is banned
 */
// ---------------------------------------------------------------------------
// Google OAuth sign-in (cloud mode only)
// ---------------------------------------------------------------------------
authRoutes.post("/google", authLimiter, async (req, res) => {
  if (isSelfHosted()) {
    res.status(404).json({
      error: "Přihlášení přes Google není v self-hosted režimu dostupné",
    });
    return;
  }

  const { credential } = req.body;
  if (!credential) {
    res.status(400).json({ error: "Chybí přihlašovací údaje Google" });
    return;
  }

  let verified;
  try {
    verified = await verifyGoogleToken(credential);
  } catch {
    res
      .status(500)
      .json({ error: "Přihlášení přes Google není nakonfigurováno" });
    return;
  }

  if (!verified) {
    res.status(401).json({ error: "Neplatné přihlašovací údaje Google" });
    return;
  }

  const { email, googleId } = verified;
  const db = getDb();

  // Check if a user with this google_id already exists
  const existingByGoogle = db
    .prepare(
      "SELECT id, email, is_admin, is_banned, token_version FROM users WHERE google_id = ?",
    )
    .get(googleId) as any;

  if (existingByGoogle) {
    if (existingByGoogle.is_banned) {
      res.status(403).json({ error: "Váš účet byl pozastaven", banned: true });
      return;
    }
    db.prepare(
      "UPDATE users SET last_login_at = datetime('now') WHERE id = ?",
    ).run(existingByGoogle.id);
    const token = generateToken(
      existingByGoogle.id,
      !!existingByGoogle.is_admin,
      existingByGoogle.token_version ?? 0,
    );
    setAuthCookie(res, token);
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
      "SELECT id, email, is_admin, is_banned, token_version FROM users WHERE LOWER(email) = LOWER(?)",
    )
    .get(email) as any;

  if (existingByEmail) {
    if (existingByEmail.is_banned) {
      res.status(403).json({ error: "Váš účet byl pozastaven", banned: true });
      return;
    }
    // Link Google account and verify email
    db.prepare(
      "UPDATE users SET google_id = ?, email_verified = 1, last_login_at = datetime('now') WHERE id = ?",
    ).run(googleId, existingByEmail.id);

    const token = generateToken(
      existingByEmail.id,
      !!existingByEmail.is_admin,
      existingByEmail.token_version ?? 0,
    );
    setAuthCookie(res, token);
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

  const token = generateToken(id, isAdmin, 0);
  setAuthCookie(res, token);
  res.status(201).json({ token, userId: id, email, isAdmin });
});

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Bootstrap the first (founder/admin) account (self-hosted only)
 *     description: >
 *       Only succeeds while registration is open (no users exist yet). Every
 *       account after the first must be created by that admin via
 *       `/admin/users`. Returns 410 in cloud mode (use `/auth/google`).
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *               bootstrapToken:
 *                 type: string
 *                 description: Required only when `BOOTSTRAP_TOKEN` is set server-side.
 *     responses:
 *       201:
 *         description: Founder account created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 userId:
 *                   type: string
 *                 email:
 *                   type: string
 *                 isAdmin:
 *                   type: boolean
 *       400:
 *         description: Missing/invalid email or password
 *       403:
 *         description: Registration is closed, or bootstrap token is wrong
 */
// ---------------------------------------------------------------------------
// Password-based routes (self-hosted mode only)
// ---------------------------------------------------------------------------
authRoutes.post("/register", authLimiter, (req, res) => {
  if (!isSelfHosted()) {
    res.status(410).json({
      error: "Registrace heslem je vypnutá. Použijte přihlášení přes Google.",
    });
    return;
  }

  const { email, password, bootstrapToken: providedToken } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "E-mail a heslo jsou povinné" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Heslo musí mít alespoň 6 znaků" });
    return;
  }

  const requiredToken = bootstrapToken();
  if (requiredToken && providedToken !== requiredToken) {
    res.status(403).json({ error: "Neplatný bootstrap token" });
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
      error: "Registrace je uzavřená. Požádejte provozovatele webu o účet.",
    });
    return;
  }

  const token = generateToken(id, true, 0);
  setAuthCookie(res, token);
  res.status(201).json({ token, userId: id, email, isAdmin: true });
});

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Sign in with email + password (self-hosted mode only)
 *     description: Returns 410 in cloud mode (use `/auth/google`).
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Signed in
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 userId:
 *                   type: string
 *                 email:
 *                   type: string
 *                 isAdmin:
 *                   type: boolean
 *       401:
 *         description: Invalid email or password
 *       403:
 *         description: Account is banned
 */
authRoutes.post("/login", authLimiter, (req, res) => {
  if (!isSelfHosted()) {
    res.status(410).json({
      error: "Přihlášení heslem je vypnuté. Použijte přihlášení přes Google.",
    });
    return;
  }

  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "E-mail a heslo jsou povinné" });
    return;
  }

  const db = getDb();
  const user = db
    .prepare(
      "SELECT id, email, password_hash, is_admin, is_banned, totp_enabled, token_version FROM users WHERE email = ?",
    )
    .get(email) as any;

  if (
    !user ||
    !user.password_hash ||
    !comparePassword(password, user.password_hash)
  ) {
    res.status(401).json({ error: "Neplatný e-mail nebo heslo" });
    return;
  }

  if (user.is_banned) {
    res.status(403).json({ error: "Váš účet byl pozastaven", banned: true });
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

  // Password check passed — if 2FA is enabled, don't issue the real session
  // JWT yet. Hand back a short-lived challenge token instead; the client
  // must complete POST /api/auth/2fa/login with the current TOTP code
  // before a real token (and last_login_at bump) is granted.
  if (user.totp_enabled) {
    const challengeToken = generateTwoFactorChallengeToken(user.id);
    res.json({ requiresTwoFactor: true, challengeToken });
    return;
  }

  db.prepare(
    "UPDATE users SET last_login_at = datetime('now') WHERE id = ?",
  ).run(user.id);
  const token = generateToken(
    user.id,
    !!user.is_admin,
    user.token_version ?? 0,
  );
  setAuthCookie(res, token);
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
        .json({ error: "Správa hesla je v cloud režimu vypnutá." });
      return;
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      res
        .status(400)
        .json({ error: "Současné heslo a nové heslo jsou povinné" });
      return;
    }
    if (newPassword.length < 6) {
      res.status(400).json({ error: "Nové heslo musí mít alespoň 6 znaků" });
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
      res.status(401).json({ error: "Současné heslo je nesprávné" });
      return;
    }

    const newHash = hashPassword(newPassword);
    // Bumping token_version invalidates every previously issued JWT for
    // this account — including the one used to make this very request —
    // so a stolen-but-not-yet-noticed token stops working the moment the
    // legitimate owner changes their password.
    db.prepare(
      "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?",
    ).run(newHash, req.userId);

    res.json({ message: "Heslo bylo změněno. Přihlaste se prosím znovu." });
  },
);

// ---------------------------------------------------------------------------
// Password reset (self-hosted mode only — cloud mode uses Google sign-in
// and has no local password to reset)
// ---------------------------------------------------------------------------

authRoutes.post("/forgot-password", authLimiter, (req, res) => {
  if (!isSelfHosted()) {
    res.status(410).json({
      error:
        "Obnova hesla není v cloud režimu dostupná. Použijte přihlášení přes Google.",
    });
    return;
  }

  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "E-mail je povinný" });
    return;
  }

  // Always the same response regardless of whether the account exists (or
  // is banned) — the whole point is that a caller can't use this endpoint
  // to enumerate registered emails. That guarantee has to hold for
  // *response timing* too, not just the response body: below, both
  // branches always do one SELECT, one token hash, and one further DB
  // statement, and the one genuinely variable-cost step (sending the
  // email) is never awaited inline, so neither "does this account exist"
  // nor "is SMTP configured and reachable" can be inferred from how long
  // the request takes.
  const genericResponse = {
    message:
      "Pokud tento e-mail existuje, byl na něj odeslán odkaz pro obnovení hesla",
  };

  const db = getDb();
  const user = db
    .prepare(
      "SELECT id, email, is_banned FROM users WHERE LOWER(email) = LOWER(?)",
    )
    .get(email) as any;

  const isRealRecipient = !!user && !user.is_banned;
  const rawToken = generateResetToken();

  if (isRealRecipient) {
    db.prepare(
      "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
    ).run(uuidv4(), user.id, hashResetToken(rawToken), resetTokenExpiresAt());
  } else {
    // `password_reset_tokens.user_id` has an enforced FOREIGN KEY
    // (better-sqlite3 defaults `PRAGMA foreign_keys = ON`, confirmed —
    // inserting a row against a made-up user id throws), so a decoy INSERT
    // isn't an option here. A same-table read of comparable cost stands in
    // for it instead, so the non-existent-account path still touches the
    // database once past the initial lookup rather than short-circuiting
    // straight to the response.
    db.prepare("SELECT COUNT(*) as count FROM password_reset_tokens").get();
  }

  if (isRealRecipient) {
    const appUrl = resolveAppUrl();

    if (!appUrl) {
      logger.error(
        "[password-reset] APP_URL is not configured — cannot build a reset link. Set APP_URL in the environment.",
      );
    } else {
      const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;

      // No email transport configured yet is a normal, expected state for a
      // fresh self-hosted install (see services/emailService.ts) — the
      // request still "succeeds" from the caller's perspective, it just
      // falls back to an operator manually relaying the link instead of
      // silently pretending an email went out. Same honest-degradation
      // pattern as the DJI Cloud bridge when its env vars are unset.
      //
      // Deliberately not awaited: blocking the response on an SMTP round
      // trip would make latency depend on account existence again, exactly
      // the side-channel the generic response above is meant to close.
      if (isEmailConfigured()) {
        sendPasswordResetEmail(user.email, resetUrl).catch((err) => {
          logger.error({ err }, "[password-reset] SMTP delivery failed");
          logger.error(
            `[password-reset] manual relay needed — send this link to ${user.email}: ${resetUrl}`,
          );
        });
      } else {
        logger.error(
          `[password-reset] SMTP not configured — manually relay this link to ${user.email}: ${resetUrl}`,
        );
      }
    }
  }

  res.json(genericResponse);
});

authRoutes.post("/reset-password", authLimiter, (req, res) => {
  if (!isSelfHosted()) {
    res.status(410).json({
      error:
        "Obnova hesla není v cloud režimu dostupná. Použijte přihlášení přes Google.",
    });
    return;
  }

  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    res.status(400).json({ error: "Token a nové heslo jsou povinné" });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: "Nové heslo musí mít alespoň 6 znaků" });
    return;
  }

  const db = getDb();
  const tokenHash = hashResetToken(token);
  const record = db
    .prepare(
      "SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token_hash = ?",
    )
    .get(tokenHash) as any;

  const invalidTokenError = {
    error: "Odkaz pro obnovení hesla je neplatný nebo již vypršel",
  };

  if (
    !record ||
    record.used ||
    new Date(record.expires_at).getTime() < Date.now()
  ) {
    res.status(400).json(invalidTokenError);
    return;
  }

  const newHash = hashPassword(newPassword);

  // Same reasoning as change-password: bump token_version so every session
  // issued before the reset (including one an attacker may have obtained)
  // is invalidated immediately.
  const applyReset = db.transaction(() => {
    db.prepare(
      "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?",
    ).run(newHash, record.user_id);
    db.prepare("UPDATE password_reset_tokens SET used = 1 WHERE id = ?").run(
      record.id,
    );
  });
  applyReset();

  res.json({
    message: "Heslo bylo úspěšně změněno. Přihlaste se prosím znovu.",
  });
});

/**
 * Clears the httpOnly auth cookie. The frontend's own JS can't do this
 * itself (that's the point of `httpOnly`), so logout now needs a real
 * request instead of just clearing localStorage client-side. No-op for
 * CLI/API clients using the Authorization header — they simply discard
 * their own stored token instead.
 */
authRoutes.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ message: "Odhlášeno" });
});

// ---------------------------------------------------------------------------
// Current user profile (used by the account settings dialog to show 2FA state)
// ---------------------------------------------------------------------------

authRoutes.get("/me", authMiddleware, (req: AuthRequest, res) => {
  const db = getDb();
  const user = db
    .prepare("SELECT email, is_admin, totp_enabled FROM users WHERE id = ?")
    .get(req.userId) as any;

  if (!user) {
    res.status(401).json({ error: "Uživatel nenalezen" });
    return;
  }

  res.json({
    userId: req.userId,
    email: user.email,
    isAdmin: !!user.is_admin,
    totpEnabled: !!user.totp_enabled,
  });
});

// ---------------------------------------------------------------------------
// 2FA (TOTP)
// ---------------------------------------------------------------------------

authRoutes.post(
  "/2fa/setup",
  authLimiter,
  authMiddleware,
  (req: AuthRequest, res) => {
    const db = getDb();
    const user = db
      .prepare("SELECT email, totp_enabled FROM users WHERE id = ?")
      .get(req.userId) as any;

    if (!user) {
      res.status(401).json({ error: "Uživatel nenalezen" });
      return;
    }
    if (user.totp_enabled) {
      res.status(400).json({ error: "Dvoufázové ověření je již zapnuté" });
      return;
    }

    // Generated and stored as "pending" — it only takes effect once
    // /2fa/verify confirms the user actually has it in their authenticator
    // app (otherwise a mistyped/never-completed setup could lock them out).
    const secret = generateTotpSecret();
    db.prepare("UPDATE users SET totp_secret = ? WHERE id = ?").run(
      secret,
      req.userId,
    );

    res.json({ secret, otpauthUrl: totpKeyUri(user.email, secret) });
  },
);

authRoutes.post(
  "/2fa/verify",
  authLimiter,
  authMiddleware,
  (req: AuthRequest, res) => {
    const { code } = req.body;
    if (!code) {
      res.status(400).json({ error: "Kód je povinný" });
      return;
    }

    const db = getDb();
    const user = db
      .prepare("SELECT totp_secret FROM users WHERE id = ?")
      .get(req.userId) as any;

    if (!user?.totp_secret) {
      res
        .status(400)
        .json({ error: "Nastavení dvoufázového ověření nebylo zahájeno" });
      return;
    }

    if (!verifyTotpCode(user.totp_secret, code)) {
      res.status(401).json({ error: "Neplatný kód" });
      return;
    }

    db.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").run(
      req.userId,
    );
    res.json({ message: "Dvoufázové ověření bylo zapnuto" });
  },
);

authRoutes.post(
  "/2fa/disable",
  authLimiter,
  authMiddleware,
  (req: AuthRequest, res) => {
    const { currentPassword } = req.body;
    if (!currentPassword) {
      res.status(400).json({ error: "Současné heslo je povinné" });
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
      res.status(401).json({ error: "Současné heslo je nesprávné" });
      return;
    }

    db.prepare(
      "UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?",
    ).run(req.userId);
    res.json({ message: "Dvoufázové ověření bylo vypnuto" });
  },
);

authRoutes.post("/2fa/login", authLimiter, (req, res) => {
  const { challengeToken, code } = req.body;
  if (!challengeToken || !code) {
    res.status(400).json({ error: "Challenge token a kód jsou povinné" });
    return;
  }

  const challenge = verifyTwoFactorChallengeToken(challengeToken);
  if (!challenge) {
    res.status(401).json({ error: "Neplatný nebo vypršený challenge token" });
    return;
  }

  const db = getDb();
  const user = db
    .prepare(
      "SELECT id, email, is_admin, is_banned, totp_secret, totp_enabled, token_version FROM users WHERE id = ?",
    )
    .get(challenge.userId) as any;

  // totp_enabled could have been turned off between the first login step
  // and this one — treat that the same as an invalid challenge rather than
  // silently granting a token through a code check that no longer applies.
  if (!user || !user.totp_enabled || !user.totp_secret) {
    res.status(401).json({ error: "Neplatný nebo vypršený challenge token" });
    return;
  }
  if (user.is_banned) {
    res.status(403).json({ error: "Váš účet byl pozastaven", banned: true });
    return;
  }
  if (!verifyTotpCode(user.totp_secret, code)) {
    res.status(401).json({ error: "Neplatný kód" });
    return;
  }

  db.prepare(
    "UPDATE users SET last_login_at = datetime('now') WHERE id = ?",
  ).run(user.id);
  const token = generateToken(
    user.id,
    !!user.is_admin,
    user.token_version ?? 0,
  );
  setAuthCookie(res, token);
  res.json({
    token,
    userId: user.id,
    email: user.email,
    isAdmin: !!user.is_admin,
  });
});
