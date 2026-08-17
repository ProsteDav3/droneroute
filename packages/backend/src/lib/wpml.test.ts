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

  it("writes waypointHeadingAngle 0 (not the computed bearing) for towardPOI in template.kml — a non-zero angle there breaks POI tracking on the Matrice 4T", () => {
    // Field result, five variants of one orbit flown back to back on an M4T:
    // towardPOI with the real bearing written into template.kml's
    // waypointHeadingAngle -> aircraft never turned to the POI (identical to
    // the originally reported flight). Same file with that angle forced to 0
    // -> aircraft tracked the POI, and the per-waypoint gimbal pitch was
    // honoured too. Pilot 2 regenerates waylines.wpml from template.kml on
    // download from the cloud, and a non-zero angle beside towardPOI is
    // enough to derail it. The angle is meaningless in that mode anyway
    // (spec: it is only read for smoothTransition), so 0 loses nothing.
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
    const block =
      /<wpml:waypointHeadingParam>[\s\S]*?<\/wpml:waypointHeadingParam>/.exec(
        kml.slice(kml.indexOf("<Placemark>")),
      )![0];
    expect(block).toContain(
      "<wpml:waypointHeadingMode>towardPOI</wpml:waypointHeadingMode>",
    );
    expect(block).toContain(
      "<wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle>",
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
    // Every thermal-capable payload in DRONE_MODELS: H20T, M30T, H20N,
    // M3T, M3TD, H30T, Matrice 4T.
    for (const payloadEnumValue of [43, 53, 61, 67, 81, 83, 89]) {
      const thermal = mission([wp]);
      thermal.config = { ...thermal.config, payloadEnumValue };
      expect(buildTemplateKml(thermal)).toContain(
        "<wpml:imageFormat>visable,ir</wpml:imageFormat>",
      );
    }

    const rgb = mission([wp]);
    rgb.config = { ...rgb.config, payloadEnumValue: 66 }; // M3E camera
    expect(buildTemplateKml(rgb)).toContain(
      "<wpml:imageFormat>visable</wpml:imageFormat>",
    );
  });
});

describe("manual camera control (the pilot aims, the aircraft only flies)", () => {
  function manualMission(waypoints: Waypoint[], pois: Mission["pois"] = []) {
    const m = mission(waypoints, pois);
    m.config = { ...m.config, cameraControl: "manual" };
    return m;
  }

  const aimedWaypoint = waypoint({
    useGlobalHeadingParam: false,
    headingMode: "towardPOI",
    poiId: "poi-1",
    gimbalPitchAngle: -35,
    actions: [
      {
        actionId: 0,
        actionType: "gimbalRotate",
        params: { gimbalPitchRotateAngle: -35 },
      },
      {
        actionId: 1,
        actionType: "gimbalEvenlyRotate",
        params: { gimbalPitchRotateAngle: -20 },
      },
      { actionId: 2, actionType: "rotateYaw", params: { aircraftHeading: 90 } },
      { actionId: 3, actionType: "takePhoto", params: {} },
      { actionId: 4, actionType: "hover", params: { hoverTime: 3 } },
    ],
  } as Partial<Waypoint>);
  const pois: Mission["pois"] = [
    {
      id: "poi-1",
      name: "Target",
      latitude: 41.26,
      longitude: 0.94,
      height: 10,
    },
  ];

  it("hands the gimbal to the pilot in both files", () => {
    const m = manualMission([aimedWaypoint], pois);
    expect(buildTemplateKml(m)).toContain(
      "<wpml:gimbalPitchMode>manual</wpml:gimbalPitchMode>",
    );
  });

  it("flies every waypoint on the global 'manually' heading, dropping POI tracking", () => {
    const m = manualMission([aimedWaypoint], pois);
    const kml = buildTemplateKml(m);
    const wpml = buildWaylinesWpml(m);

    expect(kml).toContain(
      "<wpml:waypointHeadingMode>manually</wpml:waypointHeadingMode>",
    );
    expect(kml).not.toContain("towardPOI");
    expect(wpml).toContain(
      "<wpml:waypointHeadingMode>manually</wpml:waypointHeadingMode>",
    );
    expect(wpml).not.toContain("towardPOI");
    // No stale POI target left behind for the aircraft to snap to.
    expect(kml).not.toContain("41.26,0.94,10");
    expect(wpml).not.toContain("41.26,0.94,10");
  });

  it("strips gimbal and yaw actions but keeps what the flight is for", () => {
    const wpml = buildWaylinesWpml(manualMission([aimedWaypoint], pois));
    for (const stripped of [
      "gimbalRotate",
      "gimbalEvenlyRotate",
      "rotateYaw",
    ]) {
      expect(wpml).not.toContain(
        `<wpml:actionActuatorFunc>${stripped}</wpml:actionActuatorFunc>`,
      );
    }
    expect(wpml).toContain(
      "<wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>",
    );
    expect(wpml).toContain(
      "<wpml:actionActuatorFunc>hover</wpml:actionActuatorFunc>",
    );
  });

  it("zeroes the planned per-waypoint gimbal pitch so nothing fights the pilot's stick", () => {
    const wpml = buildWaylinesWpml(manualMission([aimedWaypoint], pois));
    expect(wpml).toContain(
      "<wpml:waypointGimbalPitchAngle>0</wpml:waypointGimbalPitchAngle>",
    );
    expect(wpml).not.toContain(
      "<wpml:waypointGimbalPitchAngle>-35</wpml:waypointGimbalPitchAngle>",
    );
  });

  it("leaves an auto mission (and a mission saved before the setting existed) exactly as it was", () => {
    const auto = mission([aimedWaypoint], pois);
    const legacy = mission([aimedWaypoint], pois);
    // Older saved missions have no cameraControl at all.
    legacy.config = { ...legacy.config, cameraControl: undefined };

    for (const m of [auto, legacy]) {
      const wpml = buildWaylinesWpml(m);
      expect(wpml).toContain(
        "<wpml:waypointHeadingMode>towardPOI</wpml:waypointHeadingMode>",
      );
      expect(wpml).toContain(
        "<wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>",
      );
      expect(wpml).toContain(
        "<wpml:waypointGimbalPitchAngle>-35</wpml:waypointGimbalPitchAngle>",
      );
    }
  });
});

describe("gimbalEvenlyRotate needs its own betweenAdjacentPoints group", () => {
  // In WPML a gimbal interpolation is not something that happens ON a
  // waypoint — it happens along the leg to the next one, so it belongs to an
  // action group triggered `betweenAdjacentPoints` and spanning i → i+1.
  // Filed under the same reachPoint group as the recording actions it simply
  // does not run, which is what the field test saw as "the gimbal never
  // moved" (verified on a Matrice 4T: same file plus this group = correct
  // tilt for the whole flight).
  const wp0 = waypoint({
    index: 0,
    gimbalPitchAngle: -13,
    actions: [
      { actionId: 0, actionType: "startRecord", params: {} },
      {
        actionId: 1,
        actionType: "gimbalRotate",
        params: { gimbalPitchRotateAngle: -13 },
      },
      {
        actionId: 2,
        actionType: "gimbalEvenlyRotate",
        params: { gimbalPitchRotateAngle: -11 },
      },
    ],
  } as Partial<Waypoint>);
  const wp1 = waypoint({
    index: 1,
    name: "WP2",
    latitude: 41.259,
    gimbalPitchAngle: -11,
    actions: [{ actionId: 0, actionType: "stopRecord", params: {} }],
  } as Partial<Waypoint>);

  const groups = (xml: string) =>
    [...xml.matchAll(/<wpml:actionGroup>([\s\S]*?)<\/wpml:actionGroup>/g)].map(
      (m) => m[1],
    );
  const field = (xml: string, name: string) =>
    new RegExp(`<wpml:${name}>([^<]*)</wpml:${name}>`).exec(xml)?.[1] ?? null;

  for (const [label, build] of [
    ["template.kml", buildTemplateKml],
    ["waylines.wpml", buildWaylinesWpml],
  ] as const) {
    it(`splits the groups by trigger in ${label}`, () => {
      const xml = build(mission([wp0, wp1]));
      const gs = groups(xml);
      const evenly = gs.filter((g) => g.includes("gimbalEvenlyRotate"));
      const reach = gs.filter((g) => !g.includes("gimbalEvenlyRotate"));

      expect(evenly).toHaveLength(1);
      expect(field(evenly[0], "actionTriggerType")).toBe(
        "betweenAdjacentPoints",
      );
      // Spans this waypoint and the next — that is the leg the gimbal moves
      // along.
      expect(field(evenly[0], "actionGroupStartIndex")).toBe("0");
      expect(field(evenly[0], "actionGroupEndIndex")).toBe("1");
      // The interpolation group carries nothing else.
      expect(evenly[0]).not.toContain("startRecord");
      expect(evenly[0]).not.toContain("gimbalRotate</wpml:actionActuatorFunc>");

      // Everything that happens AT a waypoint keeps its reachPoint group.
      expect(reach.some((g) => g.includes("startRecord"))).toBe(true);
      expect(reach.some((g) => g.includes("stopRecord"))).toBe(true);
      for (const g of reach) {
        expect(field(g, "actionTriggerType")).toBe("reachPoint");
      }
    });
  }

  it("gives every action group a distinct id", () => {
    const xml = buildWaylinesWpml(mission([wp0, wp1]));
    const ids = [
      ...xml.matchAll(/<wpml:actionGroupId>([^<]*)<\/wpml:actionGroupId>/g),
    ].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("drops a trailing interpolation that has no next waypoint to reach", () => {
    const lonely = waypoint({
      index: 0,
      actions: [
        {
          actionId: 0,
          actionType: "gimbalEvenlyRotate",
          params: { gimbalPitchRotateAngle: -20 },
        },
      ],
    } as Partial<Waypoint>);
    const xml = buildWaylinesWpml(mission([lonely]));
    expect(xml).not.toContain("betweenAdjacentPoints");
    expect(xml).not.toContain("gimbalEvenlyRotate");
  });
});

describe("gimbal yaw is opt-in (a yaw command fights target tracking)", () => {
  const rotateAt = (params: Record<string, unknown>) =>
    mission([
      waypoint({
        actions: [{ actionId: 0, actionType: "gimbalRotate", params }],
      } as Partial<Waypoint>),
    ]);

  it("leaves yaw disabled when the action only asks for a pitch", () => {
    // What an orbit emits. A yaw command is absolute (relative to north), so
    // enabling it here held the camera at a fixed compass direction while the
    // aircraft turned toward the POI: the subject was framed at the start of
    // the flight and drifted out of shot for the rest of it (field-observed
    // on a Matrice 4T; the flight-verified file has this at 0).
    const xml = buildWaylinesWpml(rotateAt({ gimbalPitchRotateAngle: -28 }));
    expect(xml).toContain(
      "<wpml:gimbalYawRotateEnable>0</wpml:gimbalYawRotateEnable>",
    );
    expect(xml).toContain(
      "<wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>",
    );
  });

  it("still leaves it disabled when a yaw angle is present but not asked for", () => {
    // The action editor always carries a yaw field, defaulting to 0 —
    // its presence must not be read as a request to command yaw.
    const xml = buildWaylinesWpml(
      rotateAt({ gimbalPitchRotateAngle: -28, gimbalYawRotateAngle: 0 }),
    );
    expect(xml).toContain(
      "<wpml:gimbalYawRotateEnable>0</wpml:gimbalYawRotateEnable>",
    );
  });

  it("commands yaw when it is explicitly enabled", () => {
    const xml = buildWaylinesWpml(
      rotateAt({
        gimbalPitchRotateAngle: -20,
        gimbalYawRotateAngle: 90,
        gimbalYawRotateEnable: true,
      }),
    );
    expect(xml).toContain(
      "<wpml:gimbalYawRotateEnable>1</wpml:gimbalYawRotateEnable>",
    );
    expect(xml).toContain(
      "<wpml:gimbalYawRotateAngle>90</wpml:gimbalYawRotateAngle>",
    );
  });
});
