# Weather forecast

See wind, precipitation, and temperature for where you're flying, right in the sidebar — a quick go/no-go check without leaving the app.

## What you can do

- Open the **Weather forecast** section in the sidebar to see the next few days' forecast for your mission's location.
- Each day shows a condition icon, temperature range, max wind speed, and total precipitation.
- Wind speed is highlighted when it's high enough to be a concern for most consumer drones (8 m/s / ~18 mph and above).
- A **go/caution/no-go badge** on each day (and a prominent summary banner for the nearest day) synthesizes wind, temperature, precipitation, and thunderstorm risk into one recommendation, instead of leaving you to mentally combine the individual numbers yourself. Hover a badge to see exactly which factor(s) drove it (e.g. "Silnější vítr", "Bouřka").

## How it works

1. Place at least one waypoint — the forecast is fetched for the first waypoint's location.
2. Open **Weather forecast** in the sidebar to load and view it.
3. Wind and temperature units follow your unit system preference (metric or imperial), same as everywhere else in the app.

## Good to know

- Forecast data comes from [MET Norway](https://api.met.no)'s free public weather API — no account or API key needed.
- The forecast covers roughly the next several days; resolution is hourly for the near term and coarser further out, same as the underlying data source.
- Moving the first waypoint updates the forecast to match its new location.
- This is a planning aid, not a flight-authorization tool — always check official aviation weather sources and your local regulations before flying.
- The go/caution/no-go thresholds are deliberately conservative general-purpose defaults (roughly: wind above 12 m/s, temperature outside -10°C to 40°C, heavy precipitation, or any thunderstorm risk trigger "no-go"), not tailored to any specific drone model's certified limits.
