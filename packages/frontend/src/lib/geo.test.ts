import { describe, it, expect } from "vitest";
import {
  getAirspaceWarnings,
  formatAirspaceWarningMessage,
  getHomeDistanceWarning,
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
