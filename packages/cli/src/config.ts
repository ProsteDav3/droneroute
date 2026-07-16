import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SERVER_URL } from "./constants.js";

/** Contents of `~/.droneroute/config.json`. */
export interface CliConfig {
  /** SkyRoute server base URL, e.g. "https://skydata-droneroute-kcp.fly.dev". */
  server?: string;
  /** JWT returned by `POST /api/auth/login`, cached by `droneroute login`. */
  token?: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".droneroute");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

/** Read the local CLI config file. Returns `{}` if it doesn't exist or is invalid. */
export function readConfig(): CliConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Write the local CLI config file with restrictive permissions (owner
 * read/write only) since it holds a bearer token. `chmod` is best-effort —
 * Windows doesn't support POSIX file modes, so failures there are ignored.
 */
export function writeConfig(config: CliConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // Best-effort — not all platforms/filesystems support POSIX permissions.
  }
}

/** Resolve the server URL: CLI flag > env var > config file > built-in default. */
export function resolveServer(cliFlag?: string): string {
  return (
    cliFlag ||
    process.env.DRONEROUTE_SERVER ||
    readConfig().server ||
    DEFAULT_SERVER_URL
  );
}

/** Resolve the auth token: CLI flag > env var > config file (no fallback — may be undefined). */
export function resolveToken(cliFlag?: string): string | undefined {
  return cliFlag || process.env.DRONEROUTE_TOKEN || readConfig().token;
}

export { CONFIG_FILE };
