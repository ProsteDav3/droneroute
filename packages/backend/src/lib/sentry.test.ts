import { describe, it, expect, afterEach } from "vitest";
import { isSentryEnabled, initSentry } from "./sentry.js";

afterEach(() => {
  delete process.env.SENTRY_DSN;
});

describe("isSentryEnabled", () => {
  it("is false when SENTRY_DSN is unset", () => {
    delete process.env.SENTRY_DSN;
    expect(isSentryEnabled()).toBe(false);
  });

  it("is true when SENTRY_DSN is set", () => {
    process.env.SENTRY_DSN = "https://key@o0.ingest.sentry.io/0";
    expect(isSentryEnabled()).toBe(true);
  });
});

describe("initSentry", () => {
  it("is a no-op that doesn't throw when SENTRY_DSN is unset", () => {
    delete process.env.SENTRY_DSN;
    expect(() => initSentry()).not.toThrow();
  });
});
