import type { WeatherForecastEntry } from "@droneroute/shared";

/**
 * Wind/precipitation go/no-go thresholds for the preflight checklist.
 *
 * These are deliberately simple placeholder limits, not a certified safety
 * assessment — the mission-planning weather epic may land its own scoring
 * with per-drone limits later; this just gives the checklist a sane default
 * rather than leaving the weather section blank.
 */
const MAX_WIND_MS_GO = 8;
const MAX_PRECIPITATION_MM_GO = 0.2;

export type WeatherGoNoGoStatus = "go" | "caution" | "no-go" | "unknown";

export interface WeatherGoNoGo {
  status: WeatherGoNoGoStatus;
  reasons: string[];
}

export const WEATHER_STATUS_LABELS: Record<WeatherGoNoGoStatus, string> = {
  go: "Vhodné podmínky",
  caution: "Podmínky vyžadují opatrnost",
  "no-go": "Nevhodné podmínky",
  unknown: "Předpověď není k dispozici",
};

/** Simplified go/no-go read on a single forecast entry — see thresholds above. */
export function computeWeatherGoNoGo(
  entry: WeatherForecastEntry | null | undefined,
): WeatherGoNoGo {
  if (!entry) {
    return {
      status: "unknown",
      reasons: ["Předpověď počasí pro tuto lokalitu a čas není k dispozici."],
    };
  }

  const reasons: string[] = [];
  let status: WeatherGoNoGoStatus = "go";

  if (entry.windSpeedMs !== null && entry.windSpeedMs > MAX_WIND_MS_GO) {
    status = "no-go";
    reasons.push(
      `Vítr ${entry.windSpeedMs} m/s přesahuje doporučený limit ${MAX_WIND_MS_GO} m/s`,
    );
  }

  if (
    entry.precipitationMm !== null &&
    entry.precipitationMm > MAX_PRECIPITATION_MM_GO
  ) {
    if (status !== "no-go") status = "caution";
    reasons.push(`Očekávané srážky ${entry.precipitationMm} mm`);
  }

  if (reasons.length === 0) {
    reasons.push("Vítr a srážky v rámci doporučených limitů.");
  }

  return { status, reasons };
}

// ── SORA-lite risk assessment labels ─────────────────────

export type RiskClass = "low" | "medium" | "high";

export const RISK_CLASS_LABELS: Record<RiskClass, string> = {
  low: "Nízké",
  medium: "Střední",
  high: "Vysoké",
};

/** Checkbox options for the mitigations questionnaire — shared between the risk-assessment form and the PDF checklist rendering. */
export const MITIGATION_OPTIONS: { value: string; label: string }[] = [
  { value: "ground_observer", label: "Pozorovatel na zemi" },
  { value: "safety_net", label: "Záchranná síť" },
  { value: "parachute_system", label: "Záchranný padákový systém" },
  { value: "geofencing", label: "Geofencing / omezení oblasti letu" },
  { value: "reduced_area_ops", label: "Omezený provoz nad citlivou oblastí" },
];

export function mitigationLabel(value: string): string {
  return MITIGATION_OPTIONS.find((m) => m.value === value)?.label ?? value;
}
