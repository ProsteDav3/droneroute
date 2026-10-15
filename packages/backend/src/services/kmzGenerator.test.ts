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
        gimbalPitchAngle: -35,
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
    expect(parsed.waypoints[0].gimbalPitchAngle).toBe(-35);
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

describe("manual camera control survives a KMZ round trip", () => {
  it("re-imports a manual-control export as manual, not as an auto mission", async () => {
    // Without this the round trip (export → re-import → export) would quietly
    // hand the aiming back to the aircraft: the second export would see
    // cameraControl absent and write the plan's own heading/gimbal again.
    const m = mission([waypoint(0), waypoint(1)]);
    m.config = { ...m.config, cameraControl: "manual" };

    const parsed = await parseKmz(await generateKmzBuffer(m));

    expect(parsed.config.cameraControl).toBe("manual");
    expect(parsed.config.gimbalPitchMode).toBe("manual");
    expect(parsed.config.globalHeadingMode).toBe("manually");
  });

  it("re-imports a normal export as auto", async () => {
    const parsed = await parseKmz(
      await generateKmzBuffer(mission([waypoint(0), waypoint(1)])),
    );
    expect(parsed.config.cameraControl).toBe("auto");
  });
});

describe("waypoint actions survive a KMZ round trip", () => {
  // The camera setup an orbit puts on its first waypoint. Field-observed on a
  // Matrice 4T over the Congress Centre: a video orbit imported back into
  // SkyRoute, switched to photo and uploaded flew with the gimbal level (0°
  // instead of -17°), a 5 s hover instead of 3 s and area focus with no area
  // — every value the export falls back to when it can't read a parameter —
  // and the aircraft stopped facing the POI for the whole flight.
  const cameraSetup = [
    {
      actionId: 0,
      actionType: "gimbalRotate" as const,
      params: {
        gimbalRotateMode: "absoluteAngle" as const,
        gimbalPitchRotateAngle: -17,
        gimbalYawRotateAngle: 0,
        gimbalRollRotateAngle: 0,
        payloadPositionIndex: 0,
      },
    },
    { actionId: 1, actionType: "hover" as const, params: { hoverTime: 3 } },
    {
      actionId: 2,
      actionType: "focus" as const,
      params: {
        isPointFocus: true,
        focusX: 0.5,
        focusY: 0.5,
        isInfiniteFocus: false,
      },
    },
    {
      actionId: 3,
      actionType: "startRecord" as const,
      params: { payloadPositionIndex: 0, fileSuffix: "" },
    },
  ];

  it("reads action parameters back under their own names and types", async () => {
    const m = mission([waypoint(0, { actions: cameraSetup }), waypoint(1)]);

    const parsed = await parseKmz(await generateKmzBuffer(m));
    const byType = (type: string) =>
      parsed.waypoints[0].actions.find((a) => a.actionType === type)!.params;

    expect(byType("gimbalRotate")).toMatchObject({
      gimbalRotateMode: "absoluteAngle",
      gimbalPitchRotateAngle: -17,
      gimbalYawRotateEnable: false,
      payloadPositionIndex: 0,
    });
    expect(byType("hover")).toEqual({ hoverTime: 3 });
    expect(byType("focus")).toMatchObject({
      isPointFocus: true,
      focusX: 0.5,
      focusY: 0.5,
      isInfiniteFocus: false,
    });
    expect(byType("startRecord")).toMatchObject({
      payloadPositionIndex: 0,
      fileSuffix: "",
    });
    for (const action of parsed.waypoints[0].actions) {
      expect(
        Object.keys(action.params).filter((k) => k.startsWith("wpml:")),
      ).toEqual([]);
    }
  });

  it("re-exports an imported mission with the same camera setup it came in with", async () => {
    const original = mission([
      waypoint(0, { actions: cameraSetup }),
      waypoint(1),
    ]);
    const firstExport = await generateKmzBuffer(original);

    const parsed = await parseKmz(firstExport);
    const secondExport = await generateKmzBuffer(
      mission(parsed.waypoints, parsed.pois),
    );

    const wpml = async (buf: Buffer) =>
      (await JSZip.loadAsync(buf)).file("wpmz/waylines.wpml")!.async("string");
    const xml = await wpml(secondExport);
    expect(xml).toContain(
      "<wpml:gimbalPitchRotateAngle>-17</wpml:gimbalPitchRotateAngle>",
    );
    expect(xml).toContain("<wpml:hoverTime>3</wpml:hoverTime>");
    expect(xml).toContain("<wpml:isPointFocus>1</wpml:isPointFocus>");
    const actionsOf = (s: string) =>
      s.match(/<wpml:actionGroup>[\s\S]*?<\/wpml:actionGroup>/g);
    expect(actionsOf(xml)).toEqual(actionsOf(await wpml(firstExport)));
  });

  it("keeps a numeric-looking file suffix as text", async () => {
    const m = mission([
      waypoint(0, {
        actions: [
          {
            actionId: 0,
            actionType: "takePhoto",
            params: { payloadPositionIndex: 0, fileSuffix: "2026" },
          },
        ],
      }),
      waypoint(1),
    ]);

    const parsed = await parseKmz(await generateKmzBuffer(m));

    expect(parsed.waypoints[0].actions[0].params).toMatchObject({
      fileSuffix: "2026",
    });
  });
});
