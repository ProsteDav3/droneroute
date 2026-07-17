import express from "express";
import request from "supertest";
import { describe, it, expect, beforeAll } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { initDb, getDb } from "../models/db.js";
import { hashPassword, generateToken } from "../services/authService.js";
import { authRoutes } from "./auth.js";
import { missionRoutes } from "./missions.js";
import { flightLogRoutes } from "./flightLogs.js";

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/missions", missionRoutes);
app.use("/api/flight-logs", flightLogRoutes);

let token: string;
let otherToken: string;
let missionId: string;
let otherMissionId: string;

const validMission = {
  name: "Flight log test mission",
  config: { autoFlightSpeed: 5 },
  waypoints: [
    {
      index: 0,
      name: "WP1",
      latitude: 41.25,
      longitude: 0.93,
      height: 30,
      speed: 5,
      gimbalPitchAngle: 0,
    },
    {
      index: 1,
      name: "WP2",
      latitude: 41.26,
      longitude: 0.94,
      height: 30,
      speed: 5,
      gimbalPitchAngle: 0,
    },
  ],
};

beforeAll(async () => {
  initDb();
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email: "flightlogs@test.dev", password: "secret123" });
  token = res.body.token;

  // Registration is a one-time bootstrap (closed after the first account),
  // so the second test user is inserted directly rather than via /register.
  const otherId = uuidv4();
  getDb()
    .prepare(
      "INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, 1)",
    )
    .run(otherId, "flightlogs-other@test.dev", hashPassword("secret123"));
  otherToken = generateToken(otherId, false);

  const missionRes = await request(app)
    .post("/api/missions")
    .set("Authorization", `Bearer ${token}`)
    .send(validMission);
  missionId = missionRes.body.id;

  const otherMissionRes = await request(app)
    .post("/api/missions")
    .set("Authorization", `Bearer ${otherToken}`)
    .send(validMission);
  otherMissionId = otherMissionRes.body.id;
});

describe("flight logs — auth", () => {
  it("rejects requests without a token", async () => {
    const res = await request(app).get("/api/flight-logs");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/flight-logs — validation", () => {
  it("creates a log entry with a valid payload", async () => {
    const res = await request(app)
      .post("/api/flight-logs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        missionId,
        flownAt: "2026-07-15",
        durationMinutes: 22.5,
        notes: "Windy but fine",
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
  });

  it("creates a log entry without a missionId (freeform log)", async () => {
    const res = await request(app)
      .post("/api/flight-logs")
      .set("Authorization", `Bearer ${token}`)
      .send({ flownAt: "2026-07-14", durationMinutes: 10 });
    expect(res.status).toBe(201);
  });

  it("rejects an invalid flownAt date", async () => {
    const res = await request(app)
      .post("/api/flight-logs")
      .set("Authorization", `Bearer ${token}`)
      .send({ flownAt: "not-a-date", durationMinutes: 10 });
    expect(res.status).toBe(400);
  });

  it("rejects a negative duration", async () => {
    const res = await request(app)
      .post("/api/flight-logs")
      .set("Authorization", `Bearer ${token}`)
      .send({ flownAt: "2026-07-14", durationMinutes: -5 });
    expect(res.status).toBe(400);
  });

  it("rejects a missionId that doesn't belong to the caller", async () => {
    const res = await request(app)
      .post("/api/flight-logs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        missionId: otherMissionId,
        flownAt: "2026-07-14",
        durationMinutes: 10,
      });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/flight-logs", () => {
  it("only lists the current user's logs", async () => {
    const res = await request(app)
      .get("/api/flight-logs")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("filters by missionId when provided", async () => {
    const res = await request(app)
      .get(`/api/flight-logs?missionId=${missionId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(
      res.body.every(
        (log: { missionId: string }) => log.missionId === missionId,
      ),
    ).toBe(true);
  });
});

describe("DELETE /api/flight-logs/:id", () => {
  it("lets only the owner delete", async () => {
    const create = await request(app)
      .post("/api/flight-logs")
      .set("Authorization", `Bearer ${token}`)
      .send({ flownAt: "2026-07-10", durationMinutes: 5 });
    const id = create.body.id;

    const forbidden = await request(app)
      .delete(`/api/flight-logs/${id}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(forbidden.status).toBe(403);

    const ok = await request(app)
      .delete(`/api/flight-logs/${id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(ok.status).toBe(200);
  });

  it("returns 404 for a nonexistent log", async () => {
    const res = await request(app)
      .delete("/api/flight-logs/does-not-exist")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
