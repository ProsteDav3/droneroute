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
import { djiCloudRoutes } from "./djiCloud.js";

const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/dji-cloud", djiCloudRoutes);

let token: string;

const validBody = {
  name: "Cloud test",
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Factory, not a shared instance — a Response body can only be read once.
const loginOk = () =>
  jsonResponse({
    code: 0,
    message: "success",
    data: { access_token: "dji-token", workspace_id: "ws-1" },
  });

beforeAll(async () => {
  initDb();
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email: "djicloud@test.dev", password: "secret123" });
  token = res.body.token;
});

beforeEach(() => {
  process.env.DJI_CLOUD_URL = "https://dji-cloud.test.example";
  process.env.DJI_CLOUD_USERNAME = "service";
  process.env.DJI_CLOUD_PASSWORD = "service-pw";
});

afterEach(() => {
  delete process.env.DJI_CLOUD_URL;
  delete process.env.DJI_CLOUD_USERNAME;
  delete process.env.DJI_CLOUD_PASSWORD;
  vi.unstubAllGlobals();
});

describe("POST /api/dji-cloud/upload", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/dji-cloud/upload")
      .send(validBody);
    expect(res.status).toBe(401);
  });

  it("returns 503 when the bridge isn't configured", async () => {
    delete process.env.DJI_CLOUD_URL;
    const res = await request(app)
      .post("/api/dji-cloud/upload")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody);
    expect(res.status).toBe(503);
  });

  it("rejects fewer than 2 waypoints", async () => {
    const res = await request(app)
      .post("/api/dji-cloud/upload")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validBody, waypoints: [validBody.waypoints[0]] });
    expect(res.status).toBe(400);
  });

  it("logs in, uploads the generated KMZ, and returns the wayline name", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, message: "success", data: "" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/dji-cloud/upload")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.waylineName).toBe("Cloud_test");

    // Login call shape
    const [loginUrl, loginInit] = fetchMock.mock.calls[0];
    expect(loginUrl).toBe("https://dji-cloud.test.example/manage/api/v1/login");
    expect(JSON.parse(loginInit.body).flag).toBe(1);

    // Upload call shape: workspace from the login response, token header,
    // multipart body carrying the sanitized .kmz filename.
    const [uploadUrl, uploadInit] = fetchMock.mock.calls[1];
    expect(uploadUrl).toBe(
      "https://dji-cloud.test.example/wayline/api/v1/workspaces/ws-1/waylines/file/upload",
    );
    expect(uploadInit.headers["x-auth-token"]).toBe("dji-token");
    const file = uploadInit.body.get("file");
    expect(file.name).toBe("Cloud_test.kmz");
    expect(file.size).toBeGreaterThan(0);
  });

  it("retries under a timestamped name when the platform rejects a duplicate", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        jsonResponse({
          code: -1,
          message: "The filename already exists.",
          data: "",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, message: "success", data: "" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/dji-cloud/upload")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.waylineName).toMatch(/^Cloud_test-\d{8}-\d{6}$/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns 502 with a generic message (upstream detail stays server-side) when both attempts fail", async () => {
    const rejected = () =>
      jsonResponse({ code: -1, message: "Storage unavailable.", data: "" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(rejected())
      .mockResolvedValueOnce(rejected());
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/dji-cloud/upload")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Nahrání do DJI Cloud selhalo");
    // The upstream platform's raw message must not leak to the client.
    expect(JSON.stringify(res.body)).not.toContain("Storage unavailable.");
  });
});

describe("POST /api/dji-cloud/upload-segments", () => {
  // A 3-waypoint route splits into 2 consecutive one-leg segments.
  const threeWpBody = {
    ...validBody,
    waypoints: [
      validBody.waypoints[0],
      validBody.waypoints[1],
      {
        index: 2,
        name: "WP3",
        latitude: 41.27,
        longitude: 0.95,
        height: 30,
        speed: 5,
        gimbalPitchAngle: 0,
        actions: [],
      },
    ],
  };

  const uploadOk = () =>
    jsonResponse({ code: 0, message: "success", data: "" });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/dji-cloud/upload-segments")
      .send(threeWpBody);
    expect(res.status).toBe(401);
  });

  it("returns 503 when the bridge isn't configured", async () => {
    delete process.env.DJI_CLOUD_URL;
    const res = await request(app)
      .post("/api/dji-cloud/upload-segments")
      .set("Authorization", `Bearer ${token}`)
      .send(threeWpBody);
    expect(res.status).toBe(503);
  });

  it("rejects fewer than 2 waypoints", async () => {
    const res = await request(app)
      .post("/api/dji-cloud/upload-segments")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...threeWpBody, waypoints: [threeWpBody.waypoints[0]] });
    expect(res.status).toBe(400);
  });

  it("logs in once and uploads every segment, returning the count", async () => {
    // 1 login + 2 segment uploads (N-1 for a 3-waypoint route).
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(uploadOk())
      .mockResolvedValueOnce(uploadOk());
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/dji-cloud/upload-segments")
      .set("Authorization", `Bearer ${token}`)
      .send(threeWpBody);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Only one login (call 0); the two uploads reuse the same token.
    expect(fetchMock.mock.calls[0][0]).toContain("/manage/api/v1/login");
    const seg1 = fetchMock.mock.calls[1][1].body.get("file");
    const seg2 = fetchMock.mock.calls[2][1].body.get("file");
    expect(seg1.name).toContain("seg-1-of-2");
    expect(seg2.name).toContain("seg-2-of-2");
  });

  it("returns 502 with no partial count when the very first segment fails (nothing uploaded)", async () => {
    const rejected = () =>
      jsonResponse({ code: -1, message: "Storage unavailable.", data: "" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(rejected())
      .mockResolvedValueOnce(rejected());
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/dji-cloud/upload-segments")
      .set("Authorization", `Bearer ${token}`)
      .send(threeWpBody);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Nahrání segmentů do DJI Cloud selhalo");
    expect(res.body.uploaded).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("Storage unavailable.");
  });

  it("reports the partial count when a later segment fails after earlier ones uploaded", async () => {
    const rejected = () =>
      jsonResponse({ code: -1, message: "Storage unavailable.", data: "" });
    // login, seg1 OK, then seg2 fails on both its attempt + duplicate retry.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(uploadOk())
      .mockResolvedValueOnce(rejected())
      .mockResolvedValueOnce(rejected());
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/dji-cloud/upload-segments")
      .set("Authorization", `Bearer ${token}`)
      .send(threeWpBody);

    expect(res.status).toBe(502);
    expect(res.body.uploaded).toBe(1);
    expect(res.body.total).toBe(2);
    // Still no upstream detail leaked.
    expect(JSON.stringify(res.body)).not.toContain("Storage unavailable.");
  });
});
