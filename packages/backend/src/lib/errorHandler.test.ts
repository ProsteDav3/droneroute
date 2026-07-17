import express from "express";
import request from "supertest";
import pinoHttp from "pino-http";
import { describe, it, expect } from "vitest";
import { logger } from "./logger.js";
import {
  requestIdHeaderMiddleware,
  errorHandler,
  genReqId,
} from "./errorHandler.js";

function buildTestApp() {
  const app = express();
  // Same middleware order as index.ts: pino-http assigns req.id first, then
  // the header middleware echoes it, then routes, then the error handler.
  app.use(pinoHttp({ logger, genReqId }));
  app.use(requestIdHeaderMiddleware);

  app.get("/ok", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/client-error", (_req, _res, next) => {
    const err = Object.assign(new Error("bad input"), { status: 400 });
    next(err);
  });

  app.get("/server-error", (_req, _res, next) => {
    next(new Error("database exploded"));
  });

  app.use(errorHandler);
  return app;
}

describe("requestIdHeaderMiddleware / errorHandler", () => {
  it("sets X-Request-Id on a successful response, even without an error", async () => {
    const res = await request(buildTestApp()).get("/ok");

    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("reuses an inbound X-Request-Id header instead of generating a new one", async () => {
    const res = await request(buildTestApp())
      .get("/ok")
      .set("X-Request-Id", "client-supplied-id-123");

    expect(res.headers["x-request-id"]).toBe("client-supplied-id-123");
  });

  it("masks a server error's message but preserves the X-Request-Id correlation", async () => {
    const res = await request(buildTestApp()).get("/server-error");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal server error");
    expect(res.body.error).not.toContain("database exploded");
    expect(res.headers["x-request-id"]).toBeTruthy();
    // The id in the error body must match the one in the response header —
    // that's the whole point of the correlation id.
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
  });

  it("preserves a client-error status code but still masks the message", async () => {
    const res = await request(buildTestApp()).get("/client-error");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Bad request");
    expect(res.body.error).not.toContain("bad input");
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
  });

  it("gives two different requests two different ids", async () => {
    const app = buildTestApp();
    const first = await request(app).get("/ok");
    const second = await request(app).get("/ok");

    expect(first.headers["x-request-id"]).not.toBe(
      second.headers["x-request-id"],
    );
  });
});
