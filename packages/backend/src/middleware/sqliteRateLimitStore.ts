import type { Store, ClientRateLimitInfo, Options } from "express-rate-limit";
import { getDb } from "../models/db.js";

/**
 * How often (in ms) the shared background sweep deletes expired rows across
 * *all* limiters, regardless of how often any individual limiter's window
 * elapses. Bounded independently of any single limiter's `windowMs` so one
 * very long-lived limiter (e.g. `authLimiter` at 15 minutes) can't leave
 * short-lived limiters' garbage sitting around, and so the table can't grow
 * unbounded from keys that stop being hit (their row would otherwise never
 * get deleted by the per-increment cleanup, which only touches the row for
 * the key currently being incremented).
 */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let sweepStarted = false;

/**
 * Starts a single process-wide interval that deletes expired rate-limit rows.
 * Idempotent and lazy — only runs once real traffic creates a store, and
 * `unref()`'d so it never keeps the Node process alive on its own (important
 * for tests and graceful shutdown).
 */
function ensureSweepStarted(): void {
  if (sweepStarted) return;
  sweepStarted = true;
  const interval = setInterval(() => {
    try {
      getDb()
        .prepare("DELETE FROM rate_limit_hits WHERE reset_at < ?")
        .run(Date.now());
    } catch (err) {
      console.error("Rate limit store sweep failed:", err);
    }
  }, SWEEP_INTERVAL_MS);
  interval.unref?.();
}

/**
 * A `better-sqlite3`-backed `Store` for `express-rate-limit`.
 *
 * The library's default `MemoryStore` resets on every redeploy and doesn't
 * survive Fly.io's `auto_stop_machines` cold starts cleanly — each new
 * machine boot starts every client back at zero. This store persists hit
 * counts in the same SQLite database the rest of the app uses, in a
 * `rate_limit_hits` table (see `models/db.ts`).
 *
 * Each limiter (global, strict, airspace, weather, auth, ...) must construct
 * its **own instance** with a distinct `prefix` — express-rate-limit warns
 * (and this store would silently double-count) if a single `Store` instance
 * is shared across multiple limiters, since they'd otherwise collide on the
 * same IP-derived key.
 */
export class SqliteRateLimitStore implements Store {
  // Named `keyPrefix` (not `prefix`) to avoid colliding with the `Store`
  // interface's own optional `prefix?: string` property — a `private` field
  // with that exact name makes TypeScript treat this class as structurally
  // incompatible with `Store` (private members are nominally, not
  // structurally, checked).
  private readonly keyPrefix: string;
  private windowMs: number;

  /** `localKeys: false` — hits are persisted in SQLite, so (unlike
   * `MemoryStore`) they ARE visible to/affected by other processes sharing
   * the same database file. */
  localKeys = false;

  constructor(options: { prefix: string; windowMs: number }) {
    this.keyPrefix = `${options.prefix}:`;
    this.windowMs = options.windowMs;
    ensureSweepStarted();
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private key(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const row = getDb()
      .prepare("SELECT count, reset_at FROM rate_limit_hits WHERE key = ?")
      .get(this.key(key)) as { count: number; reset_at: number } | undefined;
    if (!row) return undefined;
    return { totalHits: row.count, resetTime: new Date(row.reset_at) };
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const db = getDb();
    const prefixedKey = this.key(key);
    const now = Date.now();
    const windowMs = this.windowMs;

    // Read-then-write wrapped in an IMMEDIATE transaction: takes SQLite's
    // write lock up front, so two processes (or two near-simultaneous
    // requests) incrementing the same key can't both read the same stale
    // row and both "win" the reset-vs-increment branch below.
    const run = db.transaction((): ClientRateLimitInfo => {
      const row = db
        .prepare("SELECT count, reset_at FROM rate_limit_hits WHERE key = ?")
        .get(prefixedKey) as { count: number; reset_at: number } | undefined;

      if (!row || row.reset_at <= now) {
        // Window hasn't started yet, or the previous one has expired —
        // (re)start it at count 1. This doubles as the per-increment
        // cleanup: an expired row is overwritten as soon as its key is
        // hit again, without waiting for the background sweep.
        const resetAt = now + windowMs;
        db.prepare(
          `INSERT INTO rate_limit_hits (key, count, reset_at) VALUES (?, 1, ?)
             ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = excluded.reset_at`,
        ).run(prefixedKey, resetAt);
        return { totalHits: 1, resetTime: new Date(resetAt) };
      }

      db.prepare(
        "UPDATE rate_limit_hits SET count = count + 1 WHERE key = ?",
      ).run(prefixedKey);
      return { totalHits: row.count + 1, resetTime: new Date(row.reset_at) };
    });

    return run.immediate();
  }

  async decrement(key: string): Promise<void> {
    // Used by `skipSuccessfulRequests` / `skipFailedRequests` to undo a hit
    // that shouldn't have counted. Never goes below zero and is a no-op if
    // the key has already expired/been reset.
    getDb()
      .prepare(
        "UPDATE rate_limit_hits SET count = MAX(count - 1, 0) WHERE key = ?",
      )
      .run(this.key(key));
  }

  async resetKey(key: string): Promise<void> {
    getDb()
      .prepare("DELETE FROM rate_limit_hits WHERE key = ?")
      .run(this.key(key));
  }

  async resetAll(): Promise<void> {
    getDb()
      .prepare("DELETE FROM rate_limit_hits WHERE key LIKE ?")
      .run(`${this.keyPrefix}%`);
  }
}
