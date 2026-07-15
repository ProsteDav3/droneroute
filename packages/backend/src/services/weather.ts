import type { WeatherForecastEntry } from "@droneroute/shared";

/**
 * Proxies MET Norway's free Locationforecast API
 * (https://api.met.no/weatherapi/locationforecast/2.0/) — no API key, but
 * their terms require an identifying User-Agent and require callers to
 * respect the `Expires` header instead of polling on every request. This
 * module handles both: a fixed identifying User-Agent, and an in-memory
 * cache keyed by rounded coordinates, honoring the upstream `Expires` value.
 */

const USER_AGENT =
  "DroneRoute-SkyData/1.0 (https://github.com/ProsteDav3/droneroute)";
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

interface CacheEntry {
  expiresAt: number;
  forecast: WeatherForecastEntry[];
}

const cache = new Map<string, CacheEntry>();

/** Round to ~1km precision — plenty for a weather forecast, and keeps the cache small. */
function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

function extractForecast(json: any): WeatherForecastEntry[] {
  const timeseries = json?.properties?.timeseries;
  if (!Array.isArray(timeseries)) {
    throw new Error("Unexpected response shape from weather provider");
  }

  // Guard against a malformed upstream entry (e.g. a literal null/undefined
  // element in the array) the same way every other field access below
  // already tolerates missing sub-fields — a timeseries entry with no
  // usable time is meaningless, so drop it rather than throw or fabricate one.
  return timeseries
    .filter((entry: any) => typeof entry?.time === "string")
    .map((entry: any): WeatherForecastEntry => {
      const details = entry?.data?.instant?.details ?? {};
      const next1 = entry?.data?.next_1_hours;
      const next6 = entry?.data?.next_6_hours;
      const next12 = entry?.data?.next_12_hours;

      const precipitationMm =
        typeof next1?.details?.precipitation_amount === "number"
          ? next1.details.precipitation_amount
          : typeof next6?.details?.precipitation_amount === "number"
            ? next6.details.precipitation_amount
            : null;

      const symbolCode =
        next1?.summary?.symbol_code ??
        next6?.summary?.symbol_code ??
        next12?.summary?.symbol_code ??
        null;

      return {
        time: entry.time,
        temperatureC:
          typeof details.air_temperature === "number"
            ? details.air_temperature
            : null,
        windSpeedMs:
          typeof details.wind_speed === "number" ? details.wind_speed : null,
        windFromDirectionDeg:
          typeof details.wind_from_direction === "number"
            ? details.wind_from_direction
            : null,
        precipitationMm,
        symbolCode,
      };
    });
}

export async function fetchForecast(
  lat: number,
  lng: number,
): Promise<WeatherForecastEntry[]> {
  const key = cacheKey(lat, lng);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.forecast;
  }

  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(2)}&lon=${lng.toFixed(2)}`;
  const upstream = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!upstream.ok) {
    throw new Error(`Weather provider returned ${upstream.status}`);
  }

  const json = await upstream.json();
  const forecast = extractForecast(json);

  const expiresHeader = upstream.headers.get("expires");
  const expiresAtFromHeader = expiresHeader
    ? new Date(expiresHeader).getTime()
    : NaN;
  const ttlMs =
    Number.isFinite(expiresAtFromHeader) && expiresAtFromHeader > Date.now()
      ? expiresAtFromHeader - Date.now()
      : DEFAULT_TTL_MS;

  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { expiresAt: Date.now() + ttlMs, forecast });

  return forecast;
}
