import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import swaggerUi from "swagger-ui-express";
import { initDb } from "./models/db.js";
import { buildOpenApiSpec } from "./lib/openapi.js";
import { missionRoutes } from "./routes/missions.js";
import { kmzRoutes } from "./routes/kmz.js";
import { authRoutes } from "./routes/auth.js";
import { sharedRoutes } from "./routes/shared.js";
import { airspaceRoutes } from "./routes/airspace.js";
import { notamRoutes } from "./routes/notam.js";
import { adminRoutes } from "./routes/admin.js";
import { preferencesRoutes } from "./routes/preferences.js";
import { templatePresetRoutes } from "./routes/templatePresets.js";
import { weatherRoutes } from "./routes/weather.js";
import { djiCloudRoutes } from "./routes/djiCloud.js";
import { flightLogRoutes } from "./routes/flightLogs.js";
import { riskAssessmentRoutes } from "./routes/riskAssessments.js";
import { permitRoutes } from "./routes/permits.js";
import { healthRoutes } from "./routes/health.js";
import { isDjiCloudConfigured } from "./services/djiCloud.js";
import { globalLimiter } from "./middleware/rateLimit.js";
import { resolveDefaultMapView } from "./lib/config.js";
import { logger, httpLogRedactPaths, shouldSkipHttpLog } from "./lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

// Trust reverse proxy (e.g. nginx, Docker) so rate limiting uses real client IP
app.set("trust proxy", 1);

// Security headers. CSP is scoped to the hosts the SPA actually talks to,
// tightened wherever the directive allows it:
// - Mapbox GL (tiles/styles/geocoding over `connect-src`, its web workers
//   loaded from blob: URLs over `worker-src`). `img-src` allows `https:`
//   broadly rather than an exact host list — Mapbox serves raster/vector
//   tiles and marker imagery from several of its own subdomains that
//   aren't practical to enumerate exhaustively.
// - Google Identity Services (cloud mode's "Sign in with Google" button),
//   which injects its own <script> from accounts.google.com and renders its
//   button/One Tap prompt in a same-origin-adjacent iframe.
// - Google Fonts (index.html's Inter stylesheet + font files). `style-src`
//   still needs 'unsafe-inline' for Tailwind/UI-library inline styles.
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

// Per-request access logging. See lib/logger.ts for why the Authorization
// header is redacted and why /api/health + /api/shared/* are skipped.
app.use(
  pinoHttp({
    logger,
    redact: {
      paths: httpLogRedactPaths,
      censor: "[redacted]",
    },
    autoLogging: {
      ignore: (req) => shouldSkipHttpLog(req.url),
    },
  }),
);

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
app.use("/api/notam", notamRoutes);
app.use("/api/dji-cloud", djiCloudRoutes);
app.use("/api/flight-logs", flightLogRoutes);
app.use("/api/risk-assessments", riskAssessmentRoutes);
app.use("/api/permits", permitRoutes);
app.use("/api", healthRoutes);
app.use("/api", sharedRoutes);

// API docs (Swagger UI + raw spec) — non-production only. The generated
// spec reflects the full internal API shape, so it stays off in production
// by default rather than being exposed publicly; enable it deliberately
// (e.g. behind an admin check) if a deployment needs it there.
if (process.env.NODE_ENV !== "production") {
  const openApiSpec = buildOpenApiSpec();
  app.get("/api/docs.json", (_req, res) => {
    res.json(openApiSpec);
  });
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
}

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

// Embed widget page (public, read-only mission preview meant to be placed
// in an <iframe> on a third-party site). Helmet's frameguard defaults to
// `SAMEORIGIN`, which would block exactly that use case, so this route
// explicitly removes the header before falling through to the same SPA
// `index.html` the client-side router uses to render EmbedMissionPage.
// NOTE for reviewers: if a future security-hardening pass adds a stricter
// global frame-ancestors/X-Frame-Options policy, this route needs to stay
// as (or become) the one deliberate exception — everything else should
// keep the strict default.
app.get("/embed/:token", (_req, res) => {
  res.removeHeader("X-Frame-Options");
  res.sendFile(path.join(frontendDist, "index.html"));
});

// SPA fallback (Express 5 syntax)
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

// Global error handler — log the full error server-side, never leak details
// (stack traces, SQL, internal paths) to the client.
const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  logger.error({ err }, "Unhandled error");
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
  logger.info(`DroneRoute server running on http://localhost:${PORT}`);
  const selfHosted = (process.env.SELF_HOSTED ?? "true") === "true";
  const adminEmail = process.env.ADMIN_EMAIL || "";
  logger.info(
    `Mode: ${selfHosted ? "self-hosted" : "cloud"}${!selfHosted && adminEmail ? ` (admin: ${adminEmail})` : ""}`,
  );
});
