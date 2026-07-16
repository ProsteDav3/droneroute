import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { authenticator } from "otplib";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    const selfHosted = (process.env.SELF_HOSTED ?? "true") === "true";
    if (selfHosted) {
      // Self-hosted dev mode: use a default secret with a warning
      console.warn(
        "WARNING: JWT_SECRET is not set. Using insecure default. Set JWT_SECRET in production.",
      );
      return "droneroute-dev-secret-do-not-use-in-production";
    }
    throw new Error(
      "JWT_SECRET environment variable is required in cloud mode",
    );
  }
  if (secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters for security");
  }
  return secret;
}

const JWT_SECRET = getJwtSecret();
const TOKEN_EXPIRY = "7d";
// Short-lived — just long enough for a user to read a 6-digit code off their
// authenticator app and type it in before the challenge token itself expires.
const TWO_FACTOR_CHALLENGE_EXPIRY = "5m";
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function comparePassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

/**
 * `tokenVersion` is embedded in every issued JWT and compared against the
 * user's current `token_version` column on every authenticated request
 * (see middleware/auth.ts). Bumping the column (password change/reset)
 * immediately invalidates every previously issued token for that account —
 * no server-side session/token blocklist needed.
 */
export function generateToken(
  userId: string,
  isAdmin: boolean,
  tokenVersion: number,
): string {
  return jwt.sign({ userId, isAdmin, tokenVersion }, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });
}

export function verifyToken(
  token: string,
): { userId: string; isAdmin: boolean; tokenVersion: number } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      isAdmin: boolean;
      tokenVersion?: number;
    };
    // Tokens issued before this field existed have no claim at all — treat
    // that as version 0, matching the column's default, so upgrading the
    // server doesn't retroactively invalidate every outstanding session.
    return {
      userId: payload.userId,
      isAdmin: payload.isAdmin,
      tokenVersion: payload.tokenVersion ?? 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Password reset tokens
// ---------------------------------------------------------------------------

/** Raw, single-use token — only ever sent to the user, never stored as-is. */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** What actually lives in `password_reset_tokens.token_hash`. */
export function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function resetTokenExpiresAt(): string {
  return new Date(Date.now() + RESET_TOKEN_EXPIRY_MS).toISOString();
}

// ---------------------------------------------------------------------------
// 2FA (TOTP) login challenge
// ---------------------------------------------------------------------------

/**
 * Issued after a correct email+password check on an account with 2FA
 * enabled, in place of a real session JWT. Carries a distinct `purpose`
 * claim so it can never be replayed as a normal auth token even though it's
 * signed with the same secret.
 */
export function generateTwoFactorChallengeToken(userId: string): string {
  return jwt.sign({ userId, purpose: "2fa-challenge" }, JWT_SECRET, {
    expiresIn: TWO_FACTOR_CHALLENGE_EXPIRY,
  });
}

export function verifyTwoFactorChallengeToken(
  token: string,
): { userId: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      userId?: string;
      purpose?: string;
    };
    if (payload.purpose !== "2fa-challenge" || !payload.userId) return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 2FA (TOTP) secret management
// ---------------------------------------------------------------------------

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpKeyUri(email: string, secret: string): string {
  return authenticator.keyuri(email, "SkyRoute", secret);
}

export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}

export function getGoogleClientId(): string | undefined {
  return process.env.GOOGLE_CLIENT_ID;
}

export async function verifyGoogleToken(
  idToken: string,
): Promise<{ email: string; googleId: string } | null> {
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID is not configured");
  }
  const client = new OAuth2Client(clientId);
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload?.sub) {
      return null;
    }
    return { email: payload.email, googleId: payload.sub };
  } catch {
    return null;
  }
}
