import { describe, it, expect } from "vitest";
import { describeDroneAndPayload } from "./droneModels";

describe("describeDroneAndPayload", () => {
  it("resolves a known drone + payload combination", () => {
    expect(
      describeDroneAndPayload({
        droneEnumValue: 99,
        droneSubEnumValue: 1,
        payloadEnumValue: 89,
      }),
    ).toEqual({
      droneLabel: "DJI Matrice 4T",
      payloadLabel: "Matrice 4T Camera",
    });
  });

  it("resolves the drone but omits payloadLabel when the payload isn't listed for it", () => {
    const result = describeDroneAndPayload({
      droneEnumValue: 67,
      droneSubEnumValue: 0,
      payloadEnumValue: 999999,
    });
    expect(result.droneLabel).toBe("DJI M30");
    expect(result.payloadLabel).toBeUndefined();
  });

  it("falls back to a labeled-unknown description instead of guessing for an unrecognized drone", () => {
    const result = describeDroneAndPayload({
      droneEnumValue: 12345,
      droneSubEnumValue: 6,
      payloadEnumValue: 0,
    });
    expect(result.droneLabel).toContain("12345");
    expect(result.droneLabel).toContain("6");
    expect(result.payloadLabel).toBeUndefined();
  });
});
