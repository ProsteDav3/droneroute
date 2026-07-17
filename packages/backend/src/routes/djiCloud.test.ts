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

const waylinesListEmpty = () =>
  jsonResponse({ code: 0, message: "success", data: { list: [] } });

const waylinesListWith = (id: string, name: string) =>
  jsonResponse({
    code: 0,
    message: "success",
    data: { list: [{ id, name: `${name}.kmz` }] },
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
    expect(res.body.waylineName).toBe("Cloud test");

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
    expect(file.name).toBe("Cloud test.kmz");
    expect(file.size).toBeGreaterThan(0);
  });

  it("strips characters DJI Cloud rejects in a wayline name (underscore, dot, etc.)", async () => {
    // DJI Cloud's own validation regex is `^[^<>:"/|?*._\\]+$` — a name
    // that slips past our sanitizer with one of these characters uploads
    // "successfully" but then breaks Pilot 2's own library listing for the
    // whole workspace (error 210002) the next time anything reads it back.
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
      .send({ ...validBody, name: "Test_new.v2" });

    expect(res.status).toBe(200);
    expect(res.body.waylineName).not.toMatch(/[<>:"/|?*._\\]/);

    const [, uploadInit] = fetchMock.mock.calls[1];
    const file = uploadInit.body.get("file");
    expect(file.name).toBe("Test-new-v2.kmz");
  });

  it("overwrites in place (same name) when a duplicate is found in the library", async () => {
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
      .mockResolvedValueOnce(waylinesListWith("old-wayline-1", "Cloud test"))
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, message: "success", data: "" }),
      ) // delete
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, message: "success", data: "" }),
      ); // re-upload under the same name
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/dji-cloud/upload")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.waylineName).toBe("Cloud test");
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[3];
    expect(deleteUrl).toContain("/waylines/old-wayline-1");
    expect(deleteInit.method).toBe("DELETE");
  });

  it("falls back to a timestamped name when no matching wayline is found in the library", async () => {
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
      .mockResolvedValueOnce(waylinesListEmpty())
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, message: "success", data: "" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/dji-cloud/upload")
      .set("Authorization", `Bearer ${token}`)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.waylineName).toMatch(/^Cloud test-\d{8}-\d{6}$/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("returns 502 with a generic message (upstream detail stays server-side) when every attempt fails", async () => {
    const rejected = () =>
      jsonResponse({ code: -1, message: "Storage unavailable.", data: "" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(rejected())
      .mockResolvedValueOnce(waylinesListEmpty())
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
      .mockResolvedValueOnce(waylinesListEmpty())
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
    // login, seg1 OK, then seg2 fails on its attempt, the library lookup
    // finds nothing to overwrite, and its timestamped fallback also fails.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(uploadOk())
      .mockResolvedValueOnce(rejected())
      .mockResolvedValueOnce(waylinesListEmpty())
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

describe("GET /api/dji-cloud/devices", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/dji-cloud/devices");
    expect(res.status).toBe(401);
  });

  it("returns 503 when the bridge isn't configured", async () => {
    delete process.env.DJI_CLOUD_URL;
    const res = await request(app)
      .get("/api/dji-cloud/devices")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(503);
  });

  it("logs in and returns the bound device list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          message: "success",
          data: {
            list: [{ device_sn: "SN1", nickname: "M4T", bound_status: true }],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .get("/api/dji-cloud/devices")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.devices).toHaveLength(1);
    expect(res.body.devices[0].device_sn).toBe("SN1");
  });

  it("returns a generic 502 without leaking the upstream message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        jsonResponse({
          code: -1,
          message: "Internal DB error XYZ",
          data: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .get("/api/dji-cloud/devices")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("Internal DB error XYZ");
  });
});

describe("GET /api/dji-cloud/hms", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/dji-cloud/hms");
    expect(res.status).toBe(401);
  });

  it("returns HMS messages with human-readable text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          message: "success",
          data: {
            list: [
              {
                sn: "SN1",
                key: "fpv_tip_0x1610000F",
                level: 2,
                module: 3,
                create_time: "2026-07-16 16:46:24",
                message_zh: "无法起飞",
                message_en: "Critical low battery voltage. Unable to take off.",
              },
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .get("/api/dji-cloud/hms")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].message_en).toBe(
      "Critical low battery voltage. Unable to take off.",
    );
    expect(res.body.messages[0].sn).toBe("SN1");
  });
});

describe("GET /api/dji-cloud/jobs", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/dji-cloud/jobs");
    expect(res.status).toBe(401);
  });

  it("returns wayline job history", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          message: "success",
          data: { list: [{ job_id: "job-1", status: "success" }] },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .get("/api/dji-cloud/jobs")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
  });
});

describe("GET /api/dji-cloud/waylines", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/dji-cloud/waylines");
    expect(res.status).toBe(401);
  });

  it("returns the wayline library listing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(waylinesListWith("wl-1", "Cloud_test"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .get("/api/dji-cloud/waylines")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.waylines).toEqual([{ id: "wl-1", name: "Cloud_test.kmz" }]);
  });
});

describe("DELETE /api/dji-cloud/waylines/:id", () => {
  it("requires authentication", async () => {
    const res = await request(app).delete("/api/dji-cloud/waylines/abc");
    expect(res.status).toBe(401);
  });

  it("deletes the wayline and returns success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, message: "success", data: null }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .delete("/api/dji-cloud/waylines/wayline-123")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Confirm the DELETE hit the right URL with the right id.
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1];
    expect(deleteUrl).toContain("/waylines/wayline-123");
    expect(deleteInit.method).toBe("DELETE");
  });

  it("returns a generic 502 on upstream failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        jsonResponse({ code: -1, message: "not found internally", data: null }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .delete("/api/dji-cloud/waylines/wayline-123")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("not found internally");
  });
});

describe("GET /api/dji-cloud/telemetry", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/dji-cloud/telemetry");
    expect(res.status).toBe(401);
  });

  it("returns 503 when the bridge isn't configured", async () => {
    delete process.env.DJI_CLOUD_URL;
    const res = await request(app)
      .get("/api/dji-cloud/telemetry")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(503);
  });

  it("returns an empty device list when nothing has reported in yet", async () => {
    // No mqtt broker reachable in tests; ensureTelemetryBridgeConnected's
    // login attempt will fail and the bridge stays idle -- the route must
    // still respond with a well-formed (empty) snapshot, not error out.
    const fetchMock = vi.fn().mockRejectedValue(new Error("no network"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .get("/api/dji-cloud/telemetry")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.devices)).toBe(true);
  });
});

describe("GET /api/dji-cloud/media", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/dji-cloud/media");
    expect(res.status).toBe(401);
  });

  it("returns 503 when the bridge isn't configured", async () => {
    delete process.env.DJI_CLOUD_URL;
    const res = await request(app)
      .get("/api/dji-cloud/media")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(503);
  });

  it("returns the media file listing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          message: "success",
          data: {
            list: [
              {
                file_id: "media-1",
                file_name: "DJI_0001.JPG",
                create_time: 1700000000000,
              },
            ],
            pagination: { page: 1, total: 1, page_size: 20 },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .get("/api/dji-cloud/media")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.list).toEqual([
      {
        file_id: "media-1",
        file_name: "DJI_0001.JPG",
        create_time: 1700000000000,
      },
    ]);
  });

  it("clamps page_size to the platform's own sane maximum", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          message: "success",
          data: { list: [], pagination: { page: 1, total: 0, page_size: 50 } },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await request(app)
      .get("/api/dji-cloud/media?pageSize=9999")
      .set("Authorization", `Bearer ${token}`);

    const [listUrl] = fetchMock.mock.calls[1];
    expect(listUrl).toContain("page_size=50");
  });
});

describe("GET /api/dji-cloud/media/:fileId/url", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/dji-cloud/media/abc/url");
    expect(res.status).toBe(401);
  });

  it("resolves the redirect Location header into a JSON url field", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            Location: "https://minio.example/media/DJI_0001.JPG?sig=abc",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .get("/api/dji-cloud/media/media-1/url")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toBe(
      "https://minio.example/media/DJI_0001.JPG?sig=abc",
    );
  });
});

describe("GET /api/dji-cloud/live/capacity", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/dji-cloud/live/capacity");
    expect(res.status).toBe(401);
  });

  it("returns the live-capable device/camera list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          message: "success",
          data: [
            {
              sn: "1ZNDH...",
              name: "Matrice 4T",
              cameras_list: [
                {
                  id: "cam-1",
                  device_sn: "1ZNDH...",
                  name: "Wide",
                  index: "39-0-0",
                  type: "normal",
                  videos_list: [
                    {
                      id: "1ZNDH.../39-0-0/normal-0",
                      index: "0",
                      type: "normal",
                    },
                  ],
                },
              ],
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .get("/api/dji-cloud/live/capacity")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.devices).toHaveLength(1);
    expect(res.body.devices[0].cameras_list[0].videos_list[0].id).toBe(
      "1ZNDH.../39-0-0/normal-0",
    );
  });
});

describe("POST /api/dji-cloud/live/start", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/dji-cloud/live/start")
      .send({ videoId: "x" });
    expect(res.status).toBe(401);
  });

  it("rejects a missing video_id", async () => {
    const res = await request(app)
      .post("/api/dji-cloud/live/start")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("starts the stream and returns success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, message: "success", data: null }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/dji-cloud/live/start")
      .set("Authorization", `Bearer ${token}`)
      .send({ videoId: "1ZNDH.../39-0-0/normal-0" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const [, startInit] = fetchMock.mock.calls[1];
    const startBody = JSON.parse(startInit.body);
    expect(startBody).toEqual({
      video_id: "1ZNDH.../39-0-0/normal-0",
      url_type: 1,
      video_quality: 0,
    });
  });

  it("returns hlsUrl null when the relay isn't configured", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, message: "success", data: null }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/dji-cloud/live/start")
      .set("Authorization", `Bearer ${token}`)
      .send({ videoId: "1ZNDH.../39-0-0/normal-0" });

    expect(res.body.hlsUrl).toBeNull();
  });

  it("builds an hlsUrl matching the platform's own RTMP stream-key convention when the relay is configured", async () => {
    process.env.DJI_CLOUD_LIVE_HLS_BASE_URL =
      "https://dji-cloud.skydata.cz/live-hls";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, message: "success", data: null }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/dji-cloud/live/start")
      .set("Authorization", `Bearer ${token}`)
      .send({ videoId: "1ZNDH.../39-0-0/normal-0" });

    expect(res.body.hlsUrl).toBe(
      "https://dji-cloud.skydata.cz/live-hls/1ZNDH...-39-0-0/index.m3u8",
    );
    delete process.env.DJI_CLOUD_LIVE_HLS_BASE_URL;
  });
});

describe("POST /api/dji-cloud/live/stop", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/dji-cloud/live/stop")
      .send({ videoId: "x" });
    expect(res.status).toBe(401);
  });

  it("rejects a missing video_id", async () => {
    const res = await request(app)
      .post("/api/dji-cloud/live/stop")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("stops the stream and returns success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, message: "success", data: null }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/dji-cloud/live/stop")
      .set("Authorization", `Bearer ${token}`)
      .send({ videoId: "1ZNDH.../39-0-0/normal-0" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("DJI Cloud personal account linking", () => {
  it("GET /account/link requires authentication", async () => {
    const res = await request(app).get("/api/dji-cloud/account/link");
    expect(res.status).toBe(401);
  });

  it("GET /account/link reports unlinked by default", async () => {
    const res = await request(app)
      .get("/api/dji-cloud/account/link")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: false });
  });

  it("POST /account/link rejects missing credentials", async () => {
    const res = await request(app)
      .post("/api/dji-cloud/account/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ username: "pilot" });
    expect(res.status).toBe(400);
  });

  it("POST /account/link rejects credentials the platform doesn't accept", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ code: -1, message: "Bad credentials", data: null }),
        ),
    );
    const res = await request(app)
      .post("/api/dji-cloud/account/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ username: "wrong", password: "wrong" });
    expect(res.status).toBe(400);

    const status = await request(app)
      .get("/api/dji-cloud/account/link")
      .set("Authorization", `Bearer ${token}`);
    expect(status.body.linked).toBe(false);
  });

  it("POST /account/link verifies and stores valid credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(loginOk()));
    const linkRes = await request(app)
      .post("/api/dji-cloud/account/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ username: "pilot-personal", password: "pilot-pw" });
    expect(linkRes.status).toBe(200);
    expect(linkRes.body.success).toBe(true);

    const status = await request(app)
      .get("/api/dji-cloud/account/link")
      .set("Authorization", `Bearer ${token}`);
    expect(status.body).toEqual({
      linked: true,
      username: "pilot-personal",
      linkedAt: expect.any(String),
    });
  });

  it("subsequent actions authenticate with the linked account, not the service account", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(loginOk()));
    await request(app)
      .post("/api/dji-cloud/account/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ username: "pilot-personal", password: "pilot-pw" });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(waylinesListEmpty());
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .get("/api/dji-cloud/waylines")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    const [, loginInit] = fetchMock.mock.calls[0];
    const loginBody = JSON.parse(loginInit.body);
    expect(loginBody.username).toBe("pilot-personal");
    expect(loginBody.password).toBe("pilot-pw");
  });

  it("DELETE /account/link removes the linked account", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(loginOk()));
    await request(app)
      .post("/api/dji-cloud/account/link")
      .set("Authorization", `Bearer ${token}`)
      .send({ username: "pilot-personal", password: "pilot-pw" });

    const delRes = await request(app)
      .delete("/api/dji-cloud/account/link")
      .set("Authorization", `Bearer ${token}`);
    expect(delRes.status).toBe(200);

    const status = await request(app)
      .get("/api/dji-cloud/account/link")
      .set("Authorization", `Bearer ${token}`);
    expect(status.body).toEqual({ linked: false });
  });
});
