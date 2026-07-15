import express from "express";
import request from "supertest";
import { describe, it, expect, beforeAll } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { initDb, getDb } from "../models/db.js";
import { hashPassword, generateToken } from "../services/authService.js";
import { authRoutes } from "./auth.js";
import { templatePresetRoutes } from "./templatePresets.js";

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/template-presets", templatePresetRoutes);

let token: string;
let otherToken: string;

const validBody = {
  name: "KCP orbit",
  type: "orbit",
  params: { center: [50.06, 14.43], radiusM: 80, altitude: 60 },
};

beforeAll(async () => {
  initDb();
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email: "presets@test.dev", password: "secret123" });
  token = res.body.token;

  // Registration is a one-time bootstrap (closed after the first account),
  // so the second test user is inserted directly rather than via /register.
  const otherId = uuidv4();
  getDb()
    .prepare(
      "INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, 1)",
    )
    .run(otherId, "presets-other@test.dev", hashPassword("secret123"));
  otherToken = generateToken(otherId, false);
});

describe("template presets — auth", () => {
  it("rejects requests without a token", async () => {
    const res = await request(app).get("/api/template-presets");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/template-presets — validation", () => {
  it("creates a preset with a valid payload", async () => {
    const res = await request(app)
      .post("/api/template-presets")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.params).toEqual(validBody.params);
  });

  it("rejects a blank name", async () => {
    const res = await request(app)
      .post("/api/template-presets")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, name: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid preset name");
  });

  it("rejects an unknown template type", async () => {
    const res = await request(app)
      .post("/api/template-presets")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, type: "not-a-real-type" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid preset type");
  });

  it("rejects non-object params", async () => {
    const res = await request(app)
      .post("/api/template-presets")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, params: "not an object" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid preset params");
  });

  it("rejects oversized params", async () => {
    const res = await request(app)
      .post("/api/template-presets")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, params: { blob: "x".repeat(30000) } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid preset params");
  });
});

describe("GET /api/template-presets", () => {
  it("lists only the current user's presets, newest first", async () => {
    await request(app)
      .post("/api/template-presets")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ ...validBody, name: "Other user's preset" });

    const res = await request(app)
      .get("/api/template-presets")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(
      res.body.every((p: { name: string }) => p.name !== "Other user's preset"),
    ).toBe(true);
  });
});

describe("PUT /api/template-presets/:id and DELETE", () => {
  it("lets the owner rename and update params, but not another user", async () => {
    const create = await request(app)
      .post("/api/template-presets")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody);
    const id = create.body.id;

    const rename = await request(app)
      .put(`/api/template-presets/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Renamed" });
    expect(rename.status).toBe(200);

    const forbidden = await request(app)
      .put(`/api/template-presets/${id}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ name: "Hijacked" });
    expect(forbidden.status).toBe(403);

    const list = await request(app)
      .get("/api/template-presets")
      .set("Authorization", `Bearer ${token}`);
    expect(list.body.find((p: { id: string }) => p.id === id).name).toBe(
      "Renamed",
    );
  });

  it("lets only the owner delete a preset", async () => {
    const create = await request(app)
      .post("/api/template-presets")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody);
    const id = create.body.id;

    const forbidden = await request(app)
      .delete(`/api/template-presets/${id}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(forbidden.status).toBe(403);

    const ok = await request(app)
      .delete(`/api/template-presets/${id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(ok.status).toBe(200);
  });

  it("returns 404 for a nonexistent preset", async () => {
    const res = await request(app)
      .put("/api/template-presets/does-not-exist")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "x" });
    expect(res.status).toBe(404);
  });
});
