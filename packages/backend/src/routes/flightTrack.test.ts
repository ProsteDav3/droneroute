import express from "express";
import request from "supertest";
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { initDb } from "../models/db.js";
import { authRoutes } from "./auth.js";
import { adminRoutes } from "./admin.js";
import { missionRoutes } from "./missions.js";
import { djiCloudRoutes } from "./djiCloud.js";
import { handleMessage } from "../services/mqttTelemetry.js";
import { resetFlightTrackState } from "../services/flightTrack.js";

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/missions", missionRoutes);
app.use("/api/dji-cloud", djiCloudRoutes);

let ownerToken: string;
let otherToken: string;
let missionId: string;

const validMission = {
  name: "Track test mission",
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
      actions: [],
    },
    {
      index: 1,
      name: "WP2",
      latitude: 41.26,
      longitude: 0.94,
      height: 30,
      speed: 5,
      gimbalPitchAngle: 0,
      actions: [],
    },
  ],
  pois: [],
};

beforeAll(async () => {
  initDb();
  const owner = await request(app)
    .post("/api/auth/register")
    .send({ email: "flighttrack-owner@test.dev", password: "secret123" });
  ownerToken = owner.body.token;

  // The first-ever registered account becomes the founder/admin; public
  // self-registration is closed after that (see auth.ts), so a second test
  // user must be created via the admin "create user" endpoint and then
  // logged in for its own token.
  await request(app)
    .post("/api/admin/users")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ email: "flighttrack-other@test.dev", password: "secret123" });
  const otherLogin = await request(app)
    .post("/api/auth/login")
    .send({ email: "flighttrack-other@test.dev", password: "secret123" });
  otherToken = otherLogin.body.token;

  const missionRes = await request(app)
    .post("/api/missions")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send(validMission);
  missionId = missionRes.body.id;
});

beforeEach(() => {
  process.env.DJI_CLOUD_URL = "https://dji-cloud.test.example";
  process.env.DJI_CLOUD_USERNAME = "service";
  process.env.DJI_CLOUD_PASSWORD = "service-pw";
  resetFlightTrackState();
});

afterEach(() => {
  delete process.env.DJI_CLOUD_URL;
  delete process.env.DJI_CLOUD_USERNAME;
  delete process.env.DJI_CLOUD_PASSWORD;
  vi.unstubAllGlobals();
  resetFlightTrackState();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const loginOk = () =>
  jsonResponse({
    code: 0,
    message: "success",
    data: { access_token: "dji-token", workspace_id: "ws-1" },
  });

describe("POST /api/dji-cloud/flight-track/start", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/dji-cloud/flight-track/start")
      .send({ deviceSn: "SN1" });
    expect(res.status).toBe(401);
  });

  it("returns 503 when the bridge isn't configured", async () => {
    delete process.env.DJI_CLOUD_URL;
    const res = await request(app)
      .post("/api/dji-cloud/flight-track/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ deviceSn: "SN1" });
    expect(res.status).toBe(503);
  });

  it("rejects a missing deviceSn", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(loginOk()));
    const res = await request(app)
      .post("/api/dji-cloud/flight-track/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects a missionId owned by another user", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(loginOk()));
    const res = await request(app)
      .post("/api/dji-cloud/flight-track/start")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ deviceSn: "SN1", missionId });
    expect(res.status).toBe(403);
  });

  it("starts a session without a missionId", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(loginOk()));
    const res = await request(app)
      .post("/api/dji-cloud/flight-track/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ deviceSn: "SN1" });
    expect(res.status).toBe(200);
    expect(res.body.session.deviceSn).toBe("SN1");
    expect(res.body.session.missionId).toBeNull();
    expect(res.body.session.endedAt).toBeNull();
  });

  it("returns the same session when called twice for the same device", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(loginOk()).mockResolvedValueOnce(loginOk()),
    );
    const first = await request(app)
      .post("/api/dji-cloud/flight-track/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ deviceSn: "SN-dup", missionId });
    const second = await request(app)
      .post("/api/dji-cloud/flight-track/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ deviceSn: "SN-dup", missionId });
    expect(first.body.session.id).toBe(second.body.session.id);
  });

  it("records telemetry points that arrive while the session is active", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(loginOk()));
    const startRes = await request(app)
      .post("/api/dji-cloud/flight-track/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ deviceSn: "SN-live", missionId });
    const sessionId = startRes.body.session.id;

    handleMessage(
      "thing/product/SN-live/osd",
      Buffer.from(
        JSON.stringify({
          data: {
            latitude: 41.3,
            longitude: 0.95,
            height: 42,
            horizontal_speed: 6.5,
            battery: { capacity_percent: 80 },
          },
        }),
      ),
    );

    const pointsRes = await request(app)
      .get(`/api/dji-cloud/flight-track/sessions/${sessionId}/points`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(pointsRes.status).toBe(200);
    expect(pointsRes.body.points).toHaveLength(1);
    expect(pointsRes.body.points[0].latitude).toBe(41.3);
    expect(pointsRes.body.points[0].longitude).toBe(0.95);
    expect(pointsRes.body.points[0].batteryPercent).toBe(80);
  });

  it("ignores telemetry for a device with no active session", async () => {
    handleMessage(
      "thing/product/SN-idle/osd",
      Buffer.from(
        JSON.stringify({ data: { latitude: 1, longitude: 1, height: 1 } }),
      ),
    );
    // No session exists for SN-idle, so there is nothing to assert against
    // an endpoint — this just confirms handleMessage doesn't throw when no
    // session is recording.
  });
});

describe("POST /api/dji-cloud/flight-track/stop", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/dji-cloud/flight-track/stop")
      .send({ deviceSn: "SN1" });
    expect(res.status).toBe(401);
  });

  it("ends the session so its points endpoint still works but recording stops", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(loginOk()));
    const startRes = await request(app)
      .post("/api/dji-cloud/flight-track/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ deviceSn: "SN-stop", missionId });
    const sessionId = startRes.body.session.id;

    const stopRes = await request(app)
      .post("/api/dji-cloud/flight-track/stop")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ deviceSn: "SN-stop" });
    expect(stopRes.status).toBe(200);

    handleMessage(
      "thing/product/SN-stop/osd",
      Buffer.from(
        JSON.stringify({ data: { latitude: 1, longitude: 1, height: 1 } }),
      ),
    );

    const pointsRes = await request(app)
      .get(`/api/dji-cloud/flight-track/sessions/${sessionId}/points`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(pointsRes.body.points).toHaveLength(0);
  });

  it("rejects stopping a recording started by another user (IDOR guard)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(loginOk()));
    await request(app)
      .post("/api/dji-cloud/flight-track/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ deviceSn: "SN-idor", missionId });

    const stopRes = await request(app)
      .post("/api/dji-cloud/flight-track/stop")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ deviceSn: "SN-idor" });
    expect(stopRes.status).toBe(403);

    // Still recording — the other user's stop attempt must not have gone
    // through despite the 403.
    handleMessage(
      "thing/product/SN-idor/osd",
      Buffer.from(
        JSON.stringify({ data: { latitude: 2, longitude: 2, height: 2 } }),
      ),
    );
    const sessions = await request(app)
      .get(`/api/dji-cloud/flight-track/sessions?missionId=${missionId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const session = sessions.body.sessions.find(
      (s: { deviceSn: string }) => s.deviceSn === "SN-idor",
    );
    expect(session.endedAt).toBeNull();
    const pointsRes = await request(app)
      .get(`/api/dji-cloud/flight-track/sessions/${session.id}/points`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(pointsRes.body.points.length).toBeGreaterThan(0);
  });

  it("no-ops with success when nothing is recording for the device", async () => {
    const res = await request(app)
      .post("/api/dji-cloud/flight-track/stop")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ deviceSn: "SN-never-started" });
    expect(res.status).toBe(200);
  });
});

describe("GET /api/dji-cloud/flight-track/sessions", () => {
  it("requires a missionId query param", async () => {
    const res = await request(app)
      .get("/api/dji-cloud/flight-track/sessions")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });

  it("rejects a mission owned by another user", async () => {
    const res = await request(app)
      .get(`/api/dji-cloud/flight-track/sessions?missionId=${missionId}`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });

  it("lists sessions for the owner's mission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(loginOk()));
    await request(app)
      .post("/api/dji-cloud/flight-track/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ deviceSn: "SN-list", missionId });

    const res = await request(app)
      .get(`/api/dji-cloud/flight-track/sessions?missionId=${missionId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(
      res.body.sessions.some(
        (s: { deviceSn: string }) => s.deviceSn === "SN-list",
      ),
    ).toBe(true);
  });
});

describe("GET /api/dji-cloud/flight-track/sessions/:id/points", () => {
  it("returns 404 for an unknown session", async () => {
    const res = await request(app)
      .get("/api/dji-cloud/flight-track/sessions/does-not-exist/points")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(404);
  });

  it("rejects a session belonging to another user's mission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(loginOk()));
    const startRes = await request(app)
      .post("/api/dji-cloud/flight-track/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ deviceSn: "SN-guard", missionId });
    const sessionId = startRes.body.session.id;

    const res = await request(app)
      .get(`/api/dji-cloud/flight-track/sessions/${sessionId}/points`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/dji-cloud/flight-track/sessions/:id", () => {
  it("returns 404 for an unknown session", async () => {
    const res = await request(app)
      .delete("/api/dji-cloud/flight-track/sessions/does-not-exist")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(404);
  });

  it("deletes an owned session and its points", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(loginOk()));
    const startRes = await request(app)
      .post("/api/dji-cloud/flight-track/start")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ deviceSn: "SN-del", missionId });
    const sessionId = startRes.body.session.id;

    const delRes = await request(app)
      .delete(`/api/dji-cloud/flight-track/sessions/${sessionId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(delRes.status).toBe(200);

    const pointsRes = await request(app)
      .get(`/api/dji-cloud/flight-track/sessions/${sessionId}/points`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(pointsRes.status).toBe(404);
  });
});
