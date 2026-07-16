import { describe, it, expect, vi, afterEach } from "vitest";
import {
  uploadMissionToCloud,
  ensureToken,
  CloudUploadError,
} from "./cloudUpload.js";

const payload = {
  name: "Test mission",
  config: { autoFlightSpeed: 7 },
  waypoints: [
    { index: 0, latitude: 41.25, longitude: 0.93, height: 30 },
    { index: 1, latitude: 41.26, longitude: 0.94, height: 30 },
  ],
  pois: [],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureToken", () => {
  it("returns the token unchanged when present", () => {
    expect(ensureToken("abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("throws a clear error telling the user to log in first when the token is missing", () => {
    expect(() => ensureToken(undefined)).toThrow(CloudUploadError);
    try {
      ensureToken(undefined);
    } catch (err) {
      expect(err).toBeInstanceOf(CloudUploadError);
      expect((err as Error).message).toMatch(/droneroute login/);
    }
  });
});

describe("uploadMissionToCloud", () => {
  it("returns the wayline name on a successful upload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { waylineName: "Test mission (1)" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadMissionToCloud(
      "https://server.example",
      "tok",
      payload,
    );

    expect(result).toEqual({ waylineName: "Test mission (1)" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://server.example/api/dji-cloud/upload",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    );
  });

  it("strips a trailing slash from the server URL before building the request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { waylineName: "x" }));
    vi.stubGlobal("fetch", fetchMock);

    await uploadMissionToCloud("https://server.example/", "tok", payload);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://server.example/api/dji-cloud/upload",
      expect.anything(),
    );
  });

  it("throws a clear error when the server is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );

    await expect(
      uploadMissionToCloud("https://server.example", "tok", payload),
    ).rejects.toThrow(/Could not reach the SkyRoute server/);
  });

  it("throws with the server's message when DJI Cloud is not configured (503)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(503, {
          error: "DJI Cloud není na tomto serveru nakonfigurován",
        }),
      ),
    );

    await expect(
      uploadMissionToCloud("https://server.example", "tok", payload),
    ).rejects.toThrow("DJI Cloud není na tomto serveru nakonfigurován");
  });

  it("throws a generic message on upstream failure (502)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(502, { error: "Nahrání do DJI Cloud selhalo" }),
        ),
    );

    await expect(
      uploadMissionToCloud("https://server.example", "tok", payload),
    ).rejects.toThrow("Nahrání do DJI Cloud selhalo");
  });

  it("prompts to re-login on 401/403", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, {})));

    await expect(
      uploadMissionToCloud("https://server.example", "tok", payload),
    ).rejects.toThrow(/droneroute login/);
  });

  it("throws when the response has no waylineName", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {})));

    await expect(
      uploadMissionToCloud("https://server.example", "tok", payload),
    ).rejects.toThrow(/Unexpected response/);
  });
});
