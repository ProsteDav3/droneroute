import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  DEFAULT_MISSION_CONFIG,
  DEFAULT_WAYPOINT,
  type Mission,
  type Waypoint,
} from "@droneroute/shared";
import { generateKmzBuffer } from "./kmzGenerator";
import { parseKmz } from "./kmzParser";

function waypoint(index: number, overrides: Partial<Waypoint> = {}): Waypoint {
  return {
    ...DEFAULT_WAYPOINT,
    index,
    name: `WP${index + 1}`,
    latitude: 41.258 + index * 0.001,
    longitude: 0.932,
    ...overrides,
  };
}

function mission(waypoints: Waypoint[], pois: Mission["pois"] = []): Mission {
  return {
    id: "m1",
    name: "Roundtrip test",
    createdAt: "",
    updatedAt: "",
    config: DEFAULT_MISSION_CONFIG,
    waypoints,
    pois,
    obstacles: [],
    buildings: [],
    templateGroups: {},
  };
}

describe("generateKmzBuffer", () => {
  it("packages both files under the native wpmz/ directory with no res/ entry", async () => {
    const buffer = await generateKmzBuffer(mission([waypoint(0), waypoint(1)]));
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files);

    expect(names).toContain("wpmz/template.kml");
    expect(names).toContain("wpmz/waylines.wpml");
    expect(names.some((n) => n.includes("res"))).toBe(false);
    // Nothing at the zip root — the old pre-1.0.6 layout.
    expect(names).not.toContain("template.kml");
    expect(names).not.toContain("waylines.wpml");
  });

  it("round-trips through parseKmz: waypoints, heights, and per-waypoint heading overrides survive", async () => {
    const poi = {
      id: "poi-1",
      name: "Target",
      latitude: 41.26,
      longitude: 0.94,
      height: 15,
    };
    const wps = [
      waypoint(0, {
        height: 42,
        useGlobalHeadingParam: false,
        headingMode: "towardPOI",
        poiId: "poi-1",
      }),
      waypoint(1, { height: 42 }),
    ];
    const buffer = await generateKmzBuffer(mission(wps, [poi]));

    const parsed = await parseKmz(buffer);

    expect(parsed.waypoints).toHaveLength(2);
    expect(parsed.waypoints[0].height).toBe(42);
    expect(parsed.waypoints[0].headingMode).toBe("towardPOI");
    expect(parsed.waypoints[0].useGlobalHeadingParam).toBe(false);
    expect(parsed.waypoints[1].useGlobalHeadingParam).toBe(true);
    // The POI comes back reconstructed from the waypointPoiPoint reference.
    expect(parsed.pois).toHaveLength(1);
    expect(parsed.pois[0].latitude).toBeCloseTo(41.26, 6);
    expect(parsed.pois[0].longitude).toBeCloseTo(0.94, 6);
    expect(parsed.config.droneEnumValue).toBe(
      DEFAULT_MISSION_CONFIG.droneEnumValue,
    );
  });
});
