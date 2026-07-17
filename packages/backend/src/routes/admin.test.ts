import express from "express";
import request from "supertest";
import { describe, it, expect, beforeAll } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { initDb, getDb } from "../models/db.js";
import { hashPassword, generateToken } from "../services/authService.js";
import { adminRoutes } from "./admin.js";

const app = express();
app.use(express.json());
app.use("/api/admin", adminRoutes);

let adminId: string;
let adminToken: string;
let regularId: string;
let regularToken: string;

beforeAll(() => {
  initDb();
  const db = getDb();

  adminId = uuidv4();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, email_verified, is_admin) VALUES (?, ?, ?, 1, 1)",
  ).run(adminId, "admin@test.dev", hashPassword("secret123"));
  adminToken = generateToken(adminId, true, 0);

  regularId = uuidv4();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, 1)",
  ).run(regularId, "regular@test.dev", hashPassword("secret123"));
  regularToken = generateToken(regularId, false, 0);
});

describe("admin guard — reachable in self-hosted mode", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin user with 403", async () => {
    const res = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${regularToken}`);
    expect(res.status).toBe(403);
  });

  it("allows an admin user through", async () => {
    const res = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/admin/users", () => {
  it("rejects missing email or password with 400", async () => {
    const res = await request(app)
      .post("/api/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects passwords shorter than 6 characters", async () => {
    const res = await request(app)
      .post("/api/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "short@test.dev", password: "abc" });
    expect(res.status).toBe(400);
  });

  it("creates a new account", async () => {
    const res = await request(app)
      .post("/api/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "invited@test.dev", password: "secret123" });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe("invited@test.dev");
    expect(res.body).not.toHaveProperty("password_hash");
  });

  it("rejects an already-registered email with 409", async () => {
    const res = await request(app)
      .post("/api/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "invited@test.dev", password: "secret123" });
    expect(res.status).toBe(409);
  });

  it("rejects a non-admin caller with 403", async () => {
    const res = await request(app)
      .post("/api/admin/users")
      .set("Authorization", `Bearer ${regularToken}`)
      .send({ email: "another@test.dev", password: "secret123" });
    expect(res.status).toBe(403);
  });
});

describe("user moderation actions", () => {
  it("cannot ban yourself", async () => {
    const res = await request(app)
      .post(`/api/admin/users/${adminId}/ban`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it("bans and unbans another user", async () => {
    const ban = await request(app)
      .post(`/api/admin/users/${regularId}/ban`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(ban.status).toBe(200);

    const unban = await request(app)
      .post(`/api/admin/users/${regularId}/unban`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(unban.status).toBe(200);
  });

  it("promotes and demotes another user", async () => {
    const promote = await request(app)
      .post(`/api/admin/users/${regularId}/promote`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(promote.status).toBe(200);

    const demote = await request(app)
      .post(`/api/admin/users/${regularId}/demote`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(demote.status).toBe(200);
  });
});

describe("GET /api/admin/audit-log", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).get("/api/admin/audit-log");
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin caller with 403", async () => {
    const res = await request(app)
      .get("/api/admin/audit-log")
      .set("Authorization", `Bearer ${regularToken}`);
    expect(res.status).toBe(403);
  });

  it("records an entry for every mutating admin action, newest first", async () => {
    // By this point in the suite, the "user moderation actions" block above
    // has already performed: ban, unban, promote, demote on regularId — plus
    // the earlier create_user action. Trigger one more (ban) so we can assert
    // ordering against a known-latest entry.
    const ban = await request(app)
      .post(`/api/admin/users/${regularId}/ban`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(ban.status).toBe(200);

    const res = await request(app)
      .get("/api/admin/audit-log")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);

    const latest = res.body.data[0];
    expect(latest.action).toBe("ban_user");
    expect(latest.adminEmail).toBe("admin@test.dev");
    expect(latest.targetEmail).toBe("regular@test.dev");

    // Clean up the ban so it doesn't leak into other describe blocks that
    // run after this one in the same file.
    await request(app)
      .post(`/api/admin/users/${regularId}/unban`)
      .set("Authorization", `Bearer ${adminToken}`);
  });

  it("paginates results", async () => {
    const res = await request(app)
      .get("/api/admin/audit-log?page=1&perPage=1")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.perPage).toBe(1);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it("does not write an audit log entry for a failed (self-ban) action", async () => {
    const before = await request(app)
      .get("/api/admin/audit-log?perPage=100")
      .set("Authorization", `Bearer ${adminToken}`);
    const countBefore = before.body.total;

    const selfBan = await request(app)
      .post(`/api/admin/users/${adminId}/ban`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(selfBan.status).toBe(400);

    const after = await request(app)
      .get("/api/admin/audit-log?perPage=100")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(after.body.total).toBe(countBefore);
  });
});
