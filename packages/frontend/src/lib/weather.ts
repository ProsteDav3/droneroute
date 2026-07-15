import type { WeatherForecastEntry } from "@droneroute/shared";

export interface DailyForecast {
  date: string; // YYYY-MM-DD (UTC)
  minTempC: number | null;
  maxTempC: number | null;
  maxWindSpeedMs: number | null;
  totalPrecipitationMm: number | null;
  symbolCode: string | null;
}

/**
 * Groups a flat forecast timeseries into one summary per calendar day (UTC —
 * missions aren't tied to a specific timezone, so this avoids guessing one).
 */
export function groupForecastByDay(
  forecast: WeatherForecastEntry[],
): DailyForecast[] {
  const byDay = new Map<string, WeatherForecastEntry[]>();
  for (const entry of forecast) {
    const day = entry.time.slice(0, 10);
    const list = byDay.get(day);
    if (list) {
      list.push(entry);
    } else {
      byDay.set(day, [entry]);
    }
  }

  const days: DailyForecast[] = [];
  for (const [date, entries] of byDay) {
    const temps = entries
      .map((e) => e.temperatureC)
      .filter((t): t is number => t !== null);
    const winds = entries
      .map((e) => e.windSpeedMs)
      .filter((w): w is number => w !== null);
    const precips = entries
      .map((e) => e.precipitationMm)
      .filter((p): p is number => p !== null);

    // A midday entry is the most representative single symbol for "the
    // day" — fall back to the first entry that has one, then the very
    // first entry (still shows something rather than nothing).
    const representative =
      entries.find((e) => e.time.slice(11, 13) === "12") ??
      entries.find((e) => e.symbolCode !== null) ??
      entries[0];

    days.push({
      date,
      minTempC: temps.length ? Math.min(...temps) : null,
      maxTempC: temps.length ? Math.max(...temps) : null,
      maxWindSpeedMs: winds.length ? Math.max(...winds) : null,
      totalPrecipitationMm: precips.length
        ? Math.round(precips.reduce((sum, p) => sum + p, 0) * 10) / 10
        : null,
      symbolCode: representative?.symbolCode ?? null,
    });
  }

  return days.sort((a, b) => a.date.localeCompare(b.date));
}

/** Human-readable label for MET Norway's symbol_code values (common ones — falls back to the raw code for anything exotic). */
const SYMBOL_LABELS: Record<string, string> = {
  clearsky: "Jasno",
  fair: "Skoro jasno",
  partlycloudy: "Polojasno",
  cloudy: "Zataženo",
  fog: "Mlha",
  rain: "Déšť",
  lightrain: "Slabý déšť",
  heavyrain: "Silný déšť",
  rainshowers: "Přeháňky",
  lightrainshowers: "Slabé přeháňky",
  heavyrainshowers: "Silné přeháňky",
  sleet: "Déšť se sněhem",
  lightsleet: "Slabý déšť se sněhem",
  heavysleet: "Silný déšť se sněhem",
  sleetshowers: "Přeháňky se sněhem",
  snow: "Sníh",
  lightsnow: "Slabé sněžení",
  heavysnow: "Silné sněžení",
  snowshowers: "Sněhové přeháňky",
  lightsnowshowers: "Slabé sněhové přeháňky",
  heavysnowshowers: "Silné sněhové přeháňky",
  rainandthunder: "Déšť s bouřkou",
  rainshowersandthunder: "Přeháňky s bouřkou",
  snowandthunder: "Sněžení s bouřkou",
};

export function symbolLabel(symbolCode: string | null): string {
  if (!symbolCode) return "Neznámé";
  const base = symbolCode.replace(/_(day|night|polartwilight)$/, "");
  return SYMBOL_LABELS[base] ?? base;
}

export type FlightVerdict = "go" | "caution" | "no-go";

export interface FlightConditionAssessment {
  verdict: FlightVerdict;
  /** Czech, human-readable reasons behind the verdict — empty for "go". */
  reasons: string[];
}

// Thresholds are deliberately conservative rather than tuned to any one
// drone's exact spec sheet, since the mission's configured drone isn't
// necessarily the one actually flown on a given day. Rough basis: DJI's
// enterprise M300/M350/Matrice 4-series wind resistance rating (~12 m/s)
// and typical 0-40°C battery-safe operating range, with a few degrees of
// margin on both ends.
const NO_GO_WIND_MS = 12;
const CAUTION_WIND_MS = 8; // matches the existing amber threshold already shown in the forecast list
const MIN_SAFE_TEMP_C = -10;
const MAX_SAFE_TEMP_C = 40;
const HEAVY_PRECIP_MM = 2.5; // per representative period — enough to risk water ingress on non-sealed payloads
const LIGHT_PRECIP_MM = 0.5;

/**
 * Synthesizes a single go/caution/no-go flight recommendation from a day's
 * forecast, instead of leaving the operator to mentally combine wind,
 * temperature, precipitation, and storm risk themselves. Deliberately
 * conservative and not tied to any specific drone's certified limits — a
 * planning aid, not an authoritative go/no-go authority. Collects no-go and
 * caution reasons separately so a no-go verdict never gets silently
 * downgraded by a later caution-level check, and a caution verdict never
 * loses its own reasons if a later check turns out to be no-go instead.
 */
export function assessFlightConditions(
  day: DailyForecast,
): FlightConditionAssessment {
  const noGoReasons: string[] = [];
  const cautionReasons: string[] = [];

  if (day.symbolCode?.includes("thunder")) {
    noGoReasons.push("Bouřka");
  }

  if (day.maxWindSpeedMs !== null) {
    if (day.maxWindSpeedMs > NO_GO_WIND_MS) {
      noGoReasons.push(`Vítr nad ${NO_GO_WIND_MS} m/s`);
    } else if (day.maxWindSpeedMs >= CAUTION_WIND_MS) {
      cautionReasons.push("Silnější vítr");
    }
  }

  if (day.minTempC !== null && day.minTempC < MIN_SAFE_TEMP_C) {
    noGoReasons.push(`Teplota pod ${MIN_SAFE_TEMP_C} °C`);
  }
  if (day.maxTempC !== null && day.maxTempC > MAX_SAFE_TEMP_C) {
    noGoReasons.push(`Teplota nad ${MAX_SAFE_TEMP_C} °C`);
  }

  if (day.totalPrecipitationMm !== null) {
    if (day.totalPrecipitationMm >= HEAVY_PRECIP_MM) {
      noGoReasons.push("Vydatné srážky");
    } else if (day.totalPrecipitationMm >= LIGHT_PRECIP_MM) {
      cautionReasons.push("Srážky");
    }
  }

  if (noGoReasons.length > 0) {
    return { verdict: "no-go", reasons: noGoReasons };
  }
  if (cautionReasons.length > 0) {
    return { verdict: "caution", reasons: cautionReasons };
  }
  return { verdict: "go", reasons: [] };
}

export type SymbolIconKey = "sun" | "cloud" | "rain" | "snow" | "fog";

/** Coarse condition bucket for choosing a display icon. */
export function symbolIconKey(symbolCode: string | null): SymbolIconKey {
  if (!symbolCode) return "cloud";
  const base = symbolCode.replace(/_(day|night|polartwilight)$/, "");
  if (base.includes("snow") || base.includes("sleet")) return "snow";
  if (base.includes("rain")) return "rain";
  if (base.includes("fog")) return "fog";
  if (base === "clearsky" || base === "fair") return "sun";
  return "cloud";
}
