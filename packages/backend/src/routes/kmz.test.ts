import express from "express";
import request from "supertest";
import JSZip from "jszip";
import { describe, it, expect } from "vitest";
import { kmzRoutes } from "./kmz.js";

const app = express();
app.use(express.json());
app.use("/api/kmz", kmzRoutes);

function waypoint(
  index: number,
  lat: number,
  lng: number,
  actions: unknown[] = [],
) {
  return {
    index,
    name: `WP${index + 1}`,
    latitude: lat,
    longitude: lng,
    height: 30,
    speed: 5,
    gimbalPitchAngle: 0,
    useGlobalHeadingParam: false,
    headingMode: "towardPOI" as const,
    poiId: "poi-1",
    actions,
  };
}

const baseBody = {
  name: "Orbit test",
  config: { autoFlightSpeed: 5 },
  pois: [
    {
      id: "poi-1",
      name: "Center",
      latitude: 41.258,
      longitude: 0.932,
      height: 0,
    },
  ],
};

describe("POST /api/kmz/generate-segments", () => {
  it("rejects fewer than 2 waypoints", async () => {
    const res = await request(app)
      .post("/api/kmz/generate-segments")
      .send({ ...baseBody, waypoints: [waypoint(0, 41.25, 0.93)] });
    expect(res.status).toBe(400);
  });

  it("splits an N-waypoint route into N-1 single-leg .kmz files", async () => {
    const waypoints = [
      waypoint(0, 41.258, 0.9315),
      waypoint(1, 41.2585, 0.932),
      waypoint(2, 41.259, 0.9315),
      waypoint(3, 41.2585, 0.931),
    ];

    const res = await request(app)
      .post("/api/kmz/generate-segments")
      .send({ ...baseBody, waypoints })
      .buffer()
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");

    const zip = await JSZip.loadAsync(res.body as Buffer);
    const kmzEntries = Object.keys(zip.files).filter((name) =>
      name.endsWith(".kmz"),
    );

    // 4 waypoints -> 3 consecutive one-leg missions
    expect(kmzEntries).toHaveLength(3);
    expect(kmzEntries.some((name) => name.includes("seg-1-of-3"))).toBe(true);
    expect(kmzEntries.some((name) => name.includes("seg-3-of-3"))).toBe(true);

    // Each leg .kmz must itself be a valid zip containing exactly 2 waypoints
    for (const entryName of kmzEntries) {
      const entryBuffer = await zip.files[entryName].async("nodebuffer");
      const legZip = await JSZip.loadAsync(entryBuffer);
      const wpml = await legZip.file("wpmz/waylines.wpml")?.async("string");
      expect(wpml).toBeTruthy();
      const placemarkCount = (wpml?.match(/<Placemark>/g) || []).length;
      expect(placemarkCount).toBe(2);
      // The shared POI heading target must survive into every leg
      expect(wpml).toContain("towardPOI");
    }
  });
});

describe("POST /api/kmz/generate — takePhoto lens selection", () => {
  it("omits payloadLensIndex/useGlobalPayloadLensIndex when the action doesn't specify a lens (existing behavior)", async () => {
    const waypoints = [
      waypoint(0, 41.258, 0.9315, [
        {
          actionId: 0,
          actionType: "takePhoto",
          params: { payloadPositionIndex: 0 },
        },
      ]),
      waypoint(1, 41.259, 0.9315),
    ];

    const res = await request(app)
      .post("/api/kmz/generate")
      .send({ ...baseBody, waypoints })
      .buffer()
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(res.body as Buffer);
    const wpml = await zip.file("wpmz/waylines.wpml")?.async("string");
    expect(wpml).toContain(
      "<wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>",
    );
    expect(wpml).not.toContain("payloadLensIndex");
  });

  it("emits payloadLensIndex=ir when the action targets the thermal lens", async () => {
    const waypoints = [
      waypoint(0, 41.258, 0.9315, [
        {
          actionId: 0,
          actionType: "takePhoto",
          params: { payloadPositionIndex: 0, payloadLensIndex: "ir" },
        },
      ]),
      waypoint(1, 41.259, 0.9315),
    ];

    const res = await request(app)
      .post("/api/kmz/generate")
      .send({ ...baseBody, waypoints })
      .buffer()
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(res.body as Buffer);
    const wpml = await zip.file("wpmz/waylines.wpml")?.async("string");
    expect(wpml).toContain("<wpml:payloadLensIndex>ir</wpml:payloadLensIndex>");
    expect(wpml).toContain(
      "<wpml:useGlobalPayloadLensIndex>0</wpml:useGlobalPayloadLensIndex>",
    );
  });
});
