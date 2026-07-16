import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { notamRoutes } from "./notam.js";

describe("GET /api/notam", () => {
  let app: express.Express;

  beforeAll(() => {
    process.env.NODE_ENV = "test";
    app = express();
    app.use("/api/notam", notamRoutes);
  });

  it("returns 400 when bounds are missing", async () => {
    const res = await request(app).get("/api/notam");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("returns 400 when bounds aren't valid numbers", async () => {
    const res = await request(app).get(
      "/api/notam?south=abc&west=14&north=50&east=16",
    );
    expect(res.status).toBe(400);
  });

  it("returns a briefing link with center and date for valid bounds", async () => {
    const res = await request(app).get(
      "/api/notam?south=49&west=14&north=50&east=16",
    );
    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://ibs.rlp.cz/");
    expect(res.body.center).toEqual({ lat: 49.5, lng: 15 });
    expect(typeof res.body.date).toBe("string");
    expect(typeof res.body.note).toBe("string");
  });

  it("passes through a valid date param", async () => {
    const res = await request(app).get(
      "/api/notam?south=49&west=14&north=50&east=16&date=2026-08-01",
    );
    expect(res.status).toBe(200);
    expect(res.body.date).toBe("2026-08-01");
  });
});
