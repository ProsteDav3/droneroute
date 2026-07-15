import { describe, it, expect } from "vitest";
import { DEFAULT_WAYPOINT } from "@droneroute/shared";
import type { Waypoint, WaypointAction } from "@droneroute/shared";
import {
  buildPhotogrammetryExportRows,
  generatePhotogrammetryCsv,
} from "./photogrammetryExport";

function wp(
  index: number,
  lat: number,
  lng: number,
  overrides: Partial<Waypoint> = {},
): Waypoint {
  return {
    ...DEFAULT_WAYPOINT,
    index,
    name: `WP${index}`,
    latitude: lat,
    longitude: lng,
    ...overrides,
  };
}

const takePhoto: WaypointAction = {
  actionId: 0,
  actionType: "takePhoto",
  params: { payloadPositionIndex: 0 },
};

describe("buildPhotogrammetryExportRows", () => {
  it("returns one row per takePhoto action, in flight order", () => {
    const waypoints = [
      wp(0, 50.06, 14.43, { height: 80, actions: [takePhoto] }),
      wp(1, 50.061, 14.431, { height: 80, actions: [] }),
      wp(2, 50.062, 14.432, { height: 80, actions: [takePhoto] }),
    ];
    const rows = buildPhotogrammetryExportRows(waypoints);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      name: "photo_0001",
      latitude: 50.06,
      longitude: 14.43,
      altitude: 80,
    });
    expect(rows[1]).toEqual({
      name: "photo_0002",
      latitude: 50.062,
      longitude: 14.432,
      altitude: 80,
    });
  });

  it("counts multiple takePhoto actions on the same waypoint as separate rows", () => {
    const waypoints = [
      wp(0, 50.06, 14.43, { actions: [takePhoto, takePhoto] }),
    ];
    const rows = buildPhotogrammetryExportRows(waypoints);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("photo_0001");
    expect(rows[1].name).toBe("photo_0002");
  });

  it("returns no rows when no waypoint has a takePhoto action (e.g. video capture mode)", () => {
    const waypoints = [
      wp(0, 50.06, 14.43, {
        actions: [
          {
            actionId: 0,
            actionType: "startRecord",
            params: { payloadPositionIndex: 0 },
          },
        ],
      }),
      wp(1, 50.061, 14.431, {
        actions: [
          {
            actionId: 0,
            actionType: "stopRecord",
            params: { payloadPositionIndex: 0 },
          },
        ],
      }),
    ];
    expect(buildPhotogrammetryExportRows(waypoints)).toEqual([]);
  });

  it("pads the sequence number to 4 digits", () => {
    const waypoints = Array.from({ length: 12 }, (_, i) =>
      wp(i, 50.06 + i * 0.0001, 14.43, { actions: [takePhoto] }),
    );
    const rows = buildPhotogrammetryExportRows(waypoints);
    expect(rows[9].name).toBe("photo_0010");
  });
});

describe("generatePhotogrammetryCsv", () => {
  it("produces a header row plus one data row per photo, CRLF-terminated", () => {
    const waypoints = [
      wp(0, 50.06, 14.43, { height: 80, actions: [takePhoto] }),
    ];
    const csv = generatePhotogrammetryCsv(waypoints);
    const lines = csv.split("\r\n");

    expect(lines[0]).toBe("Name,Latitude,Longitude,Altitude(m)");
    expect(lines[1]).toBe("photo_0001,50.06000000,14.43000000,80.00");
    // Trailing CRLF leaves one empty element after split.
    expect(lines[lines.length - 1]).toBe("");
  });

  it("produces just the header when there are no photo waypoints", () => {
    const csv = generatePhotogrammetryCsv([wp(0, 50.06, 14.43)]);
    expect(csv).toBe("Name,Latitude,Longitude,Altitude(m)\r\n");
  });
});
