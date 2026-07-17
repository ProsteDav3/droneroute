import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret } from "./encryption.js";

describe("encryption", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-jwt-secret-value";
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it("round-trips a plaintext string", () => {
    const encrypted = encryptSecret("s3cret-password");
    expect(encrypted).not.toBe("s3cret-password");
    expect(decryptSecret(encrypted)).toBe("s3cret-password");
  });

  it("produces a different ciphertext on each call (random IV)", () => {
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same-input");
    expect(decryptSecret(b)).toBe("same-input");
  });

  it("throws when JWT_SECRET is missing", () => {
    delete process.env.JWT_SECRET;
    expect(() => encryptSecret("x")).toThrow();
  });

  it("throws on a tampered ciphertext (auth tag mismatch)", () => {
    const encrypted = encryptSecret("password");
    const [iv, authTag, data] = encrypted.split(":");
    const tampered = `${iv}:${authTag}:${data.slice(0, -2)}ff`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("throws on a malformed payload", () => {
    expect(() => decryptSecret("not-a-valid-payload")).toThrow();
  });
});
