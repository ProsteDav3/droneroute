import express from "express";
import request from "supertest";
import { describe, it, expect, beforeAll } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { initDb, getDb } from "../models/db.js";
import { hashPassword, generateToken } from "../services/authService.js";
import { authRoutes } from "./auth.js";
import { missionRoutes } from "./missions.js";
import { permitRoutes } from "./permits.js";

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/missions", missionRoutes);
app.use("/api/permits", permitRoutes);

let token: string;
let otherToken: string;
let missionId: string;
let otherMissionId: string;

const validMission = {
  name: "Permit test mission",
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
  ],
};

beforeAll(async () => {
  initDb();
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email: "permits@test.dev", password: "secret123" });
  token = res.body.token;

  const otherId = uuidv4();
  getDb()
    .prepare(
      "INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, 1)",
    )
    .run(otherId, "permits-other@test.dev", hashPassword("secret123"));
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

describe("permits — auth", () => {
  it("rejects requests without a token", async () => {
    const res = await request(app).get(`/api/permits?missionId=${missionId}`);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/permits", () => {
  it("requires a missionId query param", async () => {
    const res = await request(app)
      .get("/api/permits")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("rejects a mission owned by another user", async () => {
    const res = await request(app)
      .get(`/api/permits?missionId=${otherMissionId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/permits — validation", () => {
  it("creates a permit with a valid payload", async () => {
    const res = await request(app)
      .post("/api/permits")
      .set("Authorization", `Bearer ${token}`)
      .send({
        missionId,
        description: "Local authority coordination for restricted zone",
        referenceOrUrl: "REF-2026-001",
        expiryDate: "2026-12-31",
        issuedBy: "Úřad pro civilní letectví",
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
  });

  it("rejects a blank description", async () => {
    const res = await request(app)
      .post("/api/permits")
      .set("Authorization", `Bearer ${token}`)
      .send({ missionId, description: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid expiry date", async () => {
    const res = await request(app)
      .post("/api/permits")
      .set("Authorization", `Bearer ${token}`)
      .send({ missionId, description: "Test", expiryDate: "not-a-date" });
    expect(res.status).toBe(400);
  });

  it("rejects a mission owned by another user", async () => {
    const res = await request(app)
      .post("/api/permits")
      .set("Authorization", `Bearer ${token}`)
      .send({ missionId: otherMissionId, description: "Test" });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/permits — listing", () => {
  it("lists permits for the mission, ordered by expiry", async () => {
    const res = await request(app)
      .get(`/api/permits?missionId=${missionId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe("DELETE /api/permits/:id", () => {
  it("lets only the mission owner delete", async () => {
    const create = await request(app)
      .post("/api/permits")
      .set("Authorization", `Bearer ${token}`)
      .send({ missionId, description: "To be deleted" });
    const id = create.body.id;

    const forbidden = await request(app)
      .delete(`/api/permits/${id}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(forbidden.status).toBe(403);

    const ok = await request(app)
      .delete(`/api/permits/${id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(ok.status).toBe(200);
  });

  it("returns 404 for a nonexistent permit", async () => {
    const res = await request(app)
      .delete("/api/permits/does-not-exist")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
