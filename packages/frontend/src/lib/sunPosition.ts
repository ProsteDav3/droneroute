import { getTimes } from "suncalc";

/**
 * Sun position for a given date/location, computed purely client-side via
 * `suncalc` — no network call, no API key. Useful for planning around
 * shadows (golden hour) and knowing when night-flight rules might apply
 * (civil twilight).
 *
 * All fields except `solarNoon` can be `null` at high latitudes where the
 * event doesn't occur that day (polar day/night) — not a case any real
 * mission planned in Central Europe will hit, but suncalc's own types
 * allow it, so this mirrors that rather than asserting non-null.
 */
export interface SunTimes {
  sunrise: Date | null;
  sunset: Date | null;
  solarNoon: Date;
  /** Morning golden hour: soft, warm light shortly after sunrise. */
  morningGoldenHourStart: Date | null;
  morningGoldenHourEnd: Date | null;
  /** Evening golden hour: soft, warm light shortly before sunset. */
  eveningGoldenHourStart: Date | null;
  eveningGoldenHourEnd: Date | null;
  /** Civil twilight begins in the morning (sun 6° below horizon) — before this it's still night-dark. */
  civilDawn: Date | null;
  /** Civil twilight ends in the evening (sun 6° below horizon) — after this it's night-dark. */
  civilDusk: Date | null;
}

export function getSunTimes(date: Date, lat: number, lng: number): SunTimes {
  const t = getTimes(date, lat, lng);
  return {
    sunrise: t.sunrise,
    sunset: t.sunset,
    solarNoon: t.solarNoon,
    morningGoldenHourStart: t.sunrise,
    morningGoldenHourEnd: t.goldenHourEnd,
    eveningGoldenHourStart: t.goldenHour,
    eveningGoldenHourEnd: t.sunset,
    civilDawn: t.dawn,
    civilDusk: t.dusk,
  };
}

export type TwilightStatus = "day" | "near-twilight" | "night";

/** How close to civil twilight (dusk/dawn) a moment is considered "near" — a heads-up window before it's actually dark/light. */
const TWILIGHT_MARGIN_MS = 30 * 60 * 1000;

/**
 * Classifies `now` relative to civil twilight, so the UI can surface a
 * conservative "night-flight rules may apply, check your national
 * regulations" note instead of asserting a precise legal boundary. Treats
 * both the evening (approaching/after dusk) and morning (just past dawn,
 * or still before it) edges — most planning use cases care about the
 * evening one, but a mission planned very early morning hits the same
 * concern.
 */
export function assessTwilightStatus(now: Date, sun: SunTimes): TwilightStatus {
  if (sun.civilDusk === null || sun.civilDawn === null) {
    // Polar day/night edge case where civil twilight isn't a discrete
    // event that day — treat as unknown rather than asserting a warning
    // this app has no data to back up.
    return "day";
  }

  const nowMs = now.getTime();
  const duskMs = sun.civilDusk.getTime();
  const dawnMs = sun.civilDawn.getTime();

  if (nowMs >= duskMs || nowMs <= dawnMs) {
    return "night";
  }
  if (
    nowMs >= duskMs - TWILIGHT_MARGIN_MS ||
    nowMs <= dawnMs + TWILIGHT_MARGIN_MS
  ) {
    return "near-twilight";
  }
  return "day";
}
