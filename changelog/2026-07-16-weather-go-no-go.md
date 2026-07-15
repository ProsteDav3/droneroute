# Go/no-go flight recommendation in the weather forecast

The weather forecast sidebar section already showed wind, temperature,
and precipitation for the mission's location, but left the operator to
mentally combine them into an actual "should I fly" decision. Added a
synthesized go/caution/no-go verdict instead:

- Each day in the forecast list now has a colored badge (green check,
  amber warning, or red X) summarizing that day's flight suitability.
  Hovering it shows the specific reason(s), e.g. "Silnější vítr" or
  "Bouřka".
- A prominent banner above the list highlights the nearest day's
  verdict — the most actionable single piece of information ("is today
  flyable").

## Implementation notes

- Added `assessFlightConditions()` to `lib/weather.ts`. Thresholds are
  deliberately conservative general-purpose defaults, not tied to any
  specific drone's certified limits (roughly: wind above 12 m/s outside
  DJI's enterprise M300/M350/Matrice 4-series wind-resistance rating,
  temperature outside a 0-40°C-ish safe battery operating range with a
  few degrees of margin, heavy precipitation, or a thunderstorm forecast
  code all trigger "no-go"; moderate wind or light precipitation trigger
  "caution").
- No-go and caution reasons are collected into separate lists before
  picking the final verdict, so a no-go condition can never be silently
  downgraded by a later caution-level check being evaluated afterward
  (and vice versa) — order of the individual checks doesn't matter.
- Still explicitly framed as a planning aid, not an authoritative
  go/no-go authority — see `specs/weather.md`.
