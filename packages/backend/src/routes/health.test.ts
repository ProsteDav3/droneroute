import express from "express";
import request from "supertest";
import { describe, it, expect, vi, beforeEach } from "vitest";

// The DB probe is mocked (rather than using the real in-memory DB from
// models/db.js) so the degraded path — the DB throwing — can be simulated
// deterministically without touching the shared module-level DB singleton
// that other test files in this suite also rely on.
const prepareMock = vi.fn();

vi.mock("../models/db.js", () => ({
  getDb: () => ({ prepare: prepareMock }),
}));

const { healthRoutes } = await import("./health.js");

const app = express();
app.use("/api", healthRoutes);

describe("GET /api/health", () => {
  beforeEach(() => {
    prepareMock.mockReset();
  });

  it("returns ok status with the current uptime and timestamp when the DB is reachable", async () => {
    prepareMock.mockReturnValue({ get: () => ({ "1": 1 }) });

    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", dbOk: true });
    expect(typeof res.body.uptimeSeconds).toBe("number");
    expect(typeof res.body.timestamp).toBe("string");
    expect(new Date(res.body.timestamp).toString()).not.toBe("Invalid Date");
  });

  it("returns degraded status but still HTTP 200 when the DB probe throws", async () => {
    prepareMock.mockImplementation(() => {
      throw new Error("simulated db failure");
    });

    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "degraded", dbOk: false });
  });

  it("requires no authentication", async () => {
    prepareMock.mockReturnValue({ get: () => ({ "1": 1 }) });

    const res = await request(app).get("/api/health");

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
