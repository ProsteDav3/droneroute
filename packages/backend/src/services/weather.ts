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

// ── Wind at altitude (Open-Meteo) ───────────────────────────
//
// MET Norway's Locationforecast only reports surface-level wind. For rotor
// wash and gust planning at actual flight altitude, Open-Meteo's forecast
// API (https://open-meteo.com/, free, no API key) exposes wind speed/
// direction at fixed altitude bands (80/120/180m above ground). We fetch
// all three bands in a single request and cache the whole set per
// location, then pick whichever band is closest to the mission's
// configured flight height — no re-fetch needed just because the height
// changed slightly.

const WIND_ALOFT_TTL_MS = 30 * 60 * 1000;
const WIND_ALOFT_ALTITUDES = [80, 120, 180] as const;
type WindAloftAltitude = (typeof WIND_ALOFT_ALTITUDES)[number];

export interface WindAloftReading {
  time: string;
  /** The altitude band (m) actually used — the closest one available to the requested height. */
  altitudeM: WindAloftAltitude;
  windSpeedMs: number | null;
  windFromDirectionDeg: number | null;
}

interface WindAloftBandReading {
  time: string;
  windSpeedMs: number | null;
  windFromDirectionDeg: number | null;
}

interface WindAloftCacheEntry {
  expiresAt: number;
  readings: Record<WindAloftAltitude, WindAloftBandReading>;
}

const windAloftCache = new Map<string, WindAloftCacheEntry>();

/** Nearest of the fixed 80/120/180m Open-Meteo bands to the requested height. */
function closestAltitudeBand(heightM: number): WindAloftAltitude {
  return WIND_ALOFT_ALTITUDES.reduce((closest, band) =>
    Math.abs(band - heightM) < Math.abs(closest - heightM) ? band : closest,
  );
}

/** Index of the first hourly timestamp at or after now, falling back to the last available one if the whole series is already in the past. */
function closestTimeIndex(times: string[]): number {
  const now = Date.now();
  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]).getTime();
    if (Number.isFinite(t) && t >= now) return i;
  }
  return Math.max(0, times.length - 1);
}

function extractWindAloftReadings(
  json: any,
): Record<WindAloftAltitude, WindAloftBandReading> {
  const times = json?.hourly?.time;
  if (!Array.isArray(times) || times.length === 0) {
    throw new Error("Unexpected response shape from wind-aloft provider");
  }

  const index = closestTimeIndex(times);
  const readings = {} as Record<WindAloftAltitude, WindAloftBandReading>;
  for (const band of WIND_ALOFT_ALTITUDES) {
    const speeds = json.hourly[`wind_speed_${band}m`];
    const directions = json.hourly[`wind_direction_${band}m`];
    readings[band] = {
      time: times[index],
      windSpeedMs: typeof speeds?.[index] === "number" ? speeds[index] : null,
      windFromDirectionDeg:
        typeof directions?.[index] === "number" ? directions[index] : null,
    };
  }
  return readings;
}

export async function fetchWindAloft(
  lat: number,
  lng: number,
  heightM: number,
): Promise<WindAloftReading> {
  const key = cacheKey(lat, lng);
  const cached = windAloftCache.get(key);

  let readings: Record<WindAloftAltitude, WindAloftBandReading>;
  if (cached && cached.expiresAt > Date.now()) {
    readings = cached.readings;
  } else {
    const params = WIND_ALOFT_ALTITUDES.flatMap((band) => [
      `wind_speed_${band}m`,
      `wind_direction_${band}m`,
    ]).join(",");
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lng.toFixed(2)}&hourly=${params}&wind_speed_unit=ms&forecast_days=1`;
    const upstream = await fetch(url);

    if (!upstream.ok) {
      throw new Error(`Wind-aloft provider returned ${upstream.status}`);
    }

    const json = await upstream.json();
    readings = extractWindAloftReadings(json);

    if (windAloftCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = windAloftCache.keys().next().value;
      if (oldestKey !== undefined) windAloftCache.delete(oldestKey);
    }
    windAloftCache.set(key, {
      expiresAt: Date.now() + WIND_ALOFT_TTL_MS,
      readings,
    });
  }

  const band = closestAltitudeBand(heightM);
  return { altitudeM: band, ...readings[band] };
}

// ── Planetary Kp index (NOAA SWPC) ──────────────────────────
//
// NOAA's Space Weather Prediction Center publishes a free, no-key JSON
// feed of recent planetary Kp values. It's a single global reading (not
// location-specific) that updates a few times a day, so it's cached
// independently of any coordinate.

const KP_TTL_MS = 45 * 60 * 1000;

export interface KpReading {
  time: string;
  kp: number;
}

let kpCache: { expiresAt: number; reading: KpReading } | null = null;

function extractLatestKp(json: any): KpReading {
  if (!Array.isArray(json) || json.length < 2) {
    throw new Error("Unexpected response shape from Kp-index provider");
  }

  const header = json[0];
  const timeIndex = Array.isArray(header) ? header.indexOf("time_tag") : -1;
  const kpIndex = Array.isArray(header) ? header.indexOf("Kp") : -1;
  if (timeIndex === -1 || kpIndex === -1) {
    throw new Error("Unexpected response shape from Kp-index provider");
  }

  const lastRow = json[json.length - 1];
  const kp = Number(lastRow?.[kpIndex]);
  const time = lastRow?.[timeIndex];
  if (!Number.isFinite(kp) || typeof time !== "string") {
    throw new Error("Unexpected response shape from Kp-index provider");
  }

  return { time, kp };
}

export async function fetchKpIndex(): Promise<KpReading> {
  if (kpCache && kpCache.expiresAt > Date.now()) {
    return kpCache.reading;
  }

  const upstream = await fetch(
    "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
  );

  if (!upstream.ok) {
    throw new Error(`Kp-index provider returned ${upstream.status}`);
  }

  const json = await upstream.json();
  const reading = extractLatestKp(json);
  kpCache = { expiresAt: Date.now() + KP_TTL_MS, reading };

  return reading;
}
