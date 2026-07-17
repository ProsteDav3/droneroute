import { describe, it, expect } from "vitest";
import { httpLogRedactPaths, shouldSkipHttpLog } from "./logger.js";

describe("httpLogRedactPaths", () => {
  it("redacts the Authorization header and cookies", () => {
    expect(httpLogRedactPaths).toContain("req.headers.authorization");
    expect(httpLogRedactPaths).toContain("req.headers.cookie");
  });
});

describe("shouldSkipHttpLog", () => {
  it("skips the health check endpoint", () => {
    expect(shouldSkipHttpLog("/api/health")).toBe(true);
  });

  it("skips shared-mission routes (the token in the path is a bearer capability)", () => {
    expect(shouldSkipHttpLog("/api/shared/abc123")).toBe(true);
    expect(shouldSkipHttpLog("/api/shared/abc123/clone")).toBe(true);
  });

  it("does not skip unrelated routes", () => {
    expect(shouldSkipHttpLog("/api/missions")).toBe(false);
    expect(shouldSkipHttpLog("/api/admin/users")).toBe(false);
    expect(shouldSkipHttpLog("/api/config")).toBe(false);
  });

  it("does not skip a route that merely starts with the same prefix as health", () => {
    expect(shouldSkipHttpLog("/api/healthcheck")).toBe(false);
  });

  it("handles an undefined url without throwing", () => {
    expect(shouldSkipHttpLog(undefined)).toBe(false);
  });
});
