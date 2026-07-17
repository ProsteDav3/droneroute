import express from "express";
import request from "supertest";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { authenticator } from "otplib";
import { initDb, getDb } from "../models/db.js";
import { hashPassword, hashResetToken } from "../services/authService.js";

const sendPasswordResetEmailMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../services/emailService.js", () => ({
  isEmailConfigured: () => true,
  sendPasswordResetEmail: (...args: unknown[]) =>
    sendPasswordResetEmailMock(...args),
}));

const { authRoutes } = await import("./auth.js");

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);

// Registration is a one-time bootstrap (see auth.bootstrap.test.ts) — every
// user this file needs beyond the first is seeded directly into the DB,
// exactly like auth.bootstrap.test.ts's "ADMIN_EMAIL recovery" suite does.
function seedUser(email: string, password: string): string {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    "INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, 1)",
  ).run(id, email, hashPassword(password));
  return id;
}

async function loginToken(email: string, password: string): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password });
  return res.body.token as string;
}

beforeAll(() => {
  initDb();
});

describe("POST /api/auth/forgot-password", () => {
  beforeAll(() => {
    seedUser("forgot@test.dev", "secret123");
  });

  it("returns the same generic message for an existing account", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "forgot@test.dev" });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Pokud tento e-mail existuje/);
  });

  it("returns the identical generic message for a nonexistent account (no enumeration)", async () => {
    const existing = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "forgot@test.dev" });
    const ghost = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "ghost-nonexistent@test.dev" });

    expect(ghost.status).toBe(existing.status);
    expect(ghost.body.message).toBe(existing.body.message);
  });

  it("rejects a missing email with 400", async () => {
    const res = await request(app).post("/api/auth/forgot-password").send({});
    expect(res.status).toBe(400);
  });

  it("issues a reset token that lands in password_reset_tokens", async () => {
    const db = getDb();
    const before = (
      db
        .prepare("SELECT COUNT(*) as count FROM password_reset_tokens")
        .get() as any
    ).count;

    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "forgot@test.dev" });

    const after = (
      db
        .prepare("SELECT COUNT(*) as count FROM password_reset_tokens")
        .get() as any
    ).count;
    expect(after).toBe(before + 1);
  });

  it("builds the reset link from APP_URL, never from a spoofed Host header", async () => {
    const originalAppUrl = process.env.APP_URL;
    process.env.APP_URL = "https://skyroute.skydata.cz";
    sendPasswordResetEmailMock.mockClear();

    try {
      await request(app)
        .post("/api/auth/forgot-password")
        .set("Host", "attacker.example")
        .send({ email: "forgot@test.dev" });

      // The reset email is sent fire-and-forget (not awaited by the
      // handler) — give the microtask queue a tick to run it.
      await new Promise((resolve) => setImmediate(resolve));

      expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(1);
      const [, resetUrl] = sendPasswordResetEmailMock.mock.calls[0];
      expect(resetUrl).toMatch(/^https:\/\/skyroute\.skydata\.cz\//);
      expect(resetUrl).not.toContain("attacker.example");
    } finally {
      process.env.APP_URL = originalAppUrl;
    }
  });

  it("does not attempt to send a reset email when APP_URL isn't configured", async () => {
    const originalAppUrl = process.env.APP_URL;
    delete process.env.APP_URL;
    sendPasswordResetEmailMock.mockClear();

    try {
      const res = await request(app)
        .post("/api/auth/forgot-password")
        .set("Host", "attacker.example")
        .send({ email: "forgot@test.dev" });

      await new Promise((resolve) => setImmediate(resolve));

      // Still returns the generic success response — no account enumeration
      // signal — it just silently skips the (unbuildable) email.
      expect(res.status).toBe(200);
      expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
    } finally {
      process.env.APP_URL = originalAppUrl;
    }
  });
});

describe("POST /api/auth/reset-password", () => {
  let userId: string;

  beforeAll(() => {
    userId = seedUser("reset@test.dev", "originalPass1");
  });

  it("rejects a malformed/unknown token with a generic error", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "not-a-real-token", newPassword: "newPassword1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/neplatný nebo již vypršel/i);
  });

  it("rejects a short new password with 400", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "whatever", newPassword: "abc" });
    expect(res.status).toBe(400);
  });

  it("rejects an expired token", async () => {
    const db = getDb();
    const rawToken = "expired-token-raw";
    db.prepare(
      "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
    ).run(
      uuidv4(),
      userId,
      hashResetToken(rawToken),
      new Date(Date.now() - 1000).toISOString(),
    );

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: rawToken, newPassword: "newPassword1" });
    expect(res.status).toBe(400);
  });

  it("resets the password with a valid token and rejects the token being reused", async () => {
    const db = getDb();
    const rawToken = "valid-token-raw";
    db.prepare(
      "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
    ).run(
      uuidv4(),
      userId,
      hashResetToken(rawToken),
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    );

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: rawToken, newPassword: "brandNewPass1" });
    expect(res.status).toBe(200);

    // The old password no longer works …
    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "reset@test.dev", password: "originalPass1" });
    expect(oldLogin.status).toBe(401);

    // … the new one does.
    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "reset@test.dev", password: "brandNewPass1" });
    expect(newLogin.status).toBe(200);

    // Reusing the same (now-used) token fails.
    const reuse = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: rawToken, newPassword: "anotherPass1" });
    expect(reuse.status).toBe(400);
  });
});

describe("POST /api/auth/forgot-password and /reset-password — rate limiting", () => {
  it("mounts both routes behind authLimiter, not just the route handler", () => {
    // authLimiter's actual throttling behavior is exercised end-to-end by
    // auth.test.ts's login suite, and is skipped entirely under
    // NODE_ENV=test (see middleware/rateLimit.ts) so the rest of this file
    // doesn't spuriously 429. Here we just confirm both new routes are
    // wired through the shared limiter middleware rather than bypassing
    // rate limiting altogether.
    const stack = (authRoutes as any).stack as any[];
    const forgotLayer = stack.find((l) => l.route?.path === "/forgot-password");
    const resetLayer = stack.find((l) => l.route?.path === "/reset-password");
    expect(forgotLayer?.route.stack.length).toBeGreaterThan(1);
    expect(resetLayer?.route.stack.length).toBeGreaterThan(1);
  });
});

describe("2FA (TOTP)", () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    userId = seedUser("twofa@test.dev", "secret123");
    token = await loginToken("twofa@test.dev", "secret123");
  });

  it("rejects 2fa/setup without auth", async () => {
    const res = await request(app).post("/api/auth/2fa/setup").send({});
    expect(res.status).toBe(401);
  });

  it("sets up a pending secret and returns an otpauth URL", async () => {
    const res = await request(app)
      .post("/api/auth/2fa/setup")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.secret).toBeTruthy();
    expect(res.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
  });

  it("rejects verify with a wrong code", async () => {
    const res = await request(app)
      .post("/api/auth/2fa/verify")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "000000" });
    expect(res.status).toBe(401);
  });

  it("confirms 2FA with the correct code", async () => {
    const db = getDb();
    const user = db
      .prepare("SELECT totp_secret FROM users WHERE id = ?")
      .get(userId) as any;
    const code = authenticator.generate(user.totp_secret);

    const res = await request(app)
      .post("/api/auth/2fa/verify")
      .set("Authorization", `Bearer ${token}`)
      .send({ code });
    expect(res.status).toBe(200);

    const updated = db
      .prepare("SELECT totp_enabled FROM users WHERE id = ?")
      .get(userId) as any;
    expect(updated.totp_enabled).toBe(1);
  });

  it("login now returns a challenge token instead of a real JWT", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "twofa@test.dev", password: "secret123" });
    expect(res.status).toBe(200);
    expect(res.body.requiresTwoFactor).toBe(true);
    expect(res.body.challengeToken).toBeTruthy();
    expect(res.body.token).toBeUndefined();
  });

  it("CRITICAL: a 2FA challenge token is rejected by a normal authenticated route, not just accepted-then-ignored", async () => {
    // Regression test for a real bypass: the challenge token has no
    // tokenVersion claim, and (before the audience-claim fix) authMiddleware
    // never checked what the token was *for* — only that it verified with
    // the shared secret. That let a correct email+password check alone
    // yield a fully authenticated Bearer token on any route, skipping TOTP
    // entirely. Proves the fix by hitting a real protected route (not
    // /2fa/login) with a challenge token and confirming it's rejected.
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "twofa@test.dev", password: "secret123" });
    expect(login.body.requiresTwoFactor).toBe(true);
    const challengeToken = login.body.challengeToken as string;
    expect(challengeToken).toBeTruthy();

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${challengeToken}`);
    expect(res.status).toBe(401);
  });

  it("rejects 2fa/login with a wrong code", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "twofa@test.dev", password: "secret123" });

    const res = await request(app)
      .post("/api/auth/2fa/login")
      .send({ challengeToken: login.body.challengeToken, code: "000000" });
    expect(res.status).toBe(401);
  });

  it("rejects 2fa/login given a normal session token instead of a challenge token", async () => {
    // Symmetric case to the CRITICAL test above: the two token kinds must
    // be rejected by *each other's* endpoint, not just accepted anywhere.
    const res = await request(app)
      .post("/api/auth/2fa/login")
      .send({ challengeToken: token, code: "000000" });
    expect(res.status).toBe(401);
  });

  it("issues a real JWT with the correct code", async () => {
    const db = getDb();
    const user = db
      .prepare("SELECT totp_secret FROM users WHERE id = ?")
      .get(userId) as any;

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "twofa@test.dev", password: "secret123" });

    const code = authenticator.generate(user.totp_secret);
    const res = await request(app)
      .post("/api/auth/2fa/login")
      .send({ challengeToken: login.body.challengeToken, code });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it("rejects disabling 2FA with the wrong password", async () => {
    const res = await request(app)
      .post("/api/auth/2fa/disable")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("disables 2FA with the correct password", async () => {
    const res = await request(app)
      .post("/api/auth/2fa/disable")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "secret123" });
    expect(res.status).toBe(200);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "twofa@test.dev", password: "secret123" });
    expect(login.status).toBe(200);
    expect(login.body.requiresTwoFactor).toBeUndefined();
    expect(login.body.token).toBeTruthy();
  });
});

describe("Session invalidation on password change", () => {
  it("invalidates a previously-issued token when the password is changed", async () => {
    seedUser("invalidate@test.dev", "oldPass123");
    const oldToken = await loginToken("invalidate@test.dev", "oldPass123");

    // The old token works before the change.
    const before = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${oldToken}`);
    expect(before.status).toBe(200);

    const changeRes = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${oldToken}`)
      .send({ currentPassword: "oldPass123", newPassword: "newPass456" });
    expect(changeRes.status).toBe(200);

    // The same (now stale) token is rejected afterward, even though it
    // hasn't expired on its own.
    const after = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${oldToken}`);
    expect(after.status).toBe(401);

    // Logging in again issues a fresh, working token.
    const relogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "invalidate@test.dev", password: "newPass456" });
    expect(relogin.status).toBe(200);

    const withNewToken = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${relogin.body.token}`);
    expect(withNewToken.status).toBe(200);
  });

  it("invalidates a previously-issued token when the password is reset", async () => {
    const userId = seedUser("invalidate-reset@test.dev", "oldPass123");
    const oldToken = await loginToken(
      "invalidate-reset@test.dev",
      "oldPass123",
    );

    const db = getDb();
    const rawToken = "reset-invalidate-raw";
    db.prepare(
      "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
    ).run(
      uuidv4(),
      userId,
      hashResetToken(rawToken),
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    );

    const resetRes = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: rawToken, newPassword: "resetPass789" });
    expect(resetRes.status).toBe(200);

    const after = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${oldToken}`);
    expect(after.status).toBe(401);
  });
});

describe("GET /api/auth/me", () => {
  it("returns 401 with no token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns the current user's profile including 2FA state", async () => {
    seedUser("me@test.dev", "secret123");
    const token = await loginToken("me@test.dev", "secret123");

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("me@test.dev");
    expect(res.body.totpEnabled).toBe(false);
  });
});
