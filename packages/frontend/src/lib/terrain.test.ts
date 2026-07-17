import { describe, it, expect, vi } from "vitest";
import {
  interpolatePoints,
  queryElevationProfile,
  queryElevationProfileWithRetry,
  buildFlightPathSamples,
  findTerrainCollisions,
  MIN_TERRAIN_CLEARANCE_M,
} from "./terrain";

describe("interpolatePoints", () => {
  it("returns just the start point when count < 2", () => {
    const from = { lat: 50, lng: 14 };
    expect(interpolatePoints(from, { lat: 51, lng: 15 }, 1)).toEqual([from]);
  });

  it("includes both endpoints", () => {
    const from = { lat: 50, lng: 14 };
    const to = { lat: 51, lng: 15 };
    const points = interpolatePoints(from, to, 5);
    expect(points[0]).toEqual(from);
    expect(points[points.length - 1]).toEqual(to);
    expect(points).toHaveLength(5);
  });

  it("evenly spaces the midpoint", () => {
    const points = interpolatePoints(
      { lat: 0, lng: 0 },
      { lat: 10, lng: 20 },
      3,
    );
    expect(points[1]).toEqual({ lat: 5, lng: 10 });
  });
});

function fakeMap(elevations: Record<string, number | null>): {
  queryTerrainElevation: ReturnType<typeof vi.fn>;
} {
  return {
    queryTerrainElevation: vi.fn(
      (lngLat: { lng: number; lat: number }) =>
        elevations[`${lngLat.lat},${lngLat.lng}`] ?? null,
    ),
  };
}

describe("queryElevationProfile", () => {
  it("queries each point and returns its elevation", () => {
    const map = fakeMap({ "50,14": 320, "51,15": 410 });
    const result = queryElevationProfile(map as any, [
      { lat: 50, lng: 14 },
      { lat: 51, lng: 15 },
    ]);
    expect(result).toEqual([320, 410]);
  });

  it("passes exaggerated: false so the raw (unexaggerated) elevation is returned", () => {
    const map = fakeMap({ "50,14": 320 });
    queryElevationProfile(map as any, [{ lat: 50, lng: 14 }]);
    expect(map.queryTerrainElevation).toHaveBeenCalledWith(
      { lng: 14, lat: 50 },
      { exaggerated: false },
    );
  });

  it("maps a missing DEM tile (null/undefined) to null rather than 0", () => {
    const map = fakeMap({});
    const result = queryElevationProfile(map as any, [{ lat: 0, lng: 0 }]);
    expect(result).toEqual([null]);
  });
});

describe("queryElevationProfileWithRetry", () => {
  it("returns immediately when every point already has data", async () => {
    const map = fakeMap({ "50,14": 320 });
    const result = await queryElevationProfileWithRetry(
      map as any,
      [{ lat: 50, lng: 14 }],
      5,
      1,
    );
    expect(result).toEqual([320]);
    expect(map.queryTerrainElevation).toHaveBeenCalledTimes(1);
  });

  it("retries until a null resolves to a value", async () => {
    let calls = 0;
    const map = {
      queryTerrainElevation: vi.fn(() => {
        calls++;
        return calls < 3 ? null : 250;
      }),
    };
    const result = await queryElevationProfileWithRetry(
      map as any,
      [{ lat: 50, lng: 14 }],
      5,
      1,
    );
    expect(result).toEqual([250]);
  });

  it("gives up after maxRetries and returns remaining nulls", async () => {
    const map = fakeMap({});
    const result = await queryElevationProfileWithRetry(
      map as any,
      [{ lat: 0, lng: 0 }],
      2,
      1,
    );
    expect(result).toEqual([null]);
  });
});

describe("buildFlightPathSamples", () => {
  it("returns a single sample for a single waypoint", () => {
    const samples = buildFlightPathSamples(
      [{ latitude: 50, longitude: 14, height: 30 }],
      5,
    );
    expect(samples).toEqual([
      { lat: 50, lng: 14, height: 30, afterWaypointIndex: 0 },
    ]);
  });

  it("interpolates height alongside position, without duplicating shared endpoints", () => {
    const samples = buildFlightPathSamples(
      [
        { latitude: 50, longitude: 14, height: 30 },
        { latitude: 50, longitude: 14.001, height: 60 },
      ],
      3,
    );
    // 3 samples per segment, 1 segment, no dedup needed (it's the only leg)
    expect(samples).toHaveLength(3);
    expect(samples[0].height).toBe(30);
    expect(samples[1].height).toBe(45);
    expect(samples[2].height).toBe(60);
  });

  it("doesn't duplicate the shared waypoint between two segments", () => {
    const samples = buildFlightPathSamples(
      [
        { latitude: 50, longitude: 14, height: 30 },
        { latitude: 50, longitude: 14.001, height: 60 },
        { latitude: 50, longitude: 14.002, height: 30 },
      ],
      3,
    );
    // 3 per segment × 2 segments − 1 shared midpoint = 5
    expect(samples).toHaveLength(5);
    expect(samples[2].height).toBe(60);
    expect(samples.filter((s) => s.height === 60)).toHaveLength(1);
  });
});

describe("findTerrainCollisions", () => {
  const samples = [
    { lat: 50, lng: 14, height: 30, afterWaypointIndex: 0 },
    { lat: 50, lng: 14.001, height: 30, afterWaypointIndex: 0 },
    { lat: 50, lng: 14.002, height: 30, afterWaypointIndex: 1 },
  ];

  it("is a no-op for aboveGroundLevel mode (the drone follows terrain live)", () => {
    const warnings = findTerrainCollisions(
      samples,
      [100, 200, 100],
      "aboveGroundLevel",
    );
    expect(warnings).toEqual([]);
  });

  it("flags a segment where relative-to-launch height doesn't clear a rising hill", () => {
    // Launch at 100m ground; flying constant 30m above launch = 130m
    // absolute. Ground rises to 125m at sample 1 — only 5m clearance.
    const warnings = findTerrainCollisions(
      samples,
      [100, 125, 100],
      "relativeToStartPoint",
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].afterWaypointIndex).toBe(0);
    expect(warnings[0].shortfallM).toBeCloseTo(MIN_TERRAIN_CLEARANCE_M - 5, 5);
  });

  it("reports no collision when clearance is comfortably above the minimum", () => {
    const warnings = findTerrainCollisions(
      samples,
      [100, 100, 100],
      "relativeToStartPoint",
    );
    expect(warnings).toEqual([]);
  });

  it("compares EGM96 (absolute) height directly against ground elevation", () => {
    const egmSamples = [
      { lat: 50, lng: 14, height: 300, afterWaypointIndex: 0 },
    ];
    const warnings = findTerrainCollisions(egmSamples, [295], "EGM96");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].shortfallM).toBeCloseTo(MIN_TERRAIN_CLEARANCE_M - 5, 5);
  });

  it("skips samples with unknown ground elevation instead of false-flagging them", () => {
    const warnings = findTerrainCollisions(
      samples,
      [100, null, 100],
      "relativeToStartPoint",
    );
    expect(warnings).toEqual([]);
  });

  it("returns no warnings when the launch point's own ground elevation is unknown", () => {
    const warnings = findTerrainCollisions(
      samples,
      [null, 100, 100],
      "relativeToStartPoint",
    );
    expect(warnings).toEqual([]);
  });
});
