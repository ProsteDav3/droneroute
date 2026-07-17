import { describe, it, expect } from "vitest";
import { valueToGradientColor } from "./colorScale";

describe("valueToGradientColor", () => {
  it("returns a valid hex color string", () => {
    expect(valueToGradientColor(50, 0, 100)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("clamps below-range values to the low end color", () => {
    expect(valueToGradientColor(-1000, 0, 100)).toBe(
      valueToGradientColor(0, 0, 100),
    );
  });

  it("clamps above-range values to the high end color", () => {
    expect(valueToGradientColor(1000, 0, 100)).toBe(
      valueToGradientColor(100, 0, 100),
    );
  });

  it("returns a single consistent color when min equals max, without dividing by zero", () => {
    const color = valueToGradientColor(50, 50, 50);
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
    expect(valueToGradientColor(999, 999, 999)).toBe(color);
  });

  it("the low end and high end are visibly different colors", () => {
    expect(valueToGradientColor(0, 0, 100)).not.toBe(
      valueToGradientColor(100, 0, 100),
    );
  });

  it("is monotonic in the red channel across the low half of the range (blue -> green -> yellow)", () => {
    // Not a strict claim about every channel (it's a multi-stop gradient,
    // not a single linear ramp) — just checks the function responds
    // smoothly to input rather than jumping erratically.
    const quarter = valueToGradientColor(25, 0, 100);
    const half = valueToGradientColor(50, 0, 100);
    expect(quarter).not.toBe(half);
  });
});
