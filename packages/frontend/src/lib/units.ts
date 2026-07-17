import type { UnitSystem, HeightMode, HeadingMode } from "@droneroute/shared";

// ── Conversion constants ────────────────────────────────

const MS_TO_MPH = 2.23694;
const M_TO_FT = 3.28084;
const M_TO_MI = 0.000621371;
const SQM_TO_SQFT = 10.7639;
const SQM_TO_ACRES = 0.000247105;
const SQM_TO_SQMI = 3.861e-7;

// ── Display formatters ──────────────────────────────────

export function formatDistance(
  meters: number,
  unitSystem: UnitSystem = "metric",
): string {
  if (unitSystem === "imperial") {
    const mi = meters * M_TO_MI;
    if (mi >= 0.1) return `${mi.toFixed(1)} mi`;
    return `${Math.round(meters * M_TO_FT)} ft`;
  }
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

export function formatSpeed(
  ms: number,
  unitSystem: UnitSystem = "metric",
): string {
  if (unitSystem === "imperial") {
    return `${(ms * MS_TO_MPH).toFixed(1)} mph`;
  }
  return `${ms} m/s`;
}

export function formatHeight(
  meters: number,
  unitSystem: UnitSystem = "metric",
): string {
  if (unitSystem === "imperial") {
    return `${Math.round(meters * M_TO_FT)} ft`;
  }
  return `${Math.round(meters)} m`;
}

export function formatArea(
  areaM2: number,
  unitSystem: UnitSystem = "metric",
): string {
  if (unitSystem === "imperial") {
    const sqmi = areaM2 * SQM_TO_SQMI;
    if (sqmi >= 1) return `${sqmi.toFixed(2)} sq mi`;
    const acres = areaM2 * SQM_TO_ACRES;
    if (acres >= 0.1) return `${acres.toFixed(2)} acres`;
    return `${Math.round(areaM2 * SQM_TO_SQFT)} sq ft`;
  }
  if (areaM2 >= 1_000_000) return `${(areaM2 / 1_000_000).toFixed(2)} km²`;
  if (areaM2 >= 10_000) return `${(areaM2 / 10_000).toFixed(2)} ha`;
  return `${Math.round(areaM2)} m²`;
}

/** Format a data size (MB) as a human-readable string — unit-system
 * independent, unlike the other formatters here (no imperial equivalent
 * for byte units). */
export function formatDataSize(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

// ── Labels for form inputs ──────────────────────────────

export function speedLabel(unitSystem: UnitSystem = "metric"): string {
  return unitSystem === "imperial" ? "mph" : "m/s";
}

export function heightLabel(unitSystem: UnitSystem = "metric"): string {
  return unitSystem === "imperial" ? "ft" : "m";
}

export function distanceLabel(unitSystem: UnitSystem = "metric"): string {
  return unitSystem === "imperial" ? "ft" : "m";
}

export function temperatureLabel(unitSystem: UnitSystem = "metric"): string {
  return unitSystem === "imperial" ? "°F" : "°C";
}

// ── Bidirectional conversion for form inputs ────────────
// Internal storage is always metric (m, m/s).
// These convert between internal values and display values.

export function toDisplaySpeed(
  ms: number,
  unitSystem: UnitSystem = "metric",
): number {
  if (unitSystem === "imperial") return +(ms * MS_TO_MPH).toFixed(1);
  return ms;
}

export function fromDisplaySpeed(
  value: number,
  unitSystem: UnitSystem = "metric",
): number {
  if (unitSystem === "imperial") return +(value / MS_TO_MPH).toFixed(2);
  return value;
}

export function toDisplayHeight(
  meters: number,
  unitSystem: UnitSystem = "metric",
): number {
  if (unitSystem === "imperial") return +(meters * M_TO_FT).toFixed(1);
  return meters;
}

export function fromDisplayHeight(
  value: number,
  unitSystem: UnitSystem = "metric",
): number {
  if (unitSystem === "imperial") return +(value / M_TO_FT).toFixed(2);
  return value;
}

export function toDisplayDistance(
  meters: number,
  unitSystem: UnitSystem = "metric",
): number {
  if (unitSystem === "imperial") return +(meters * M_TO_FT).toFixed(1);
  return meters;
}

export function fromDisplayDistance(
  value: number,
  unitSystem: UnitSystem = "metric",
): number {
  if (unitSystem === "imperial") return +(value / M_TO_FT).toFixed(2);
  return value;
}

/** Display-only (weather data isn't user-editable, so no inverse conversion needed). */
export function toDisplayTemperature(
  celsius: number,
  unitSystem: UnitSystem = "metric",
): number {
  if (unitSystem === "imperial") return Math.round((celsius * 9) / 5 + 32);
  return Math.round(celsius);
}

// ── Speed range conversion for input min/max ────────────

export function speedRange(unitSystem: UnitSystem = "metric"): {
  min: number;
  max: number;
  step: number;
} {
  if (unitSystem === "imperial") {
    return { min: 2, max: 34, step: 1 };
  }
  return { min: 1, max: 15, step: 0.5 };
}

// ── Height mode label ────────────────────────────────────

/** Human-readable Czech label for the mission's configured height reference. */
export function heightModeLabel(mode: HeightMode): string {
  switch (mode) {
    case "relativeToStartPoint":
      return "relativně od vzletového bodu";
    case "aboveGroundLevel":
      return "nad terénem";
    case "EGM96":
      return "nad mořem (EGM96)";
    default:
      return mode;
  }
}

// ── Heading mode label ───────────────────────────────────

/** Human-readable Czech label for a waypoint/mission heading mode. */
export function headingModeLabel(mode: HeadingMode): string {
  switch (mode) {
    case "followWayline":
      return "podle trasy";
    case "manually":
      return "ruční";
    case "fixed":
      return "pevné";
    case "smoothTransition":
      return "plynulý přechod";
    case "towardPOI":
      return "směrem k POI";
    default:
      return mode;
  }
}
