import express from "express";
import request from "supertest";
import { describe, it, expect, beforeAll } from "vitest";
import { initDb } from "../models/db.js";
import { authRoutes } from "./auth.js";
import { missionRoutes } from "./missions.js";

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/missions", missionRoutes);

let token: string;

const validBody = {
  name: "Test mission",
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
  pois: [],
  obstacles: [],
};

beforeAll(async () => {
  initDb();
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email: "missions@test.dev", password: "secret123" });
  token = res.body.token;
});

describe("POST /api/missions — server-side validation", () => {
  it("creates a mission with a valid payload", async () => {
    const res = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
  });

  it("rejects out-of-range coordinates with 400", async () => {
    const res = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ...validBody,
        waypoints: [{ ...validBody.waypoints[0], latitude: 999 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("waypoint coordinates out of range");
  });

  it("rejects a non-array waypoints field with 400", async () => {
    const res = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, waypoints: { not: "an array" } });
    expect(res.status).toBe(400);
  });
});

describe("templateGroups persistence", () => {
  it("round-trips templateGroups through create, get, and update", async () => {
    const templateGroups = {
      g1: { type: "orbit", params: { radiusM: 80, center: [50.06, 14.43] } },
    };

    const create = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, templateGroups });
    expect(create.status).toBe(201);

    const get = await request(app)
      .get(`/api/missions/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.templateGroups).toEqual(templateGroups);

    const updatedGroups = {
      g1: { type: "orbit", params: { radiusM: 120, center: [50.06, 14.43] } },
    };
    const update = await request(app)
      .put(`/api/missions/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ templateGroups: updatedGroups });
    expect(update.status).toBe(200);

    const getAfterUpdate = await request(app)
      .get(`/api/missions/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(getAfterUpdate.body.templateGroups).toEqual(updatedGroups);
  });

  it("defaults to an empty object when templateGroups is omitted", async () => {
    const create = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody);
    expect(create.status).toBe(201);

    const get = await request(app)
      .get(`/api/missions/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.body.templateGroups).toEqual({});
  });

  it("rejects an invalid templateGroups shape with 400", async () => {
    const res = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ...validBody,
        templateGroups: { g1: { type: "not-a-real-type", params: {} } },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid template group type");
  });
});
