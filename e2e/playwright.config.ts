import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { FAKE_MAPBOX_TOKEN } from "./helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const FRONTEND_PORT = 4173;
const BACKEND_PORT = 3001;
const BASE_URL = `http://localhost:${FRONTEND_PORT}`;

/**
 * Shared env for the backend server this suite drives against. Isolated
 * from any real deployment: `DB_PATH=:memory:` means every CI run (and
 * every local `npm run test:e2e`) starts from a completely empty
 * database — no external services, no shared state between runs.
 */
const backendEnv = {
  ...process.env,
  SELF_HOSTED: "true",
  JWT_SECRET: "e2e-test-jwt-secret-not-for-production-use",
  DB_PATH: ":memory:",
  PORT: String(BACKEND_PORT),
  // See helpers.ts (FAKE_MAPBOX_TOKEN) for why this must be JWT-shaped, and
  // blockMapboxNetwork for how real Mapbox API calls are intercepted instead
  // of ever actually being sent using this token.
  MAPBOX_TOKEN: FAKE_MAPBOX_TOKEN,
  // Matches AGENTS.md's standard screenshot map coordinates so the visual
  // regression suite's map-adjacent UI renders at a stable, known location.
  DEFAULT_MAP_VIEW: "41.25797725781744,0.9322907667035154,15",
};

export default defineConfig({
  // Picks up both ./tests (functional specs) and ./visual (screenshot
  // regression specs) — anything matching *.spec.ts under the e2e/ root.
  testDir: ".",
  fullyParallel: false,
  // Self-hosted registration only succeeds once per (fresh, in-memory)
  // database — see global-setup.ts. Serializing workers keeps every spec's
  // API traffic against one predictable backend process without needing
  // per-worker database isolation.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: [
    {
      command: "node dist/index.js",
      cwd: path.join(repoRoot, "packages/backend"),
      url: `http://localhost:${BACKEND_PORT}/api/health`,
      env: backendEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `npx vite preview --port ${FRONTEND_PORT} --strictPort`,
      cwd: path.join(repoRoot, "packages/frontend"),
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
