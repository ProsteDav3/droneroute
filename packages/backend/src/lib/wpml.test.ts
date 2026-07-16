import { describe, it, expect } from "vitest";
import {
  DEFAULT_MISSION_CONFIG,
  DEFAULT_WAYPOINT,
  type Mission,
  type Waypoint,
} from "@droneroute/shared";
import { buildTemplateKml, buildWaylinesWpml } from "./wpml";

function waypoint(overrides: Partial<Waypoint>): Waypoint {
  return {
    ...DEFAULT_WAYPOINT,
    index: 0,
    name: "WP1",
    latitude: 41.258,
    longitude: 0.932,
    ...overrides,
  };
}

function mission(waypoints: Waypoint[], pois: Mission["pois"] = []): Mission {
  return {
    id: "m1",
    name: "Test mission",
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

describe("buildTemplateKml", () => {
  it("emits a per-waypoint heading override for fixed heading mode (regression — Orbit/Turbine/Facade-thermal waypoints held their takeoff heading instead of continuously facing their target, because template.kml only ever overrode towardPOI and silently dropped every other non-global heading mode)", () => {
    const wp = waypoint({
      useGlobalHeadingParam: false,
      headingMode: "fixed",
      headingAngle: 123,
    });
    const kml = buildTemplateKml(mission([wp]));

    expect(kml).toContain(
      "<wpml:waypointHeadingMode>fixed</wpml:waypointHeadingMode>",
    );
    expect(kml).toContain(
      "<wpml:waypointHeadingAngle>123</wpml:waypointHeadingAngle>",
    );
  });

  it("still emits waypointPoiPoint for towardPOI mode (existing behavior, unchanged)", () => {
    const wp = waypoint({
      useGlobalHeadingParam: false,
      headingMode: "towardPOI",
      poiId: "poi-1",
    });
    const kml = buildTemplateKml(
      mission(
        [wp],
        [
          {
            id: "poi-1",
            name: "Target",
            latitude: 41.26,
            longitude: 0.94,
            height: 10,
          },
        ],
      ),
    );

    expect(kml).toContain(
      "<wpml:waypointHeadingMode>towardPOI</wpml:waypointHeadingMode>",
    );
    expect(kml).toContain(
      "<wpml:waypointPoiPoint>41.26,0.94,10</wpml:waypointPoiPoint>",
    );
  });

  it("emits no heading override when the waypoint uses the global heading param", () => {
    const wp = waypoint({
      useGlobalHeadingParam: true,
      headingMode: "fixed",
      headingAngle: 45,
    });
    const kml = buildTemplateKml(mission([wp]));

    expect(kml).not.toContain("<wpml:waypointHeadingParam>");
  });
});

describe("buildWaylinesWpml", () => {
  it("already emits a per-waypoint heading override for fixed mode (existing behavior, unchanged — this file was never affected by the template.kml bug above)", () => {
    const wp = waypoint({
      useGlobalHeadingParam: false,
      headingMode: "fixed",
      headingAngle: 77,
    });
    const wpml = buildWaylinesWpml(mission([wp]));

    expect(wpml).toContain(
      "<wpml:waypointHeadingMode>fixed</wpml:waypointHeadingMode>",
    );
    expect(wpml).toContain(
      "<wpml:waypointHeadingAngle>77</wpml:waypointHeadingAngle>",
    );
  });
});
