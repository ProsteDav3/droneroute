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
    expect(res.body.error).toBe("souřadnice bodu trasy mimo rozsah");
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
    expect(res.body.error).toBe("neplatný typ skupiny šablony");
  });
});

describe("client (organize missions by client/project) persistence", () => {
  it("round-trips client through create, get, list, and update", async () => {
    const create = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, client: "Acme s.r.o." });
    expect(create.status).toBe(201);

    const get = await request(app)
      .get(`/api/missions/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.client).toBe("Acme s.r.o.");

    const list = await request(app)
      .get("/api/missions")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    const listed = list.body.find((m: any) => m.id === create.body.id);
    expect(listed.client).toBe("Acme s.r.o.");

    const update = await request(app)
      .put(`/api/missions/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ client: "Different Client" });
    expect(update.status).toBe(200);

    const getAfterUpdate = await request(app)
      .get(`/api/missions/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(getAfterUpdate.body.client).toBe("Different Client");
  });

  it("defaults to null when client is omitted", async () => {
    const create = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody);
    expect(create.status).toBe(201);

    const get = await request(app)
      .get(`/api/missions/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.body.client).toBeNull();
  });

  it("rejects a non-string client with 400", async () => {
    const res = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, client: 12345 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("neplatný klient/zakázka");
  });
});

describe("POST /api/missions/segments", () => {
  it("rejects the request without a token with 401", async () => {
    const res = await request(app)
      .post("/api/missions/segments")
      .send(validBody);
    expect(res.status).toBe(401);
  });

  it("rejects a mission with fewer than 2 waypoints with 400", async () => {
    const res = await request(app)
      .post("/api/missions/segments")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, waypoints: [validBody.waypoints[0]] });
    expect(res.status).toBe(400);
  });

  it("splits a 2-waypoint mission into exactly one saved leg mission", async () => {
    const res = await request(app)
      .post("/api/missions/segments")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Test_mission-seg-1-of-1");

    const get = await request(app)
      .get(`/api/missions/${res.body[0].id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.waypoints).toHaveLength(2);
    expect(get.body.waypoints[0].index).toBe(0);
    expect(get.body.waypoints[1].index).toBe(1);
  });

  it("splits an N-waypoint mission into N-1 consecutive leg missions, each owned by the caller", async () => {
    const threeWaypointBody = {
      ...validBody,
      name: "Three WP mission",
      waypoints: [
        ...validBody.waypoints,
        { ...validBody.waypoints[1], index: 2, latitude: 41.27 },
      ],
    };
    const res = await request(app)
      .post("/api/missions/segments")
      .set("Authorization", `Bearer ${token}`)
      .send(threeWaypointBody);
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((m: { name: string }) => m.name)).toEqual([
      "Three_WP_mission-seg-1-of-2",
      "Three_WP_mission-seg-2-of-2",
    ]);

    for (const { id } of res.body) {
      const get = await request(app)
        .get(`/api/missions/${id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(get.status).toBe(200);
      expect(get.body.waypoints).toHaveLength(2);
    }
  });
});
