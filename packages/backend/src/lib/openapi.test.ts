import express from "express";
import request from "supertest";
import swaggerUi from "swagger-ui-express";
import { describe, it, expect } from "vitest";
import { buildOpenApiSpec } from "./openapi.js";

// Smoke test only — this is not meant to validate every documented shape,
// just that the spec is generated, is valid, and is actually served (the
// same wiring `index.ts` uses, mounted on a throwaway app so this test
// doesn't need a real server or database).
describe("OpenAPI docs", () => {
  const spec = buildOpenApiSpec();

  const app = express();
  app.get("/api/docs.json", (_req, res) => {
    res.json(spec);
  });
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(spec));

  it("generates a valid OpenAPI 3 document", () => {
    expect((spec as any).openapi).toBe("3.0.3");
    expect((spec as any).info.title).toBe("SkyRoute API");
  });

  it("documents at least the primary route groups", () => {
    const paths = Object.keys((spec as any).paths ?? {});
    expect(paths.length).toBeGreaterThan(0);
    for (const expected of [
      "/auth/login",
      "/missions",
      "/kmz/generate",
      "/dji-cloud/upload",
      "/weather/forecast",
      "/airspace/zones",
      "/template-presets",
      "/admin/users",
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it("serves /api/docs.json as valid JSON", async () => {
    const res = await request(app).get("/api/docs.json");
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/json/);
    expect(res.body.openapi).toBe("3.0.3");
    expect(typeof res.body.paths).toBe("object");
  });

  it("serves the Swagger UI at /api/docs", async () => {
    const res = await request(app).get("/api/docs/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("swagger-ui");
  });
});
