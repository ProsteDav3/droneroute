import { describe, it, expect, vi, afterEach } from "vitest";
import { loginWithPassword, LoginError } from "./login.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loginWithPassword", () => {
  it("returns the token on a successful login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { token: "jwt-token" })),
    );

    const token = await loginWithPassword(
      "https://server.example",
      "a@b.com",
      "pw",
    );
    expect(token).toBe("jwt-token");
  });

  it("throws a clear error when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ENOTFOUND")));

    await expect(
      loginWithPassword("https://server.example", "a@b.com", "pw"),
    ).rejects.toThrow(/Could not reach the SkyRoute server/);
  });

  it("surfaces the server's error message on invalid credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(401, { error: "Neplatný e-mail nebo heslo" }),
        ),
    );

    await expect(
      loginWithPassword("https://server.example", "a@b.com", "wrong"),
    ).rejects.toThrow("Neplatný e-mail nebo heslo");
  });

  it("throws when the response has no token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {})));

    await expect(
      loginWithPassword("https://server.example", "a@b.com", "pw"),
    ).rejects.toThrow(/Unexpected response/);
  });

  it("throws LoginError specifically (not a generic Error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));

    await expect(
      loginWithPassword("https://server.example", "a@b.com", "pw"),
    ).rejects.toBeInstanceOf(LoginError);
  });
});
