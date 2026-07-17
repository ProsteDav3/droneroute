import crypto from "crypto";

/**
 * At-rest encryption for third-party credentials that must be stored in a
 * reversible form (unlike user passwords, which are one-way hashed) —
 * currently just each user's own DJI Cloud platform password, needed
 * because the DJI Cloud login endpoint takes a raw username+password, not
 * a token SkyRoute could store instead.
 *
 * Deliberately does not require a new env var: the key is derived from the
 * existing required `JWT_SECRET` via SHA-256, which is a distinct 32-byte
 * value from the secret itself (key derivation, not key reuse) — so every
 * self-hosted deployment that already has auth working gets this for free,
 * without an extra required setting for someone to forget.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended for GCM

function getKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET musí být nastaven pro šifrování přihlašovacích údajů",
    );
  }
  return crypto
    .createHash("sha256")
    .update(`dji-cloud-creds:${secret}`)
    .digest();
}

/** Returns `iv:authTag:ciphertext`, all hex-encoded, so the whole thing fits
 * in one TEXT column. */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, authTagHex, dataHex] = payload.split(":");
  if (!ivHex || !authTagHex || !dataHex) {
    throw new Error("Neplatný formát šifrovaných dat");
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
