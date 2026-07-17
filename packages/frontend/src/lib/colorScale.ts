/** Fixed color stops for the "color route by value" gradient — blue (low)
 * through green and yellow to red (high). Chosen for the same reason a
 * heatmap uses this ramp: it reads as a clear low-to-high scale even to
 * someone who hasn't seen the legend, unlike a single-hue gradient. */
const GRADIENT_STOPS: [number, number, number][] = [
  [0x22, 0x63, 0xeb], // blue   (#2563eb) — low
  [0x16, 0xa3, 0x4a], // green  (#16a34a)
  [0xea, 0xb3, 0x08], // yellow (#eab308)
  [0xdc, 0x26, 0x26], // red    (#dc2626) — high
];

function toHex(n: number): string {
  return Math.round(n).toString(16).padStart(2, "0");
}

/**
 * Maps `value` within [min, max] to a hex color along a fixed blue → green
 * → yellow → red gradient. Out-of-range values clamp to the nearest end
 * color rather than extrapolating. When `min === max` (every segment has
 * the same value — e.g. a perfectly flat mission), returns the gradient's
 * midpoint color so the whole path renders one consistent color instead of
 * dividing by zero.
 */
export function valueToGradientColor(
  value: number,
  min: number,
  max: number,
): string {
  if (max === min) {
    const [r, g, b] = GRADIENT_STOPS[Math.floor(GRADIENT_STOPS.length / 2)];
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const segmentCount = GRADIENT_STOPS.length - 1;
  const segmentT = t * segmentCount;
  const segmentIndex = Math.min(segmentCount - 1, Math.floor(segmentT));
  const localT = segmentT - segmentIndex;

  const [r1, g1, b1] = GRADIENT_STOPS[segmentIndex];
  const [r2, g2, b2] = GRADIENT_STOPS[segmentIndex + 1];

  const r = r1 + (r2 - r1) * localT;
  const g = g1 + (g2 - g1) * localT;
  const b = b1 + (b2 - b1) * localT;

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
