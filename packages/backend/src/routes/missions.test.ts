import express from "express";
import request from "supertest";
import { describe, it, expect, beforeAll } from "vitest";
import { initDb } from "../models/db.js";
import { authRoutes } from "./auth.js";
import { adminRoutes } from "./admin.js";
import { missionRoutes } from "./missions.js";

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/missions", missionRoutes);

let token: string;
let otherToken: string;

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
  // The first-ever registered account becomes the founder/admin; public
  // self-registration is closed after that (see auth.ts), so a second test
  // user must be created via the admin "create user" endpoint and then
  // logged in for its own token.
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email: "missions@test.dev", password: "secret123" });
  token = res.body.token;

  await request(app)
    .post("/api/admin/users")
    .set("Authorization", `Bearer ${token}`)
    .send({ email: "missions-other@test.dev", password: "secret123" });
  const otherLogin = await request(app)
    .post("/api/auth/login")
    .send({ email: "missions-other@test.dev", password: "secret123" });
  otherToken = otherLogin.body.token;
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

describe("folder organization + search filtering", () => {
  it("round-trips folder through create, get, list, and update", async () => {
    const create = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ...validBody,
        name: "Folder round-trip mission",
        folder: "2026 inspekce",
      });
    expect(create.status).toBe(201);

    const get = await request(app)
      .get(`/api/missions/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.body.folder).toBe("2026 inspekce");

    const update = await request(app)
      .put(`/api/missions/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ folder: "Jiná složka" });
    expect(update.status).toBe(200);

    const getAfterUpdate = await request(app)
      .get(`/api/missions/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(getAfterUpdate.body.folder).toBe("Jiná složka");
  });

  it("rejects a non-string folder with 400", async () => {
    const res = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, folder: 12345 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("neplatná složka");
  });

  it("filters the mission list by exact folder match via ?folder=", async () => {
    await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, name: "In folder A", folder: "Folder A" });
    await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, name: "In folder B", folder: "Folder B" });

    const res = await request(app)
      .get("/api/missions")
      .query({ folder: "Folder A" })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((m: any) => m.folder === "Folder A")).toBe(true);
  });

  it("filters the mission list by a case-sensitive name substring via ?search=", async () => {
    await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, name: "Unique_Searchable_Mission_Name" });

    const res = await request(app)
      .get("/api/missions")
      .query({ search: "Searchable_Mission" })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(
      res.body.some((m: any) => m.name === "Unique_Searchable_Mission_Name"),
    ).toBe(true);
    expect(
      res.body.every((m: any) => m.name.includes("Searchable_Mission")),
    ).toBe(true);
  });

  it("treats % and _ in the search term as literal characters, not LIKE wildcards", async () => {
    await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, name: "Percent%Mission" });
    await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, name: "PercentXMission" });

    const res = await request(app)
      .get("/api/missions")
      .query({ search: "Percent%Mission" })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const names = res.body.map((m: any) => m.name);
    expect(names).toContain("Percent%Mission");
    expect(names).not.toContain("PercentXMission");
  });

  it("only returns the authenticated user's own missions regardless of filters", async () => {
    const res = await request(app)
      .get("/api/missions")
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });
});

describe("POST /api/missions/:id/duplicate", () => {
  it("creates an independent copy with a fresh id and a (kopie) suffix", async () => {
    const create = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ...validBody,
        name: "Original mission",
        client: "Acme",
        folder: "Folder A",
      });
    expect(create.status).toBe(201);

    const dup = await request(app)
      .post(`/api/missions/${create.body.id}/duplicate`)
      .set("Authorization", `Bearer ${token}`);
    expect(dup.status).toBe(201);
    expect(dup.body.id).not.toBe(create.body.id);
    expect(dup.body.name).toBe("Original mission (kopie)");

    const get = await request(app)
      .get(`/api/missions/${dup.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.client).toBe("Acme");
    expect(get.body.folder).toBe("Folder A");
    expect(get.body.waypoints).toHaveLength(validBody.waypoints.length);
  });

  it("does not carry over the share token to the duplicate", async () => {
    const create = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, name: "Shared original" });
    await request(app)
      .post(`/api/missions/${create.body.id}/share`)
      .set("Authorization", `Bearer ${token}`);

    const dup = await request(app)
      .post(`/api/missions/${create.body.id}/duplicate`)
      .set("Authorization", `Bearer ${token}`);
    expect(dup.status).toBe(201);

    const list = await request(app)
      .get("/api/missions")
      .set("Authorization", `Bearer ${token}`);
    const duplicated = list.body.find((m: any) => m.id === dup.body.id);
    expect(duplicated.share_token).toBeNull();
  });

  it("rejects duplicating another user's mission with 403", async () => {
    const create = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, name: "Owner-only mission" });

    const res = await request(app)
      .post(`/api/missions/${create.body.id}/duplicate`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 404 for a non-existent mission id", async () => {
    const res = await request(app)
      .post("/api/missions/does-not-exist/duplicate")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("mission version history", () => {
  it("records a version on create and another on every update", async () => {
    const create = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, name: "Versioned mission" });
    expect(create.status).toBe(201);

    const versionsAfterCreate = await request(app)
      .get(`/api/missions/${create.body.id}/versions`)
      .set("Authorization", `Bearer ${token}`);
    expect(versionsAfterCreate.status).toBe(200);
    expect(versionsAfterCreate.body.length).toBe(1);

    await request(app)
      .put(`/api/missions/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Versioned mission (renamed)" });

    const versionsAfterUpdate = await request(app)
      .get(`/api/missions/${create.body.id}/versions`)
      .set("Authorization", `Bearer ${token}`);
    expect(versionsAfterUpdate.body.length).toBe(2);
  });

  it("caps retention at the 20 most recent versions per mission", async () => {
    const create = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, name: "Heavily edited mission" });
    expect(create.status).toBe(201);

    // 1 version from create + 25 updates = 26 total saves, capped at 20.
    for (let i = 0; i < 25; i++) {
      await request(app)
        .put(`/api/missions/${create.body.id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: `Heavily edited mission v${i}` });
    }

    const versions = await request(app)
      .get(`/api/missions/${create.body.id}/versions`)
      .set("Authorization", `Bearer ${token}`);
    expect(versions.status).toBe(200);
    expect(versions.body.length).toBe(20);
  });

  it("restores a mission's content from a previous version without destroying history", async () => {
    const create = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, name: "Restore target v1" });
    const versionsAfterCreate = await request(app)
      .get(`/api/missions/${create.body.id}/versions`)
      .set("Authorization", `Bearer ${token}`);
    const firstVersionId = versionsAfterCreate.body[0].id;

    await request(app)
      .put(`/api/missions/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Restore target v2" });

    const restore = await request(app)
      .post(
        `/api/missions/${create.body.id}/versions/${firstVersionId}/restore`,
      )
      .set("Authorization", `Bearer ${token}`);
    expect(restore.status).toBe(200);
    expect(restore.body.name).toBe("Restore target v1");

    const get = await request(app)
      .get(`/api/missions/${create.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.body.name).toBe("Restore target v1");

    // The restore itself is recorded as a new version — history isn't destroyed.
    const versionsAfterRestore = await request(app)
      .get(`/api/missions/${create.body.id}/versions`)
      .set("Authorization", `Bearer ${token}`);
    expect(versionsAfterRestore.body.length).toBe(3);
  });

  it("rejects listing versions for another user's mission with 403", async () => {
    const create = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, name: "Owner-only versions" });

    const res = await request(app)
      .get(`/api/missions/${create.body.id}/versions`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });

  it("rejects restoring another user's mission version with 403", async () => {
    const create = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, name: "Owner-only restore" });
    const versions = await request(app)
      .get(`/api/missions/${create.body.id}/versions`)
      .set("Authorization", `Bearer ${token}`);
    const versionId = versions.body[0].id;

    const res = await request(app)
      .post(`/api/missions/${create.body.id}/versions/${versionId}/restore`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 404 restoring a version id that does not belong to the mission", async () => {
    const missionA = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, name: "Mission A for cross-restore" });
    const missionB = await request(app)
      .post("/api/missions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, name: "Mission B for cross-restore" });

    const versionsB = await request(app)
      .get(`/api/missions/${missionB.body.id}/versions`)
      .set("Authorization", `Bearer ${token}`);
    const versionIdFromB = versionsB.body[0].id;

    const res = await request(app)
      .post(
        `/api/missions/${missionA.body.id}/versions/${versionIdFromB}/restore`,
      )
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
