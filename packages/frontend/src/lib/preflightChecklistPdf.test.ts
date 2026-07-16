import { describe, it, expect } from "vitest";
import { generatePreflightChecklistPdf } from "./preflightChecklistPdf";

describe("generatePreflightChecklistPdf", () => {
  it("generates a non-empty PDF with no conflicts, no risk assessment, no permits", () => {
    const doc = generatePreflightChecklistPdf({
      missionName: "Test mise",
      obstacleWarnings: [],
      airspaceWarnings: [],
      batteryExceeded: false,
      flightTimeS: 600,
      maxBatteryMinutes: 30,
      weather: { status: "unknown", reasons: ["Předpověď není k dispozici."] },
      riskAssessment: null,
      permits: [],
    });

    const blob = doc.output("blob");
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe("application/pdf");
  });

  it("does not throw when every section has data", () => {
    expect(() =>
      generatePreflightChecklistPdf({
        missionName: "Plná mise",
        obstacleWarnings: [
          {
            obstacleId: "o1",
            obstacleName: "Věž",
            waypointIndex: 2,
            type: "crosses",
          },
        ],
        airspaceWarnings: [
          {
            zoneId: "z1",
            zoneName: "GRID_CTR",
            severity: "restricted",
            type: "crosses",
            altitudeUpper: 120,
          },
        ],
        batteryExceeded: true,
        flightTimeS: 2400,
        maxBatteryMinutes: 30,
        weather: { status: "no-go", reasons: ["Vítr 12 m/s přesahuje limit"] },
        riskAssessment: {
          groundRiskClass: "medium",
          airRiskClass: "low",
          mitigations: ["ground_observer", "geofencing"],
          assessedAt: "2026-07-16T10:00:00Z",
        },
        permits: [
          {
            description: "Koordinace s místním úřadem",
            expiryDate: "2026-12-31",
            referenceOrUrl: "REF-001",
          },
        ],
      }),
    ).not.toThrow();
  });
});
