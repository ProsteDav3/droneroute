import express from "express";
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { initDb, getDb } from "../models/db.js";
import { hashPassword } from "../services/authService.js";
import { authRoutes } from "./auth.js";

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);

describe("POST /api/auth/register — BOOTSTRAP_TOKEN gate", () => {
  beforeAll(() => {
    initDb();
    process.env.BOOTSTRAP_TOKEN = "let-me-in";
  });

  afterAll(() => {
    delete process.env.BOOTSTRAP_TOKEN;
  });

  it("reports requiresBootstrapToken: true while registration is open", async () => {
    const res = await request(app).get("/api/auth/status");
    expect(res.body.registrationOpen).toBe(true);
    expect(res.body.requiresBootstrapToken).toBe(true);
  });

  it("rejects registration with no token", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "founder@test.dev", password: "secret123" });
    expect(res.status).toBe(403);
  });

  it("rejects registration with the wrong token", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "founder@test.dev",
      password: "secret123",
      bootstrapToken: "wrong",
    });
    expect(res.status).toBe(403);
  });

  it("succeeds with the correct token and becomes admin", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "founder@test.dev",
      password: "secret123",
      bootstrapToken: "let-me-in",
    });
    expect(res.status).toBe(201);
    expect(res.body.isAdmin).toBe(true);
  });

  it("closes registration afterward regardless of token", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "second@test.dev",
      password: "secret123",
      bootstrapToken: "let-me-in",
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/auth/login — ADMIN_EMAIL recovery promotion", () => {
  // A fresh in-memory DB per test file, seeded directly (not through
  // /register) so registration being closed elsewhere doesn't interfere —
  // this represents a self-hosted install that already has real users but
  // no admin (e.g. upgraded from before is_admin existed).
  beforeAll(() => {
    initDb();
    const db = getDb();
    db.prepare(
      "INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, 1)",
    ).run(uuidv4(), "owner@test.dev", hashPassword("secret123"));
    db.prepare(
      "INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, 1)",
    ).run(uuidv4(), "other@test.dev", hashPassword("secret123"));
  });

  afterAll(() => {
    delete process.env.ADMIN_EMAIL;
  });

  it("promotes a matching ADMIN_EMAIL account to admin on login", async () => {
    process.env.ADMIN_EMAIL = "owner@test.dev";

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "owner@test.dev", password: "secret123" });

    expect(res.status).toBe(200);
    expect(res.body.isAdmin).toBe(true);
  });

  it("does not promote an account that doesn't match ADMIN_EMAIL", async () => {
    process.env.ADMIN_EMAIL = "someone-else@test.dev";

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "other@test.dev", password: "secret123" });

    expect(res.status).toBe(200);
    expect(res.body.isAdmin).toBe(false);
  });
});
