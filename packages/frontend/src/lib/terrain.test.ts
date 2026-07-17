import { describe, it, expect, vi } from "vitest";
import {
  interpolatePoints,
  queryElevationProfile,
  queryElevationProfileWithRetry,
  fillMissingElevations,
  buildFlightPathSamples,
  findTerrainCollisions,
  computeTerrainFollowingHeights,
  findMaxAltitudeViolations,
  MIN_TERRAIN_CLEARANCE_M,
} from "./terrain";

describe("fillMissingElevations", () => {
  it("leaves a fully-known array untouched", () => {
    expect(fillMissingElevations([10, 20, 30])).toEqual([10, 20, 30]);
  });

  it("fills an interior null with the nearest preceding known value", () => {
    expect(fillMissingElevations([10, null, 30])).toEqual([10, 10, 30]);
  });

  it("fills leading nulls with the nearest following known value", () => {
    expect(fillMissingElevations([null, null, 30])).toEqual([30, 30, 30]);
  });

  it("fills trailing nulls with the nearest preceding known value", () => {
    expect(fillMissingElevations([10, null, null])).toEqual([10, 10, 10]);
  });

  it("falls back to 0 when every sample is null, rather than throwing", () => {
    expect(fillMissingElevations([null, null])).toEqual([0, 0]);
  });
});

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

describe("computeTerrainFollowingHeights", () => {
  it("is a no-op for aboveGroundLevel mode (the drone already does this live)", () => {
    const heights = computeTerrainFollowingHeights(
      [0, 1, 2],
      [100, 120, 90],
      30,
      "aboveGroundLevel",
    );
    expect(heights).toEqual({});
  });

  it("computes relative-to-launch heights that track rising/falling terrain", () => {
    // Launch ground 100m; terrain rises to 120m then drops to 90m. A
    // constant 30m AGL means: WP0 height 30 (100+30-100), WP1 height 50
    // (120+30-100), WP2 height 20 (90+30-100).
    const heights = computeTerrainFollowingHeights(
      [0, 1, 2],
      [100, 120, 90],
      30,
      "relativeToStartPoint",
    );
    expect(heights).toEqual({ 0: 30, 1: 50, 2: 20 });
  });

  it("computes EGM96 (absolute) heights directly as ground + target AGL", () => {
    const heights = computeTerrainFollowingHeights(
      [0, 1],
      [300, 320],
      30,
      "EGM96",
    );
    expect(heights).toEqual({ 0: 330, 1: 350 });
  });

  it("omits waypoints with unknown ground elevation rather than guessing", () => {
    const heights = computeTerrainFollowingHeights(
      [0, 1, 2],
      [100, null, 90],
      30,
      "relativeToStartPoint",
    );
    expect(heights).toEqual({ 0: 30, 2: 20 });
  });

  it("returns nothing when the launch point's own ground elevation is unknown", () => {
    const heights = computeTerrainFollowingHeights(
      [0, 1],
      [null, 120],
      30,
      "relativeToStartPoint",
    );
    expect(heights).toEqual({});
  });
});

describe("findMaxAltitudeViolations", () => {
  it("checks aboveGroundLevel height directly, no terrain data needed", () => {
    const violations = findMaxAltitudeViolations(
      [
        { index: 0, height: 100 },
        { index: 1, height: 130 },
      ],
      [],
      "aboveGroundLevel",
      120,
    );
    expect(violations).toEqual([{ waypointIndex: 1, excessM: 10 }]);
  });

  it("converts relativeToStartPoint height to true AGL via ground elevation", () => {
    // Launch ground 100m; WP1 height 90 -> absolute 190; ground there 50m
    // -> AGL 140m, 20m over the 120m limit.
    const violations = findMaxAltitudeViolations(
      [
        { index: 0, height: 30 },
        { index: 1, height: 90 },
      ],
      [100, 50],
      "relativeToStartPoint",
      120,
    );
    expect(violations).toEqual([{ waypointIndex: 1, excessM: 20 }]);
  });

  it("compares EGM96 (absolute) height directly against ground elevation", () => {
    const violations = findMaxAltitudeViolations(
      [{ index: 0, height: 450 }],
      [300],
      "EGM96",
      120,
    );
    expect(violations).toEqual([{ waypointIndex: 0, excessM: 30 }]);
  });

  it("returns no violations when every waypoint stays under the limit", () => {
    const violations = findMaxAltitudeViolations(
      [{ index: 0, height: 100 }],
      [],
      "aboveGroundLevel",
      120,
    );
    expect(violations).toEqual([]);
  });

  it("skips waypoints with unknown ground elevation instead of false-flagging them", () => {
    const violations = findMaxAltitudeViolations(
      [
        { index: 0, height: 30 },
        { index: 1, height: 200 },
      ],
      [100, null],
      "relativeToStartPoint",
      120,
    );
    expect(violations).toEqual([]);
  });
});
