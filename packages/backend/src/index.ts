import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import { initDb } from "./models/db.js";
import { missionRoutes } from "./routes/missions.js";
import { kmzRoutes } from "./routes/kmz.js";
import { authRoutes } from "./routes/auth.js";
import { sharedRoutes } from "./routes/shared.js";
import { airspaceRoutes } from "./routes/airspace.js";
import { adminRoutes } from "./routes/admin.js";
import { preferencesRoutes } from "./routes/preferences.js";
import { templatePresetRoutes } from "./routes/templatePresets.js";
import { weatherRoutes } from "./routes/weather.js";
import { djiCloudRoutes } from "./routes/djiCloud.js";
import { isDjiCloudConfigured } from "./services/djiCloud.js";
import { globalLimiter } from "./middleware/rateLimit.js";
import { resolveDefaultMapView } from "./lib/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

// Trust reverse proxy (e.g. nginx, Docker) so rate limiting uses real client IP
app.set("trust proxy", 1);

// Security headers. CSP allowlists exactly what the SPA needs at runtime:
// - Mapbox GL (tiles/styles/geocoding over `connect-src`, its web workers
//   loaded from blob: URLs over `worker-src`, and raster/vector tile images
//   over `img-src`).
// - Google Identity Services (cloud mode's "Sign in with Google" button),
//   which injects its own <script> from accounts.google.com and renders its
//   button/One Tap prompt in a same-origin-adjacent iframe.
// - Google Fonts (index.html's Inter stylesheet + font files).
// COEP stays disabled — it's unrelated to CSP and enabling it has previously
// broken the Mapbox GL / Google OAuth combination in this app.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://accounts.google.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        connectSrc: [
          "'self'",
          "https://api.mapbox.com",
          "https://events.mapbox.com",
          "https://*.tiles.mapbox.com",
          "https://accounts.google.com",
        ],
        workerSrc: ["'self'", "blob:"],
        frameSrc: ["'self'", "https://accounts.google.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    // Allow Google OAuth popups (cloud mode) to message back to the opener.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);

// Helmet dropped Permissions-Policy support (no browser standardized it the
// way Feature-Policy was), so it's set directly here. Disables three
// sensitive browser APIs the app has no legitimate use for.
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  next();
});

// CORS configuration. The SPA is served same-origin (and dev uses the Vite /api
// proxy), so cross-origin access is only needed for split deployments. When
// CORS_ORIGIN is unset we disable cross-origin requests entirely rather than
// reflecting every origin.
const corsOrigin = process.env.CORS_ORIGIN;
app.use(
  cors(
    corsOrigin
      ? {
          origin: corsOrigin.split(",").map((o) => o.trim()),
          credentials: true,
        }
      : { origin: false },
  ),
);
app.use(express.json({ limit: "50mb" }));
app.use(globalLimiter);

// Serve frontend static files in production
const frontendDist = path.join(__dirname, "../../frontend/dist");
app.use(express.static(frontendDist));

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/missions", missionRoutes);
app.use("/api/kmz", kmzRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/preferences", preferencesRoutes);
app.use("/api/template-presets", templatePresetRoutes);
app.use("/api/weather", weatherRoutes);
app.use("/api/airspace", airspaceRoutes);
app.use("/api/dji-cloud", djiCloudRoutes);
app.use("/api", sharedRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Public config (exposes non-secret settings to the frontend)
app.get("/api/config", (_req, res) => {
  const selfHosted = (process.env.SELF_HOSTED ?? "true") === "true";
  res.json({
    selfHosted,
    googleClientId: selfHosted ? undefined : process.env.GOOGLE_CLIENT_ID,
    mapboxToken: process.env.MAPBOX_TOKEN || "",
    djiCloudEnabled: isDjiCloudConfigured(),
    defaultMapView: resolveDefaultMapView(),
  });
});

// SPA fallback (Express 5 syntax)
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

// Global error handler — log the full error server-side, never leak details
// (stack traces, SQL, internal paths) to the client.
const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) {
    next(err);
    return;
  }
  // Preserve client-error status codes (e.g. malformed JSON, payload too large)
  // but never echo the underlying message, stack trace or internal details.
  const status =
    (err as { status?: number; statusCode?: number })?.status ??
    (err as { statusCode?: number })?.statusCode ??
    500;
  const isClientError = status >= 400 && status < 500;
  res
    .status(isClientError ? status : 500)
    .json({ error: isClientError ? "Bad request" : "Internal server error" });
};
app.use(errorHandler);

// Initialize database and start server
initDb();
app.listen(PORT, () => {
  console.log(`DroneRoute server running on http://localhost:${PORT}`);
  const selfHosted = (process.env.SELF_HOSTED ?? "true") === "true";
  const adminEmail = process.env.ADMIN_EMAIL || "";
  console.log(
    `Mode: ${selfHosted ? "self-hosted" : "cloud"}${!selfHosted && adminEmail ? ` (admin: ${adminEmail})` : ""}`,
  );
});
