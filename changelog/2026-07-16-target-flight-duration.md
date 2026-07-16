# Target flight duration → computed speed

Added the ability to set a desired total flight duration and have the
flight speed computed backward from it, instead of only being able to
set speed directly.

## What it does

- **Mission settings**: enter a target duration (seconds) and click
  "Dopočítat rychlost" to set the mission's global flight speed to
  whatever value makes the current route take that long.
- **Bulk-edit toolbar**: the same control for a selection of waypoints —
  sets the speed for just the selected stretch of the route.
- Both report when the target isn't achievable within the app's
  supported speed range (1-15 m/s) for the given route, rather than
  silently clamping to an unreasonable value.

## Why

For projects where flight time itself is the real constraint — e.g. a
construction time-lapse project with dozens of individual revisit
flights, each of which needs to fit inside a fixed video-length budget —
picking a speed by trial and error was the only option before. This lets
the target duration drive the number directly.

## Implementation notes

- `computeSpeedForDuration()` (`lib/flightStats.ts`) binary-searches for
  the speed (within 1-15 m/s) whose `estimateFlightStats()` result is
  closest to the target duration — a direct inversion isn't possible
  since total time isn't a simple `distance / speed` function (it also
  includes accel/decel ramps and turn-stop overhead, both of which scale
  with speed themselves).
- Purely a planning aid — no data model or WPML export changes; the
  computed value is applied through the exact same `setConfig`/
  `updateSelectedWaypoints` paths a manually-typed speed already uses.
