import express from "express";
import request from "supertest";
import { describe, it, expect, beforeAll } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { initDb, getDb } from "../models/db.js";
import { hashPassword } from "../services/authService.js";
import { authRoutes } from "./auth.js";

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);

beforeAll(() => {
  initDb();
});

describe("GET /api/auth/status — before bootstrap", () => {
  it("reports registrationOpen: true when no accounts exist yet", async () => {
    const res = await request(app).get("/api/auth/status");
    expect(res.status).toBe(200);
    expect(res.body.registrationOpen).toBe(true);
    expect(res.body.requiresBootstrapToken).toBe(false);
  });
});

describe("POST /api/auth/register — founder bootstrap and closing", () => {
  it("rejects missing email or password with 400", async () => {
    const res = await request(app).post("/api/auth/register").send({});
    expect(res.status).toBe(400);
  });

  it("rejects passwords shorter than 6 characters", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "short@test.dev", password: "abc" });
    expect(res.status).toBe(400);
  });

  it("registers the first account as the admin (bootstrap) and returns a token", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "founder@test.dev", password: "secret123" });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.isAdmin).toBe(true);
    expect(res.body).not.toHaveProperty("password_hash");
  });

  it("closes registration once an account already exists", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "second@test.dev", password: "secret123" });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/auth/status — after bootstrap", () => {
  it("reports registrationOpen: false once an account exists", async () => {
    const res = await request(app).get("/api/auth/status");
    expect(res.status).toBe(200);
    expect(res.body.registrationOpen).toBe(false);
  });
});

describe("POST /api/auth/login — failure paths", () => {
  beforeAll(() => {
    const db = getDb();
    db.prepare(
      "INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, 1)",
    ).run(uuidv4(), "login@test.dev", hashPassword("secret123"));
  });

  it("rejects missing credentials with 400", async () => {
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status).toBe(400);
  });

  it("returns 401 with a generic message for a wrong password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "login@test.dev", password: "wrongpass" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password");
  });

  it("does not leak account existence: nonexistent email matches wrong-password response", async () => {
    const wrongPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: "login@test.dev", password: "wrongpass" });
    const nonexistent = await request(app)
      .post("/api/auth/login")
      .send({ email: "ghost@test.dev", password: "whatever123" });
    expect(nonexistent.status).toBe(wrongPassword.status);
    expect(nonexistent.body.error).toBe(wrongPassword.body.error);
  });

  it("blocks a banned account with 403", async () => {
    const db = getDb();
    const id = uuidv4();
    db.prepare(
      "INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, 1)",
    ).run(id, "banned@test.dev", hashPassword("secret123"));
    db.prepare("UPDATE users SET is_banned = 1 WHERE id = ?").run(id);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "banned@test.dev", password: "secret123" });
    expect(res.status).toBe(403);
    expect(res.body.banned).toBe(true);
  });

  it("logs in successfully with correct credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "login@test.dev", password: "secret123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });
});
