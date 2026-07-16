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

  it("emits no heading override for towardPOI mode when the referenced POI can't be found", () => {
    const wp = waypoint({
      useGlobalHeadingParam: false,
      headingMode: "towardPOI",
      poiId: "missing-poi",
    });
    const kml = buildTemplateKml(mission([wp], []));

    expect(kml).not.toContain("<wpml:waypointHeadingParam>");
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

  it("falls back to the global heading mode (never a zeroed POI target) when a waypoint's towardPOI target can't be resolved", () => {
    const wp = waypoint({
      useGlobalHeadingParam: false,
      headingMode: "towardPOI",
      poiId: "missing-poi",
    });
    const wpml = buildWaylinesWpml(mission([wp], []));

    // DEFAULT_MISSION_CONFIG's global mode is followWayline — the waypoint
    // must inherit it rather than aim at 0,0.
    expect(wpml).toContain(
      "<wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>",
    );
    expect(wpml).not.toContain(
      "<wpml:waypointHeadingMode>towardPOI</wpml:waypointHeadingMode>",
    );
  });
});

describe("WPML 1.0.6 native format (Pilot 2 cloud-download compatibility)", () => {
  const wp = waypoint({});
  const m = mission([wp]);

  it("declares the 1.0.6 namespace in both files", () => {
    expect(buildTemplateKml(m)).toContain("http://www.dji.com/wpmz/1.0.6");
    expect(buildWaylinesWpml(m)).toContain("http://www.dji.com/wpmz/1.0.6");
  });

  it("includes waylineAvoidLimitAreaMode in both files' missionConfig", () => {
    for (const xml of [buildTemplateKml(m), buildWaylinesWpml(m)]) {
      expect(xml).toContain(
        "<wpml:waylineAvoidLimitAreaMode>0</wpml:waylineAvoidLimitAreaMode>",
      );
    }
  });

  it("template carries the new required folder fields", () => {
    const kml = buildTemplateKml(m);
    expect(kml).toContain("<wpml:positioningType>GPS</wpml:positioningType>");
    expect(kml).toContain(
      `<wpml:globalHeight>${wp.height}</wpml:globalHeight>`,
    );
    expect(kml).toContain("<wpml:caliFlightEnable>0</wpml:caliFlightEnable>");
    expect(kml).toContain(
      "<wpml:globalUseStraightLine>0</wpml:globalUseStraightLine>",
    );
    expect(kml).toContain("<wpml:isRisky>0</wpml:isRisky>");
    expect(kml).toContain("<wpml:payloadParam>");
  });

  it("waylines carries the new required folder and waypoint fields", () => {
    const wpml = buildWaylinesWpml(m);
    expect(wpml).toContain("<wpml:waylineId>0</wpml:waylineId>");
    expect(wpml).toContain("<wpml:distance>");
    expect(wpml).toContain("<wpml:duration>");
    expect(wpml).toContain(
      "<wpml:realTimeFollowSurfaceByFov>0</wpml:realTimeFollowSurfaceByFov>",
    );
    expect(wpml).toContain("<wpml:waypointGimbalHeadingParam>");
    expect(wpml).toContain(
      `<wpml:waypointGimbalPitchAngle>${wp.gimbalPitchAngle}</wpml:waypointGimbalPitchAngle>`,
    );
    expect(wpml).toContain("<wpml:waypointWorkType>0</wpml:waypointWorkType>");
    expect(wpml).toContain("<wpml:waypointHeadingAngleEnable>");
  });

  it("maps heightMode to a valid executeHeightMode (AGL stays relative — never silently enables terrain following)", () => {
    const agl = mission([wp]);
    agl.config = { ...agl.config, heightMode: "aboveGroundLevel" };
    expect(buildWaylinesWpml(agl)).toContain(
      "<wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>",
    );

    const egm = mission([wp]);
    egm.config = { ...egm.config, heightMode: "EGM96" };
    expect(buildWaylinesWpml(egm)).toContain(
      "<wpml:executeHeightMode>WGS84</wpml:executeHeightMode>",
    );
  });

  it("sets waypointHeadingAngleEnable=1 only for explicit-angle modes", () => {
    const fixed = mission([
      waypoint({
        useGlobalHeadingParam: false,
        headingMode: "fixed",
        headingAngle: 90,
      }),
    ]);
    expect(buildWaylinesWpml(fixed)).toContain(
      "<wpml:waypointHeadingAngleEnable>1</wpml:waypointHeadingAngleEnable>",
    );

    const follow = mission([waypoint({})]); // global followWayline
    expect(buildWaylinesWpml(follow)).toContain(
      "<wpml:waypointHeadingAngleEnable>0</wpml:waypointHeadingAngleEnable>",
    );
  });

  it("emits imageFormat visable,ir for thermal payloads and visable otherwise", () => {
    const thermal = mission([wp]); // DEFAULT config = Matrice 4T (payload 89)
    expect(buildTemplateKml(thermal)).toContain(
      "<wpml:imageFormat>visable,ir</wpml:imageFormat>",
    );

    const rgb = mission([wp]);
    rgb.config = { ...rgb.config, payloadEnumValue: 66 }; // M3E camera
    expect(buildTemplateKml(rgb)).toContain(
      "<wpml:imageFormat>visable</wpml:imageFormat>",
    );
  });
});
