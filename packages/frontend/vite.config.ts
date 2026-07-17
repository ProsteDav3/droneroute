import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { execSync } from "child_process";
import { readFileSync } from "fs";

const commitSha = (() => {
  if (process.env.COMMIT_SHA) return process.env.COMMIT_SHA;
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
})();

const appVersion = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8"),
    );
    return pkg.version;
  } catch {
    return "dev";
  }
})();

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // autoUpdate (rather than the prompt strategy) means a new deploy
      // takes effect on the visitor's very next page load with no manual
      // "update available" click needed — appropriate here since the app
      // shell is what's precached, not user data, so there's nothing to
      // lose by swapping it in immediately.
      registerType: "autoUpdate",
      // main.tsx calls registerSW() itself — don't also auto-inject a
      // registration script, which would register the service worker twice.
      injectRegister: false,
      // Deliberately does NOT add any `runtimeCaching` entries for `/api/*`
      // — this app plans real drone flights, and silently serving stale
      // mission/weather/airspace data while "offline" would be actively
      // dangerous. Only the static app shell (JS/CSS/HTML/icons) is
      // precached, so the app's UI loads without a network connection, but
      // every API call still goes live-or-fails exactly as before.
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        // The main JS chunk is ~2.5MB (well above workbox's 2MB default
        // precache limit) — see the build's own chunk-size warning about
        // splitting it further, tracked separately. Raised rather than
        // excluding the chunk, since excluding it would defeat the point:
        // the app wouldn't actually load offline without it.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: "SkyRoute",
        short_name: "SkyRoute",
        description: "Drone flight mission planning",
        theme_color: "#0a1628",
        background_color: "#0a1628",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/skyroute-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
    }),
  ],
  define: {
    __COMMIT_SHA__: JSON.stringify(commitSha),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  // Mirrors the dev server proxy above so `vite preview` (used by the
  // Playwright E2E suite — see e2e/) can talk to a locally-running backend
  // without needing a separate reverse proxy or CORS configuration.
  preview: {
    port: 4173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
