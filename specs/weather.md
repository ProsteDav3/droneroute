# Weather forecast

See wind, precipitation, temperature, wind at altitude, geomagnetic activity, and sun position for where you're flying, right in the sidebar — a quick go/no-go check without leaving the app.

## What you can do

- Open the **Weather forecast** section in the sidebar to see the next few days' forecast for your mission's location.
- Each day shows a condition icon, temperature range, max wind speed, and total precipitation.
- Wind speed is highlighted when it's high enough to be a concern for most consumer drones (8 m/s / ~18 mph and above).
- A **go/caution/no-go badge** on each day summarizes that day's wind, temperature, precipitation, and thunderstorm risk. Hover a badge to see exactly which factor(s) drove it (e.g. "Silnější vítr", "Bouřka").
- A prominent **overall summary** ("Podmínky vhodné k letu" / "Zvýšená opatrnost" / "Nedoporučeno létat") combines that same weather assessment with two more signals — geomagnetic activity and proximity to civil twilight — into a single traffic-light verdict, with a breakdown of which factor(s) drove it.
- **Wind at flight altitude**: alongside surface wind, see wind speed and direction at the altitude band (80/120/180m) closest to your mission's configured flight height — useful since surface wind can be quite different from wind at the height you're actually flying.
- **Kp geomagnetic index**: the latest planetary Kp value, with a note when it's elevated (Kp ≥ 5) — loosely associated with reduced GPS accuracy.
- **Sun position**: sunrise, sunset, and the morning/evening golden hour windows for your mission's location — useful for planning shots around shadows.
- **Civil twilight warning**: a note when it's near or after civil twilight, since night-flight rules may apply — check your national regulations.

## How it works

1. Place at least one waypoint — the forecast (and all of the above) is fetched/computed for the first waypoint's location, using its configured flight height for the wind-at-altitude reading.
2. Open **Weather forecast** in the sidebar to load and view it.
3. Wind and temperature units follow your unit system preference (metric or imperial), same as everywhere else in the app.

## Good to know

- Forecast data comes from [MET Norway](https://api.met.no)'s free public weather API — no account or API key needed.
- Wind at altitude comes from [Open-Meteo](https://open-meteo.com)'s free forecast API — also no account or key.
- The Kp geomagnetic index comes from [NOAA's Space Weather Prediction Center](https://www.swpc.noaa.gov/), which updates it a few times a day.
- Sun position and civil twilight are computed locally from your mission's location and today's date — no network call.
- The forecast covers roughly the next several days; resolution is hourly for the near term and coarser further out, same as the underlying data source.
- Moving the first waypoint updates all of the above to match its new location; changing the flight height updates the wind-at-altitude reading.
- This is a planning aid, not a flight-authorization tool — always check official aviation weather sources and your local regulations before flying.
- The go/caution/no-go thresholds are deliberately conservative general-purpose defaults (roughly: wind above 12 m/s, temperature outside -10°C to 40°C, heavy precipitation, or any thunderstorm risk trigger "no-go"), not tailored to any specific drone model's certified limits. The Kp and twilight notes are phrased conservatively for the same reason — they're awareness flags, not precise measurements of GPS accuracy or a legal night-flight boundary.
