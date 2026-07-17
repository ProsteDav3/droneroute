import { describe, it, expect } from "vitest";
import { findPairedGatewaySn, type DjiDeviceSummary } from "./djiCloudOpsStore";

function device(overrides: Partial<DjiDeviceSummary>): DjiDeviceSummary {
  return {
    device_sn: "SN",
    nickname: "",
    device_name: "",
    bound_status: true,
    ...overrides,
  };
}

describe("findPairedGatewaySn", () => {
  it("finds the RC/dock whose child_device_sn points at the aircraft", () => {
    const devices = [
      device({ device_sn: "RC1", child_device_sn: "DRONE1" }),
      device({ device_sn: "DRONE1" }),
    ];
    expect(findPairedGatewaySn(devices, "DRONE1")).toBe("RC1");
  });

  it("falls back to the aircraft's own parent_sn when no device lists it as a child", () => {
    const devices = [device({ device_sn: "DRONE1", parent_sn: "RC1" })];
    expect(findPairedGatewaySn(devices, "DRONE1")).toBe("RC1");
  });

  it("returns null when no pairing can be found", () => {
    const devices = [device({ device_sn: "DRONE1" })];
    expect(findPairedGatewaySn(devices, "DRONE1")).toBeNull();
  });

  it("returns null for an unknown aircraft SN", () => {
    expect(findPairedGatewaySn([], "GHOST")).toBeNull();
  });
});
