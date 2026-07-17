import express from "express";
import request from "supertest";
import { describe, it, expect, beforeAll } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { initDb, getDb } from "../models/db.js";
import { hashPassword, generateToken } from "../services/authService.js";
import { authRoutes } from "./auth.js";
import { missionRoutes } from "./missions.js";
import { riskAssessmentRoutes } from "./riskAssessments.js";

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/missions", missionRoutes);
app.use("/api/risk-assessments", riskAssessmentRoutes);

let token: string;
let otherToken: string;
let missionId: string;
let otherMissionId: string;

const validMission = {
  name: "Risk assessment test mission",
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
    .send({ email: "risk@test.dev", password: "secret123" });
  token = res.body.token;

  const otherId = uuidv4();
  getDb()
    .prepare(
      "INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, 1)",
    )
    .run(otherId, "risk-other@test.dev", hashPassword("secret123"));
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

describe("risk assessments — auth", () => {
  it("rejects requests without a token", async () => {
    const res = await request(app).get(`/api/risk-assessments/${missionId}`);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/risk-assessments/:missionId", () => {
  it("returns 404 when none exists yet", async () => {
    const res = await request(app)
      .get(`/api/risk-assessments/${missionId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("returns 403 for a mission owned by another user", async () => {
    const res = await request(app)
      .get(`/api/risk-assessments/${otherMissionId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("returns 404 for a nonexistent mission", async () => {
    const res = await request(app)
      .get("/api/risk-assessments/does-not-exist")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/risk-assessments/:missionId — validation and upsert", () => {
  it("rejects an invalid groundRiskClass", async () => {
    const res = await request(app)
      .put(`/api/risk-assessments/${missionId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ groundRiskClass: "extreme", airRiskClass: "low" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid airRiskClass", async () => {
    const res = await request(app)
      .put(`/api/risk-assessments/${missionId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ groundRiskClass: "low", airRiskClass: "extreme" });
    expect(res.status).toBe(400);
  });

  it("creates then updates the assessment for a mission (upsert)", async () => {
    const create = await request(app)
      .put(`/api/risk-assessments/${missionId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        groundRiskClass: "low",
        airRiskClass: "low",
        mitigations: ["ground_observer"],
      });
    expect(create.status).toBe(200);

    const get1 = await request(app)
      .get(`/api/risk-assessments/${missionId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get1.body.groundRiskClass).toBe("low");
    expect(get1.body.mitigations).toEqual(["ground_observer"]);

    const update = await request(app)
      .put(`/api/risk-assessments/${missionId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        groundRiskClass: "high",
        airRiskClass: "medium",
        mitigations: ["safety_net", "geofencing"],
      });
    expect(update.status).toBe(200);

    const get2 = await request(app)
      .get(`/api/risk-assessments/${missionId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get2.body.groundRiskClass).toBe("high");
    expect(get2.body.airRiskClass).toBe("medium");
    expect(get2.body.mitigations).toEqual(["safety_net", "geofencing"]);
  });

  it("rejects writes to a mission owned by another user", async () => {
    const res = await request(app)
      .put(`/api/risk-assessments/${otherMissionId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ groundRiskClass: "low", airRiskClass: "low" });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/risk-assessments/:missionId", () => {
  it("removes the assessment", async () => {
    await request(app)
      .put(`/api/risk-assessments/${missionId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ groundRiskClass: "low", airRiskClass: "low" });

    const del = await request(app)
      .delete(`/api/risk-assessments/${missionId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);

    const get = await request(app)
      .get(`/api/risk-assessments/${missionId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(404);
  });
});
