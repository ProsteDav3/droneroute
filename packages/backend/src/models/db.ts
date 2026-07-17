import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, "../../data/genmap.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
  }
  return db;
}

export function initDb(): void {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      google_id TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,
      is_admin INTEGER NOT NULL DEFAULT 0,
      is_banned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT,
      config TEXT NOT NULL,
      waypoints TEXT NOT NULL,
      pois TEXT NOT NULL DEFAULT '[]',
      share_token TEXT UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Migration: add pois column if missing (for existing DBs)
  try {
    database.exec(
      `ALTER TABLE missions ADD COLUMN pois TEXT NOT NULL DEFAULT '[]'`,
    );
  } catch {
    // Column already exists — ignore
  }

  // Migration: add share_token column if missing (for existing DBs)
  try {
    database.exec(`ALTER TABLE missions ADD COLUMN share_token TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add obstacles column if missing (for existing DBs)
  try {
    database.exec(
      `ALTER TABLE missions ADD COLUMN obstacles TEXT NOT NULL DEFAULT '[]'`,
    );
  } catch {
    // Column already exists — ignore
  }

  // Migration: add buildings column if missing (for existing DBs)
  try {
    database.exec(
      `ALTER TABLE missions ADD COLUMN buildings TEXT NOT NULL DEFAULT '[]'`,
    );
  } catch {
    // Column already exists — ignore
  }

  // Migration: add template_groups column if missing (for existing DBs)
  try {
    database.exec(
      `ALTER TABLE missions ADD COLUMN template_groups TEXT NOT NULL DEFAULT '{}'`,
    );
  } catch {
    // Column already exists — ignore
  }

  // Ensure unique index on share_token
  database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_missions_share_token ON missions(share_token) WHERE share_token IS NOT NULL`,
  );

  // Migration: add client column if missing (for existing DBs) — free-text
  // client/project name so missions can be organized per client or order.
  try {
    database.exec(`ALTER TABLE missions ADD COLUMN client TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add is_admin column if missing (for existing DBs)
  try {
    database.exec(
      `ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0`,
    );
  } catch {
    // Column already exists — ignore
  }

  // Migration: add is_banned column if missing (for existing DBs)
  try {
    database.exec(
      `ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0`,
    );
  } catch {
    // Column already exists — ignore
  }

  // Migration: add google_id column if missing (for existing DBs)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN google_id TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add email_verified column if missing (for existing DBs)
  try {
    database.exec(
      `ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0`,
    );
  } catch {
    // Column already exists — ignore
  }

  // Migration: add last_login_at column if missing (for existing DBs)
  try {
    database.exec(`ALTER TABLE users ADD COLUMN last_login_at TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: create user_preferences table
  database.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      preferences TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Migration: create template_presets table
  database.exec(`
    CREATE TABLE IF NOT EXISTS template_presets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      params TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Migration: add folder column if missing (for existing DBs) — free-text,
  // single-folder-per-mission tag for organizing the mission list (separate
  // from the client/project field).
  try {
    database.exec(`ALTER TABLE missions ADD COLUMN folder TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: create mission_comments table — visitor comments left on a
  // publicly shared mission. `share_token` is denormalized (copied from
  // missions.share_token at insert time) so the public GET/POST endpoints can
  // resolve comments straight from the token without joining through
  // missions and without ever exposing mission ownership.
  database.exec(`
    CREATE TABLE IF NOT EXISTS mission_comments (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      share_token TEXT NOT NULL,
      author_name TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (mission_id) REFERENCES missions(id)
    );
  `);
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_mission_comments_share_token ON mission_comments(share_token)`,
  );

  // Migration: create mission_versions table — a full JSON snapshot of a
  // mission's editable content, captured on every save. Retention is capped
  // at the most recent 20 rows per mission_id (pruned in the same
  // transaction as the insert — see missions.ts).
  database.exec(`
    CREATE TABLE IF NOT EXISTS mission_versions (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (mission_id) REFERENCES missions(id)
    );
  `);
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_mission_versions_mission_id ON mission_versions(mission_id, created_at)`,
  );

  // Migration: create rate_limit_hits table — backs the SQLite-based
  // express-rate-limit Store (see middleware/sqliteRateLimitStore.ts), which
  // survives redeploys and Fly.io auto_stop_machines cold starts, unlike the
  // library's default in-memory Store. `reset_at` is a Unix ms timestamp;
  // the index keeps the periodic expired-row sweep cheap.
  database.exec(`
    CREATE TABLE IF NOT EXISTS rate_limit_hits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_reset_at
      ON rate_limit_hits(reset_at);
  `);

  // Ensure ADMIN_EMAIL user has admin privileges (cloud mode)
  const selfHosted = (process.env.SELF_HOSTED ?? "true") === "true";
  const adminEmail = process.env.ADMIN_EMAIL || "";
  if (!selfHosted && adminEmail) {
    database
      .prepare("UPDATE users SET is_admin = 1 WHERE LOWER(email) = LOWER(?)")
      .run(adminEmail);
  }

  // Seed a dev account when ADMIN_EMAIL is set (self-hosted, development only)
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev && selfHosted && adminEmail) {
    const existing = database
      .prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)")
      .get(adminEmail);
    if (!existing) {
      const id = uuidv4();
      const passwordHash = bcrypt.hashSync(adminEmail, 10);
      database
        .prepare(
          "INSERT INTO users (id, email, password_hash, email_verified, is_admin) VALUES (?, ?, ?, 1, 1)",
        )
        .run(id, adminEmail, passwordHash);
      console.log(
        `Dev account created for ${adminEmail} (password equals the email — change it after first login)`,
      );
    }
  }

  console.log("Database initialized at", DB_PATH);
}
