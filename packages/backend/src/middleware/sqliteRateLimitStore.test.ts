import express from "express";
import request from "supertest";
import rateLimit from "express-rate-limit";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { initDb, getDb } from "../models/db.js";
import { SqliteRateLimitStore } from "./sqliteRateLimitStore.js";

describe("SqliteRateLimitStore", () => {
  beforeAll(() => {
    initDb();
  });

  beforeEach(() => {
    // Each test gets a clean slate in the shared in-memory test DB.
    getDb().prepare("DELETE FROM rate_limit_hits").run();
  });

  describe("increment()", () => {
    it("starts a key at 1 hit and reports the window's reset time", async () => {
      const store = new SqliteRateLimitStore({
        prefix: "test-a",
        windowMs: 60_000,
      });
      const before = Date.now();

      const result = await store.increment("1.2.3.4");

      expect(result.totalHits).toBe(1);
      expect(result.resetTime!.getTime()).toBeGreaterThanOrEqual(
        before + 60_000,
      );
    });

    it("increments the same key on repeated calls", async () => {
      const store = new SqliteRateLimitStore({
        prefix: "test-b",
        windowMs: 60_000,
      });

      await store.increment("1.2.3.4");
      await store.increment("1.2.3.4");
      const third = await store.increment("1.2.3.4");

      expect(third.totalHits).toBe(3);
    });

    it("keeps different keys independent", async () => {
      const store = new SqliteRateLimitStore({
        prefix: "test-c",
        windowMs: 60_000,
      });

      await store.increment("1.1.1.1");
      await store.increment("1.1.1.1");
      const other = await store.increment("2.2.2.2");

      expect(other.totalHits).toBe(1);
    });

    it("keeps identical keys independent across different limiter prefixes", async () => {
      const storeA = new SqliteRateLimitStore({
        prefix: "limiter-a",
        windowMs: 60_000,
      });
      const storeB = new SqliteRateLimitStore({
        prefix: "limiter-b",
        windowMs: 60_000,
      });

      await storeA.increment("9.9.9.9");
      await storeA.increment("9.9.9.9");
      const bResult = await storeB.increment("9.9.9.9");

      expect(bResult.totalHits).toBe(1);
    });

    it("resets the counter once the window has elapsed", async () => {
      vi.useFakeTimers();
      try {
        const store = new SqliteRateLimitStore({
          prefix: "test-d",
          windowMs: 60_000,
        });

        await store.increment("5.5.5.5");
        await store.increment("5.5.5.5");

        // Advance past the end of the window.
        vi.advanceTimersByTime(60_001);

        const afterReset = await store.increment("5.5.5.5");
        expect(afterReset.totalHits).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("processes many concurrent increments for the same key without lost updates", async () => {
      const store = new SqliteRateLimitStore({
        prefix: "test-e",
        windowMs: 60_000,
      });

      const concurrency = 25;
      const results = await Promise.all(
        Array.from({ length: concurrency }, () => store.increment("6.6.6.6")),
      );

      const totals = results.map((r) => r.totalHits).sort((a, b) => a - b);
      // Every increment must observe a distinct, sequential hit count —
      // if two increments raced and lost an update, we'd see a duplicate
      // or a gap instead of exactly 1..concurrency.
      expect(totals).toEqual(
        Array.from({ length: concurrency }, (_, i) => i + 1),
      );

      const final = await store.get("6.6.6.6");
      expect(final?.totalHits).toBe(concurrency);
    });
  });

  describe("decrement()", () => {
    it("reduces the hit count by one", async () => {
      const store = new SqliteRateLimitStore({
        prefix: "test-f",
        windowMs: 60_000,
      });
      await store.increment("7.7.7.7");
      await store.increment("7.7.7.7");

      await store.decrement("7.7.7.7");

      const result = await store.get("7.7.7.7");
      expect(result?.totalHits).toBe(1);
    });

    it("never goes below zero", async () => {
      const store = new SqliteRateLimitStore({
        prefix: "test-g",
        windowMs: 60_000,
      });
      await store.increment("8.8.8.8");

      await store.decrement("8.8.8.8");
      await store.decrement("8.8.8.8");

      const result = await store.get("8.8.8.8");
      expect(result?.totalHits).toBe(0);
    });

    it("is a no-op for a key that was never incremented", async () => {
      const store = new SqliteRateLimitStore({
        prefix: "test-h",
        windowMs: 60_000,
      });

      await expect(store.decrement("0.0.0.0")).resolves.toBeUndefined();
    });
  });

  describe("resetKey()", () => {
    it("removes the key entirely", async () => {
      const store = new SqliteRateLimitStore({
        prefix: "test-i",
        windowMs: 60_000,
      });
      await store.increment("1.0.0.1");

      await store.resetKey("1.0.0.1");

      const result = await store.get("1.0.0.1");
      expect(result).toBeUndefined();
    });
  });

  describe("resetAll()", () => {
    it("only clears keys under its own prefix", async () => {
      const storeA = new SqliteRateLimitStore({
        prefix: "reset-a",
        windowMs: 60_000,
      });
      const storeB = new SqliteRateLimitStore({
        prefix: "reset-b",
        windowMs: 60_000,
      });
      await storeA.increment("1.0.0.2");
      await storeB.increment("1.0.0.2");

      await storeA.resetAll();

      expect(await storeA.get("1.0.0.2")).toBeUndefined();
      expect((await storeB.get("1.0.0.2"))?.totalHits).toBe(1);
    });
  });

  describe("wired into express-rate-limit middleware", () => {
    function buildApp(max: number) {
      const app = express();
      app.use(
        rateLimit({
          windowMs: 60_000,
          max,
          standardHeaders: true,
          legacyHeaders: false,
          store: new SqliteRateLimitStore({
            prefix: `mw-test-${Math.random()}`,
            windowMs: 60_000,
          }),
        }),
      );
      app.get("/ping", (_req, res) => res.json({ ok: true }));
      return app;
    }

    it("allows requests up to the configured max", async () => {
      const app = buildApp(3);

      for (let i = 0; i < 3; i++) {
        const res = await request(app).get("/ping");
        expect(res.status).toBe(200);
      }
    });

    it("blocks requests once the configured max is exceeded", async () => {
      const app = buildApp(3);

      for (let i = 0; i < 3; i++) {
        await request(app).get("/ping");
      }
      const blocked = await request(app).get("/ping");

      expect(blocked.status).toBe(429);
    });
  });
});
