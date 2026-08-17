import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findPairedGatewaySn,
  useDjiCloudOpsStore,
  type DjiDeviceSummary,
} from "./djiCloudOpsStore";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
const mockedApi = vi.mocked(api);

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

describe("deleteWaylinesInBulk", () => {
  const wayline = (id: string, name: string) => ({ id, name }) as never;

  beforeEach(() => {
    vi.clearAllMocks();
    useDjiCloudOpsStore.setState({
      waylines: [
        wayline("m1", "KCP-auto"),
        wayline("m2", "Petrovice-C9"),
        wayline("s1", "KCP-auto-seg-1-of-3"),
        wayline("s2", "KCP-auto-seg-2-of-3"),
        wayline("s3", "KCP-auto-seg-3-of-3"),
      ],
      bulkWaylineDelete: null,
      waylinesError: null,
    });
  });

  it("deletes only the segments, leaving whole missions untouched", async () => {
    mockedApi.delete.mockResolvedValue(undefined as never);

    const result = await useDjiCloudOpsStore
      .getState()
      .deleteWaylinesInBulk("segments");

    expect(result).toEqual({ deleted: 3, failed: 0 });
    expect(useDjiCloudOpsStore.getState().waylines.map((w) => w.id)).toEqual([
      "m1",
      "m2",
    ]);
  });

  it("deletes only the whole missions, leaving segments untouched", async () => {
    mockedApi.delete.mockResolvedValue(undefined as never);

    const result = await useDjiCloudOpsStore
      .getState()
      .deleteWaylinesInBulk("missions");

    expect(result).toEqual({ deleted: 2, failed: 0 });
    expect(useDjiCloudOpsStore.getState().waylines.map((w) => w.id)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
  });

  it("keeps going when one delete fails, and reports it", async () => {
    // A partly-failed sweep must not leave rows that were actually deleted
    // still showing, nor stop at the first error — the point of the button is
    // to clear the library in one go.
    mockedApi.delete
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockResolvedValueOnce(undefined as never);

    const result = await useDjiCloudOpsStore
      .getState()
      .deleteWaylinesInBulk("segments");

    expect(result).toEqual({ deleted: 2, failed: 1 });
    expect(useDjiCloudOpsStore.getState().waylines.map((w) => w.id)).toEqual([
      "m1",
      "m2",
      "s2",
    ]);
    expect(useDjiCloudOpsStore.getState().waylinesError).toContain("429");
  });

  it("clears the progress indicator when it finishes", async () => {
    mockedApi.delete.mockResolvedValue(undefined as never);
    await useDjiCloudOpsStore.getState().deleteWaylinesInBulk("segments");
    expect(useDjiCloudOpsStore.getState().bulkWaylineDelete).toBeNull();
  });
});
