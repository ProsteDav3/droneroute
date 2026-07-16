import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { DEFAULT_SERVER_URL } from "./constants.js";

vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
  },
}));

const mockedFs = vi.mocked(fs);

beforeEach(() => {
  vi.resetModules();
  mockedFs.readFileSync.mockReset();
  mockedFs.writeFileSync.mockReset();
  mockedFs.mkdirSync.mockReset();
  mockedFs.chmodSync.mockReset();
  delete process.env.DRONEROUTE_SERVER;
  delete process.env.DRONEROUTE_TOKEN;
});

afterEach(() => {
  delete process.env.DRONEROUTE_SERVER;
  delete process.env.DRONEROUTE_TOKEN;
});

describe("resolveServer", () => {
  it("falls back to the built-in default when nothing else is set", async () => {
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const { resolveServer } = await import("./config.js");

    expect(resolveServer()).toBe(DEFAULT_SERVER_URL);
  });

  it("prefers the CLI flag over everything else", async () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ server: "https://from-config.example" }),
    );
    process.env.DRONEROUTE_SERVER = "https://from-env.example";
    const { resolveServer } = await import("./config.js");

    expect(resolveServer("https://from-flag.example")).toBe(
      "https://from-flag.example",
    );
  });

  it("prefers the env var over the config file", async () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ server: "https://from-config.example" }),
    );
    process.env.DRONEROUTE_SERVER = "https://from-env.example";
    const { resolveServer } = await import("./config.js");

    expect(resolveServer()).toBe("https://from-env.example");
  });

  it("falls back to the cached config file when no flag or env var is set", async () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ server: "https://from-config.example" }),
    );
    const { resolveServer } = await import("./config.js");

    expect(resolveServer()).toBe("https://from-config.example");
  });
});

describe("resolveToken", () => {
  it("returns undefined when no token is configured anywhere", async () => {
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const { resolveToken } = await import("./config.js");

    expect(resolveToken()).toBeUndefined();
  });

  it("prefers the CLI flag over the cached config file", async () => {
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({ token: "cached-token" }),
    );
    const { resolveToken } = await import("./config.js");

    expect(resolveToken("flag-token")).toBe("flag-token");
  });
});

describe("writeConfig", () => {
  it("writes the config file with restrictive (owner-only) permissions", async () => {
    const { writeConfig } = await import("./config.js");

    writeConfig({ server: "https://server.example", token: "tok" });

    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("config.json"),
      expect.stringContaining("https://server.example"),
      expect.objectContaining({ mode: 0o600 }),
    );
    expect(mockedFs.chmodSync).toHaveBeenCalledWith(
      expect.stringContaining("config.json"),
      0o600,
    );
  });

  it("creates the config directory with owner-only permissions", async () => {
    const { writeConfig } = await import("./config.js");

    writeConfig({ server: "https://server.example", token: "tok" });

    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(".droneroute"),
      expect.objectContaining({ recursive: true, mode: 0o700 }),
    );
  });

  it("re-asserts owner-only permissions on an already-existing config directory", async () => {
    // mkdirSync's `mode` option is only honored when it actually creates the
    // directory — on an upgrade from an earlier install where the directory
    // already exists (e.g. at the OS default 0o755), it must be re-chmod'd
    // explicitly rather than silently left permissive.
    const { writeConfig } = await import("./config.js");

    writeConfig({ server: "https://server.example", token: "tok" });

    expect(mockedFs.chmodSync).toHaveBeenCalledWith(
      expect.stringContaining(".droneroute"),
      0o700,
    );
  });
});
