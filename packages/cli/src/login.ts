import { input, password as passwordPrompt } from "@inquirer/prompts";
import { readConfig, writeConfig } from "./config.js";

export class LoginError extends Error {}

function normalizeServerUrl(server: string): string {
  return server.replace(/\/+$/, "");
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Log in against a SkyRoute server's `POST /api/auth/login` (email +
 * password, self-hosted-mode auth — cloud-mode instances that only support
 * Google sign-in will reject this with a clear server-provided message).
 * Returns the JWT on success.
 */
export async function loginWithPassword(
  server: string,
  email: string,
  password: string,
): Promise<string> {
  const url = `${normalizeServerUrl(server)}/api/auth/login`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new LoginError(
      `Could not reach the SkyRoute server at ${server}: ${message}`,
    );
  }

  const body = await safeJson(response);

  if (!response.ok) {
    const serverMessage =
      typeof body.error === "string" ? body.error : undefined;
    throw new LoginError(
      serverMessage || `Login failed (HTTP ${response.status})`,
    );
  }

  const token = body.token;
  if (typeof token !== "string" || !token) {
    throw new LoginError("Unexpected response from the SkyRoute server");
  }

  return token;
}

/**
 * Interactive `droneroute login` flow: prompt for the server (defaulting to
 * whatever is already configured), email, and password, then cache the
 * resulting JWT in `~/.droneroute/config.json`.
 */
export async function runInteractiveLogin(
  defaultServer: string,
  serverFlag?: string,
): Promise<void> {
  const server =
    serverFlag ||
    (await input({
      message: "SkyRoute server URL",
      default: defaultServer,
    }));

  const email = await input({ message: "Email" });
  const pass = await passwordPrompt({ message: "Password", mask: "*" });

  const token = await loginWithPassword(server, email, pass);

  writeConfig({ ...readConfig(), server, token });
}
