# Wind at altitude, Kp index, sun position, and a combined flight-conditions summary

Expanded the weather forecast sidebar section with four more planning
signals beyond surface wind/precipitation/temperature, and combined all
of it into a single go/caution/no-go summary.

## What's new

- **Wind at flight altitude.** MET Norway's Locationforecast only reports
  surface-level wind, which can differ meaningfully from wind at actual
  flight height. Added Open-Meteo (free, no API key) as a supplementary
  source for wind speed/direction at 80/120/180m above ground — the app
  picks whichever band is closest to the mission's configured flight
  height and labels it clearly.
- **Kp geomagnetic index.** Fetches the latest planetary Kp value from
  NOAA SWPC's free public feed and surfaces it with a conservatively
  worded note when it's elevated (Kp ≥ 5) — loosely associated with
  degraded GPS accuracy, not asserted as a precise measurement.
- **Sun position / golden hour.** Computed client-side via `suncalc` (no
  network call) — sunrise, sunset, and morning/evening golden hour
  windows, for planning around shadows.
- **Civil twilight warning.** Also from `suncalc` — flags when now is
  near or past civil twilight with a note that night-flight rules may
  apply, phrased to point at national regulations rather than asserting
  specifics this app can't verify.
- **Go/no-go summary.** New `FlightConditionsSummary` component combines
  the existing weather-based verdict (wind/temperature/precipitation/
  storm risk) with the two new signals above into one traffic-light
  verdict — "Podmínky vhodné k letu" / "Zvýšená opatrnost" / "Nedoporučeno
  létat" — with a breakdown of which factor(s) drove it. Replaces the
  previous simpler weather-only banner.

## Implementation notes

- `fetchWindAloft` and `fetchKpIndex` (backend `services/weather.ts`)
  follow the exact same caching approach as the existing
  `fetchForecast` — in-memory, keyed by rounded coordinates (Kp has no
  location dimension, so it's a single cached value), proxied through
  the existing `weatherLimiter` rate limit.
- `assessOverallFlightConditions` (frontend `lib/flightConditions.ts`)
  reuses `assessFlightConditions` and its thresholds as-is rather than
  redefining wind/precipitation limits a second time, so the per-day
  badge and the new summary can never drift out of sync.
- Sun/twilight math lives in `lib/sunPosition.ts`, a thin wrapper around
  `suncalc`. All fields except solar noon can be `null` at high
  latitudes (polar day/night) — not a real case for Central European
  missions, but handled rather than asserted away.
- Still explicitly a planning aid, not an authoritative go/no-go
  authority or a substitute for official aviation weather sources and
  national regulations.
