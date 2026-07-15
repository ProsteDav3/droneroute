import { describe, it, expect } from "vitest";
import { DEFAULT_MISSION_CONFIG, DEFAULT_WAYPOINT } from "@droneroute/shared";
import type { Waypoint } from "@droneroute/shared";
import { generateMissionReportPdf } from "./pdfReport";

function wp(index: number, lat: number, lng: number): Waypoint {
  return {
    ...DEFAULT_WAYPOINT,
    index,
    name: `WP${index}`,
    latitude: lat,
    longitude: lng,
  };
}

describe("generateMissionReportPdf", () => {
  it("generates a non-empty PDF for a simple mission", () => {
    const doc = generateMissionReportPdf({
      missionName: "Test mise",
      config: DEFAULT_MISSION_CONFIG,
      waypoints: [wp(0, 50.06, 14.43), wp(1, 50.061, 14.431)],
      unitSystem: "metric",
    });

    const blob = doc.output("blob");
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe("application/pdf");
  });

  it("does not throw for a mission with no waypoints or an unrecognized drone", () => {
    expect(() =>
      generateMissionReportPdf({
        missionName: "Prázdná mise",
        config: {
          ...DEFAULT_MISSION_CONFIG,
          droneEnumValue: 999,
          droneSubEnumValue: 0,
        },
        waypoints: [],
        unitSystem: "imperial",
      }),
    ).not.toThrow();
  });

  it("truncates the waypoint table for very dense missions instead of failing", () => {
    const waypoints = Array.from({ length: 250 }, (_, i) =>
      wp(i, 50.06 + i * 0.0001, 14.43),
    );
    const doc = generateMissionReportPdf({
      missionName: "Hustý grid",
      config: DEFAULT_MISSION_CONFIG,
      waypoints,
      unitSystem: "metric",
    });
    expect(doc.output("blob").size).toBeGreaterThan(0);
  });

  it("does not throw exactly at the 200-waypoint truncation boundary", () => {
    const exactlyAtCap = Array.from({ length: 200 }, (_, i) =>
      wp(i, 50.06 + i * 0.0001, 14.43),
    );
    const oneOverCap = Array.from({ length: 201 }, (_, i) =>
      wp(i, 50.06 + i * 0.0001, 14.43),
    );
    expect(() =>
      generateMissionReportPdf({
        missionName: "Přesně na hranici",
        config: DEFAULT_MISSION_CONFIG,
        waypoints: exactlyAtCap,
        unitSystem: "metric",
      }),
    ).not.toThrow();
    expect(() =>
      generateMissionReportPdf({
        missionName: "Těsně nad hranicí",
        config: DEFAULT_MISSION_CONFIG,
        waypoints: oneOverCap,
        unitSystem: "metric",
      }),
    ).not.toThrow();
  });
});
