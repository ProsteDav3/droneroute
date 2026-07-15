## Summary

Adds a wind/precipitation/temperature forecast for the mission's location
directly in the sidebar — a quick go/no-go check without leaving the app.
Uses MET Norway's free public Locationforecast API, chosen specifically
because its terms explicitly permit commercial use with attribution (an
identifying User-Agent), unlike some other "free" weather APIs that
restrict free-tier use to non-commercial purposes.

## Changes

- New `WeatherForecastEntry` shared type — one point-in-time sample
  (temperature, wind speed/direction, precipitation, condition code).
- Backend: `GET /api/weather/forecast?lat=&lng=` proxies MET Norway's
  Locationforecast API with a required identifying User-Agent header,
  and caches responses server-side per ~1km-rounded location, honoring
  the upstream `Expires` header for the cache TTL (falls back to 30
  minutes if that header is missing/unparseable). A dedicated rate
  limiter (30 req/min/IP) guards the endpoint, matching the existing
  pattern for other external-API-proxying routes (e.g. airspace zones).
- Frontend: new `weatherStore` (fetch + client-side cache keyed by
  location, so panning/reopening the sidebar section doesn't refetch
  unnecessarily), a `lib/weather.ts` helper (`groupForecastByDay` +
  human-readable condition labels/icons for MET Norway's `symbol_code`
  values), and a new **Weather forecast** sidebar section showing the
  next 5 days: condition icon, temperature range, max wind speed
  (highlighted amber above 8 m/s — a common consumer-drone wind-resistance
  concern threshold), and total precipitation. Forecast location follows
  the mission's first waypoint.
- Wind/temperature respect the existing unit-system preference
  (metric/imperial), consistent with every other measurement in the app.

## Known limitations

- Forecast location is always the first waypoint — there's no way yet to
  pick a different reference point or see the forecast at a specific
  flight date/time.
- This is a planning aid, not an authoritative aviation weather source.

## Code review fixes

- Guarded `extractForecast` against a malformed upstream timeseries entry
  with no usable `time` (e.g. a stray `null`/`undefined` array element) —
  such entries are now filtered out before mapping instead of throwing a
  raw `TypeError`.
- Added test coverage for the two riskiest pieces of caching logic: the
  TTL fallback when the upstream `Expires` header is already in the past,
  and the `MAX_CACHE_ENTRIES` FIFO eviction — plus a full test suite for
  the new `weatherStore` (fetch/store, location-tolerance dedup,
  `isLoading` reset on failure, concurrent-call skip).

## Tests

- `packages/backend/src/services/weather.test.ts` (new, 10 tests): maps a
  well-formed MET Norway response to the simplified shape, falls back
  from `next_1_hours` → `next_6_hours` → `next_12_hours` for
  precipitation/symbol when earlier windows are missing, caches
  per-location and doesn't re-fetch within the TTL (while treating
  distinct nearby locations as separate cache entries), falls back to the
  default TTL when `Expires` is already in the past, evicts the oldest
  entry once the 500-entry cache cap is reached, throws on a non-ok or
  malformed upstream response, and sends the required identifying
  User-Agent header.
- `packages/frontend/src/lib/weather.test.ts` (new): day-grouping
  (chronological order, UTC calendar-day boundaries), min/max/total
  aggregation, midday-symbol preference with fallbacks, graceful
  all-null handling, symbol label/icon mapping.
- `packages/frontend/src/store/weatherStore.test.ts` (new, 5 tests):
  fetch-and-store, location-tolerance dedup, refetch outside tolerance,
  `isLoading` resets to `false` on a rejected fetch, concurrent calls
  skip while a fetch is in flight.
- `npm run build`, `npm run lint`, `npx prettier --check`,
  `npm run test -w packages/backend` (62/62),
  `npm run test -w packages/frontend` (57/57).
