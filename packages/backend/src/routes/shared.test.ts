import express from "express";
import request from "supertest";
import { describe, it, expect, beforeAll } from "vitest";
import { initDb } from "../models/db.js";
import { authRoutes } from "./auth.js";
import { missionRoutes } from "./missions.js";
import { sharedRoutes } from "./shared.js";

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/missions", missionRoutes);
app.use("/api", sharedRoutes);

let token: string;

const validBody = {
  name: "Shared comments test mission",
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

async function createSharedMission(name = validBody.name) {
  const create = await request(app)
    .post("/api/missions")
    .set("Authorization", `Bearer ${token}`)
    .send({ ...validBody, name });
  const share = await request(app)
    .post(`/api/missions/${create.body.id}/share`)
    .set("Authorization", `Bearer ${token}`);
  return {
    missionId: create.body.id as string,
    shareToken: share.body.shareToken as string,
  };
}

beforeAll(async () => {
  initDb();
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email: "shared-comments@test.dev", password: "secret123" });
  token = res.body.token;
});

describe("GET /api/embed/:token", () => {
  it("returns minimal read-only mission data for a valid share token", async () => {
    const { shareToken } = await createSharedMission("Embed test mission");

    const res = await request(app).get(`/api/embed/${shareToken}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Embed test mission");
    expect(res.body.waypoints).toHaveLength(2);
    expect(res.body.config).toBeTruthy();
  });

  it("never includes the owner's email, mission id, or share token", async () => {
    const { shareToken } = await createSharedMission("Embed privacy mission");

    const res = await request(app).get(`/api/embed/${shareToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ownerEmail).toBeUndefined();
    expect(res.body.id).toBeUndefined();
    expect(res.body.shareToken).toBeUndefined();
  });

  it("returns 404 for an unknown token", async () => {
    const res = await request(app).get("/api/embed/does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("GET/POST /api/shared/:token/comments", () => {
  it("returns an empty list for a freshly shared mission", async () => {
    const { shareToken } = await createSharedMission("No comments yet");

    const res = await request(app).get(`/api/shared/${shareToken}/comments`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("posts a comment without requiring authentication and lists it back", async () => {
    const { shareToken } = await createSharedMission("Commentable mission");

    const post = await request(app)
      .post(`/api/shared/${shareToken}/comments`)
      .send({ authorName: "Jana Nováková", text: "Pěkná trasa!" });
    expect(post.status).toBe(201);
    expect(post.body.authorName).toBe("Jana Nováková");
    expect(post.body.text).toBe("Pěkná trasa!");
    expect(post.body.id).toBeTruthy();
    expect(post.body.createdAt).toBeTruthy();

    const list = await request(app).get(`/api/shared/${shareToken}/comments`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].authorName).toBe("Jana Nováková");
  });

  it("preserves comment order (oldest first)", async () => {
    const { shareToken } = await createSharedMission(
      "Ordered comments mission",
    );

    await request(app)
      .post(`/api/shared/${shareToken}/comments`)
      .send({ authorName: "První", text: "První komentář" });
    await request(app)
      .post(`/api/shared/${shareToken}/comments`)
      .send({ authorName: "Druhý", text: "Druhý komentář" });

    const list = await request(app).get(`/api/shared/${shareToken}/comments`);
    expect(list.body.map((c: any) => c.authorName)).toEqual(["První", "Druhý"]);
  });

  it("rejects a missing author name with 400", async () => {
    const { shareToken } = await createSharedMission("Validation mission A");

    const res = await request(app)
      .post(`/api/shared/${shareToken}/comments`)
      .send({ text: "Chybí jméno" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("neplatné jméno autora");
  });

  it("rejects an author name over the length cap with 400", async () => {
    const { shareToken } = await createSharedMission("Validation mission B");

    const res = await request(app)
      .post(`/api/shared/${shareToken}/comments`)
      .send({ authorName: "a".repeat(81), text: "Text komentáře" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("neplatné jméno autora");
  });

  it("rejects empty comment text with 400", async () => {
    const { shareToken } = await createSharedMission("Validation mission C");

    const res = await request(app)
      .post(`/api/shared/${shareToken}/comments`)
      .send({ authorName: "Petr", text: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("neplatný text komentáře");
  });

  it("rejects comment text over the 2000-character cap with 400", async () => {
    const { shareToken } = await createSharedMission("Validation mission D");

    const res = await request(app)
      .post(`/api/shared/${shareToken}/comments`)
      .send({ authorName: "Petr", text: "a".repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("neplatný text komentáře");
  });

  it("accepts comment text exactly at the 2000-character cap", async () => {
    const { shareToken } = await createSharedMission("Validation mission E");

    const res = await request(app)
      .post(`/api/shared/${shareToken}/comments`)
      .send({ authorName: "Petr", text: "a".repeat(2000) });
    expect(res.status).toBe(201);
  });

  it("returns 404 posting a comment to an unknown share token", async () => {
    const res = await request(app)
      .post("/api/shared/does-not-exist/comments")
      .send({ authorName: "Petr", text: "Text" });
    expect(res.status).toBe(404);
  });

  it("scopes comments to their own mission's share token", async () => {
    const missionA = await createSharedMission("Scoped comments A");
    const missionB = await createSharedMission("Scoped comments B");

    await request(app)
      .post(`/api/shared/${missionA.shareToken}/comments`)
      .send({ authorName: "A commenter", text: "Comment on A" });

    const listA = await request(app).get(
      `/api/shared/${missionA.shareToken}/comments`,
    );
    const listB = await request(app).get(
      `/api/shared/${missionB.shareToken}/comments`,
    );
    expect(listA.body).toHaveLength(1);
    expect(listB.body).toHaveLength(0);
  });

  it("returns 404 listing comments for an unknown share token", async () => {
    const res = await request(app).get("/api/shared/does-not-exist/comments");
    expect(res.status).toBe(404);
  });
});
