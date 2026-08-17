import { describe, it, expect } from "vitest";
import {
  buildingFillLayerIds,
  buildingIdFromFillLayerId,
  buildingOutlineLayerId,
  buildingSourceId,
} from "./buildingLayers";

describe("buildingLayers", () => {
  const id = "b7b1b0d4-9f3c-4a1e-8f0a-2c9d5e6f7a8b";

  it("round-trips a uuid building id through both fill layer ids", () => {
    // The id contains dashes, so a naive split on "-" would return "b7b1b0d4"
    // and the click menu would open on the wrong building (or none).
    for (const layerId of buildingFillLayerIds(id)) {
      expect(buildingIdFromFillLayerId(layerId)).toBe(id);
    }
  });

  it("names the 2D and 3D fills distinctly, both under the building's source", () => {
    const [flat, extruded] = buildingFillLayerIds(id);
    expect(flat).not.toBe(extruded);
    expect(flat.startsWith(buildingSourceId(id))).toBe(true);
    expect(extruded.startsWith(buildingSourceId(id))).toBe(true);
  });

  it("returns null for layers that are not a building fill", () => {
    expect(buildingIdFromFillLayerId(buildingOutlineLayerId(id))).toBeNull();
    expect(buildingIdFromFillLayerId("3d-buildings")).toBeNull();
    expect(
      buildingIdFromFillLayerId("orbit-poi-clearance-guide-layer"),
    ).toBeNull();
    expect(buildingIdFromFillLayerId("obstacle-1-fill-2d")).toBeNull();
  });
});
