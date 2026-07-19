import { describe, it, expect } from "vitest";
import {
  getAirspaceWarnings,
  formatAirspaceWarningMessage,
  getHomeDistanceWarning,
  computeMeasureStats,
  offsetLatLng,
  rotateLatLng,
  haversineDistance,
  mergeBuildingFootprints,
  polygonArea,
  distanceToPolygonBoundaryM,
} from "./geo";

// A simple square zone around [50, 14] .. [50.1, 14.1] (lat, lng).
const SQUARE_ZONE_GEOMETRY: GeoJSON.Geometry = {
  type: "Polygon",
  coordinates: [
    [
      [14, 50],
      [14.1, 50],
      [14.1, 50.1],
      [14, 50.1],
      [14, 50],
    ],
  ],
};

describe("getAirspaceWarnings", () => {
  it("returns no warnings when the route stays entirely outside all zones", () => {
    const waypoints = [
      { latitude: 49, longitude: 13 },
      { latitude: 49.01, longitude: 13.01 },
    ];
    const zones = [
      {
        id: "z1",
        name: "Test zone",
        severity: "restricted" as const,
        geometry: SQUARE_ZONE_GEOMETRY,
        altitudeUpper: 120,
      },
    ];
    expect(getAirspaceWarnings(waypoints, zones)).toEqual([]);
  });

  it("flags a waypoint inside a zone, carrying through the altitude limit", () => {
    const waypoints = [
      { latitude: 50.05, longitude: 14.05 }, // inside the square
    ];
    const zones = [
      {
        id: "z1",
        name: "Test zone",
        severity: "restricted" as const,
        geometry: SQUARE_ZONE_GEOMETRY,
        altitudeUpper: 120,
      },
    ];
    const warnings = getAirspaceWarnings(waypoints, zones);
    expect(warnings).toEqual([
      {
        zoneId: "z1",
        zoneName: "Test zone",
        severity: "restricted",
        type: "inside",
        altitudeUpper: 120,
      },
    ]);
  });

  it("flags a route segment that crosses a zone without any waypoint inside it", () => {
    const waypoints = [
      { latitude: 50.05, longitude: 13.5 }, // west of the square
      { latitude: 50.05, longitude: 14.5 }, // east of the square — segment crosses through
    ];
    const zones = [
      {
        id: "z1",
        name: "Test zone",
        severity: "prohibited" as const,
        geometry: SQUARE_ZONE_GEOMETRY,
        // no altitudeUpper — zone has no stated vertical limit
      },
    ];
    const warnings = getAirspaceWarnings(waypoints, zones);
    expect(warnings).toEqual([
      {
        zoneId: "z1",
        zoneName: "Test zone",
        severity: "prohibited",
        type: "crosses",
        altitudeUpper: undefined,
      },
    ]);
  });

  it("dedupes to one warning per zone even with multiple conflicting waypoints", () => {
    const waypoints = [
      { latitude: 50.02, longitude: 14.02 },
      { latitude: 50.03, longitude: 14.03 },
      { latitude: 50.04, longitude: 14.04 },
    ];
    const zones = [
      {
        id: "z1",
        name: "Test zone",
        severity: "restricted" as const,
        geometry: SQUARE_ZONE_GEOMETRY,
        altitudeUpper: 100,
      },
    ];
    expect(getAirspaceWarnings(waypoints, zones)).toHaveLength(1);
  });
});

describe("formatAirspaceWarningMessage", () => {
  it("includes the altitude limit when present, for a crossing", () => {
    const message = formatAirspaceWarningMessage({
      zoneId: "z1",
      zoneName: "GRID_CTR (GND - 120 m AGL)",
      severity: "restricted",
      type: "crosses",
      altitudeUpper: 120,
    });
    expect(message).toBe(
      "Trasa letu protíná zónu GRID_CTR (GND - 120 m AGL) (limit 120 m AGL)",
    );
  });

  it("notes the absence of an altitude limit when the zone doesn't specify one", () => {
    const message = formatAirspaceWarningMessage({
      zoneId: "z1",
      zoneName: "No-fly area",
      severity: "prohibited",
      type: "inside",
    });
    expect(message).toBe(
      "Trasa letu prochází uvnitř zóny No-fly area (bez uvedeného výškového omezení)",
    );
  });
});

describe("getHomeDistanceWarning", () => {
  it("returns null for fewer than 2 waypoints", () => {
    expect(
      getHomeDistanceWarning([{ latitude: 50, longitude: 14, index: 0 }]),
    ).toBeNull();
  });

  it("returns null when every waypoint is within the threshold", () => {
    const waypoints = [
      { latitude: 50, longitude: 14, index: 0 },
      { latitude: 50.001, longitude: 14, index: 1 },
    ];
    expect(getHomeDistanceWarning(waypoints, 2000)).toBeNull();
  });

  it("flags the farthest waypoint beyond the threshold", () => {
    const waypoints = [
      { latitude: 50, longitude: 14, index: 0 }, // home
      { latitude: 50.01, longitude: 14, index: 1 }, // ~1.1km
      { latitude: 50.03, longitude: 14, index: 2 }, // ~3.3km — farthest
      { latitude: 50.02, longitude: 14, index: 3 }, // ~2.2km
    ];
    const warning = getHomeDistanceWarning(waypoints, 2000);
    expect(warning).not.toBeNull();
    expect(warning!.waypointIndex).toBe(2);
    expect(warning!.distanceM).toBeGreaterThan(3000);
  });

  it("respects a custom threshold", () => {
    const waypoints = [
      { latitude: 50, longitude: 14, index: 0 },
      { latitude: 50.001, longitude: 14, index: 1 }, // ~111m
    ];
    expect(getHomeDistanceWarning(waypoints, 50)).not.toBeNull();
    expect(getHomeDistanceWarning(waypoints, 200)).toBeNull();
  });
});

describe("computeMeasureStats", () => {
  it("returns zero distance and null area for a single point", () => {
    const stats = computeMeasureStats([[50, 14]]);
    expect(stats.totalDistanceM).toBe(0);
    expect(stats.areaM2).toBeNull();
  });

  it("sums leg distances for a two-point path, with no area", () => {
    const stats = computeMeasureStats([
      [50, 14],
      [50.001, 14],
    ]);
    expect(stats.totalDistanceM).toBeGreaterThan(100);
    expect(stats.totalDistanceM).toBeLessThan(120);
    expect(stats.areaM2).toBeNull();
  });

  it("reports the enclosed area once there are 3+ points", () => {
    const stats = computeMeasureStats([
      [50, 14],
      [50, 14.01],
      [50.01, 14.01],
    ]);
    expect(stats.areaM2).not.toBeNull();
    expect(stats.areaM2!).toBeGreaterThan(0);
  });

  it("accumulates distance across multiple legs, not just point-to-point", () => {
    const twoLeg = computeMeasureStats([
      [50, 14],
      [50.001, 14],
      [50.001, 14.001],
    ]);
    const directPoints = computeMeasureStats([
      [50, 14],
      [50.001, 14.001],
    ]);
    expect(twoLeg.totalDistanceM).toBeGreaterThan(directPoints.totalDistanceM);
  });
});

describe("offsetLatLng", () => {
  it("returns the same point for a zero offset", () => {
    expect(offsetLatLng(50, 14, 0, 0)).toEqual([50, 14]);
  });

  it("moving north increases latitude, moving east increases longitude", () => {
    const [lat, lng] = offsetLatLng(50, 14, 100, 100);
    expect(lat).toBeGreaterThan(50);
    expect(lng).toBeGreaterThan(14);
  });

  it("the resulting point is actually ~100m away for a 100m offset", () => {
    const [lat, lng] = offsetLatLng(50, 14, 100, 0);
    expect(haversineDistance(50, 14, lat, lng)).toBeCloseTo(100, 0);
  });
});

describe("rotateLatLng", () => {
  it("returns the same point for a zero rotation", () => {
    expect(rotateLatLng(50.001, 14.001, 50, 14, 0)).toEqual([50.001, 14.001]);
  });

  it("rotating the center point around itself is a no-op", () => {
    const [lat, lng] = rotateLatLng(50, 14, 50, 14, 90);
    expect(lat).toBeCloseTo(50, 9);
    expect(lng).toBeCloseTo(14, 9);
  });

  it("preserves distance from the center (rotation, not scaling)", () => {
    const centerLat = 50;
    const centerLng = 14;
    const [origLat, origLng] = offsetLatLng(centerLat, centerLng, 200, 0);
    const distBefore = haversineDistance(
      centerLat,
      centerLng,
      origLat,
      origLng,
    );

    const [rotLat, rotLng] = rotateLatLng(
      origLat,
      origLng,
      centerLat,
      centerLng,
      90,
    );
    const distAfter = haversineDistance(centerLat, centerLng, rotLat, rotLng);

    expect(distAfter).toBeCloseTo(distBefore, 0);
  });

  it("a 90° rotation moves a point due north of center to due east", () => {
    const centerLat = 50;
    const centerLng = 14;
    const [northLat, northLng] = offsetLatLng(centerLat, centerLng, 200, 0);

    const [rotLat, rotLng] = rotateLatLng(
      northLat,
      northLng,
      centerLat,
      centerLng,
      90,
    );

    // Rotated point should now sit east of center, at roughly the same
    // latitude as the center (not north of it anymore).
    expect(rotLng).toBeGreaterThan(centerLng);
    expect(Math.abs(rotLat - centerLat)).toBeLessThan(
      Math.abs(northLat - centerLat),
    );
  });
});

describe("mergeBuildingFootprints", () => {
  // ~11m squares (0.0001° ≈ 11.1m at the equator) — building-sized, not the
  // huge whole-degree footprints that would make the equirectangular area
  // approximation noisy.
  const D = 0.0001;
  const west: [number, number][] = [
    [0, 0],
    [0, D],
    [D, D],
    [D, 0],
  ];
  const east: [number, number][] = [
    [0, D],
    [0, 2 * D],
    [D, 2 * D],
    [D, D],
  ];

  it("merges two footprints sharing an edge into one clean rectangle", () => {
    const merged = mergeBuildingFootprints([
      { height: 20, vertices: west },
      { height: 20, vertices: east },
    ]);

    // The shared edge collapses away — a real union, not a concatenation
    // of both rings.
    expect(merged.vertices).toHaveLength(4);

    const mergedArea = polygonArea(merged.vertices);
    const expectedArea = polygonArea(west) + polygonArea(east);
    expect(Math.abs(mergedArea - expectedArea) / expectedArea).toBeLessThan(
      0.01,
    );
  });

  it("uses the tallest fragment's height", () => {
    const merged = mergeBuildingFootprints([
      { height: 12, vertices: west },
      { height: 34, vertices: east },
    ]);
    expect(merged.height).toBe(34);
  });

  it("defaults to 20m when no fragment has a known height", () => {
    const merged = mergeBuildingFootprints([
      { height: null, vertices: west },
      { height: null, vertices: east },
    ]);
    expect(merged.height).toBe(20);
  });

  it("keeps the largest piece when the selected fragments don't actually touch", () => {
    const tiny: [number, number][] = [
      [0, 0],
      [0, D / 10],
      [D / 10, D / 10],
      [D / 10, 0],
    ];
    const farAway: [number, number][] = [
      [1, 1],
      [1, 1 + D],
      [1 + D, 1 + D],
      [1 + D, 1],
    ];

    const merged = mergeBuildingFootprints([
      { height: 10, vertices: tiny },
      { height: 10, vertices: farAway },
    ]);

    const mergedArea = polygonArea(merged.vertices);
    const farAwayArea = polygonArea(farAway);
    expect(Math.abs(mergedArea - farAwayArea) / farAwayArea).toBeLessThan(
      0.001,
    );
  });
});

describe("distanceToPolygonBoundaryM", () => {
  // A 40m (north-south) x 10m (east-west) rectangle centered on [50, 14] —
  // an elongated footprint, the exact shape where a single orbit radius
  // measured from the center under- or over-estimates the real distance to
  // the nearest edge depending on which side you're standing on.
  const center = 50;
  const centerLng = 14;
  const rectangle: [number, number][] = [
    offsetLatLng(center, centerLng, -20, -5),
    offsetLatLng(center, centerLng, -20, 5),
    offsetLatLng(center, centerLng, 20, 5),
    offsetLatLng(center, centerLng, 20, -5),
  ];

  it("returns the distance to the nearest edge, not the centroid", () => {
    // Standing 15m due east of center: nearest edge (the long east side,
    // 5m from center) is 10m away — not haversineDistance-to-center (15m).
    const point = offsetLatLng(center, centerLng, 0, 20);
    const dist = distanceToPolygonBoundaryM(point, rectangle);
    expect(dist).toBeCloseTo(15, 0);
  });

  it("varies a lot around a constant-radius circle for an elongated footprint — exactly why a single flat radius under/overshoots depending on bearing", () => {
    // Two points at the same 25m radius from the rectangle's center: due
    // north sits near the short (tip) edge, only 20m out from center, so
    // the real gap is small. Due east sits opposite the long edge, just 5m
    // out from center, so the real gap is much bigger.
    const eastPoint = offsetLatLng(center, centerLng, 0, 25);
    const northPoint = offsetLatLng(center, centerLng, 25, 0);
    const eastDist = distanceToPolygonBoundaryM(eastPoint, rectangle);
    const northDist = distanceToPolygonBoundaryM(northPoint, rectangle);
    expect(northDist).toBeLessThan(eastDist);
    expect(northDist).toBeCloseTo(5, 0);
    expect(eastDist).toBeCloseTo(20, 0);
  });

  it("returns Infinity for a degenerate (fewer than 2 vertices) polygon", () => {
    expect(distanceToPolygonBoundaryM([50, 14], [])).toBe(Infinity);
    expect(distanceToPolygonBoundaryM([50, 14], [[50, 14]])).toBe(Infinity);
  });
});
