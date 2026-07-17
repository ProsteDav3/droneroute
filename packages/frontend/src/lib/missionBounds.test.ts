import { describe, it, expect } from "vitest";
import { computeBoundingBox } from "./missionBounds";

describe("computeBoundingBox", () => {
  it("returns null for an empty list", () => {
    expect(computeBoundingBox([])).toBeNull();
  });

  it("returns a single-point box when given one point", () => {
    const box = computeBoundingBox([{ latitude: 50, longitude: 14 }]);
    expect(box).toEqual({ south: 50, west: 14, north: 50, east: 14 });
  });

  it("computes the enclosing box for multiple points", () => {
    const box = computeBoundingBox([
      { latitude: 50, longitude: 14 },
      { latitude: 51, longitude: 15 },
      { latitude: 49.5, longitude: 13.5 },
    ]);
    expect(box).toEqual({ south: 49.5, west: 13.5, north: 51, east: 15 });
  });
});
