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
  clearsky: "Clear sky",
  fair: "Fair",
  partlycloudy: "Partly cloudy",
  cloudy: "Cloudy",
  fog: "Fog",
  rain: "Rain",
  lightrain: "Light rain",
  heavyrain: "Heavy rain",
  rainshowers: "Rain showers",
  lightrainshowers: "Light rain showers",
  heavyrainshowers: "Heavy rain showers",
  sleet: "Sleet",
  lightsleet: "Light sleet",
  heavysleet: "Heavy sleet",
  sleetshowers: "Sleet showers",
  snow: "Snow",
  lightsnow: "Light snow",
  heavysnow: "Heavy snow",
  snowshowers: "Snow showers",
  lightsnowshowers: "Light snow showers",
  heavysnowshowers: "Heavy snow showers",
  rainandthunder: "Rain and thunder",
  rainshowersandthunder: "Rain showers and thunder",
  snowandthunder: "Snow and thunder",
};

export function symbolLabel(symbolCode: string | null): string {
  if (!symbolCode) return "Unknown";
  const base = symbolCode.replace(/_(day|night|polartwilight)$/, "");
  return SYMBOL_LABELS[base] ?? base;
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
