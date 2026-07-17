import path from "path";
import { fileURLToPath } from "url";
import swaggerJsdoc from "swagger-jsdoc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function toGlobPattern(p: string): string {
  return p.split(path.sep).join("/");
}

/**
 * Generates the OpenAPI 3.0 spec from `@openapi` JSDoc blocks co-located
 * with each route handler (see `routes/*.ts`). Keeping the docs inline with
 * the code — rather than a hand-maintained YAML file — means the spec can't
 * silently drift out of sync with a route's actual shape.
 *
 * Coverage is intentionally not exhaustive on day one: the primary route
 * groups (auth, missions, kmz, dji-cloud, weather, airspace,
 * template-presets, admin) have request/response shapes documented for
 * their main endpoints. A handful of narrower endpoints are left as
 * follow-up — see the PR description for the exact list.
 */
export function buildOpenApiSpec() {
  return swaggerJsdoc({
    definition: {
      openapi: "3.0.3",
      info: {
        title: "SkyRoute API",
        version: "1.0.0",
        description:
          "REST API for the SkyRoute drone mission planner. Served here only " +
          "outside production — see NODE_ENV gating in index.ts.",
      },
      servers: [{ url: "/api" }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description:
              "For CLI/API/script clients. The browser SPA instead uses the " +
              "httpOnly `droneroute_token` cookie set by the auth endpoints " +
              "below — not usable from this docs UI, but documented here so " +
              "the two auth paths aren't a surprise.",
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    // Glob patterns are resolved relative to this file's directory. Compiled
    // output (dist/routes/*.js) carries the same JSDoc comments through
    // tsc's default comment-preserving emit, so this also works in
    // production builds where NODE_ENV gating is later relaxed.
    //
    // `glob` (used internally by swagger-jsdoc) requires forward slashes in
    // patterns even on Windows — `path.join` on win32 produces backslashes,
    // which silently match zero files instead of erroring.
    apis: [
      toGlobPattern(path.join(__dirname, "../routes/*.ts")),
      toGlobPattern(path.join(__dirname, "../routes/*.js")),
    ],
  });
}
