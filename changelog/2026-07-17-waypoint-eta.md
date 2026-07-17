## Summary

Each waypoint in the sidebar list (after the first) now shows a small clock badge with its estimated arrival time from launch — not just the mission's overall total duration.

## Changes

- New `estimateWaypointArrivalTimes` in `lib/flightStats.ts`: reuses the same physical assumptions as the existing `estimateFlightStats` (cruise speed, hover actions, accel/decel ramps, stop-and-turn overhead) but attributes each time cost to where along the path it's incurred, returning a cumulative time-from-launch for every waypoint instead of just one total. Verified against `estimateFlightStats`'s total with a cross-check test.
- `WaypointList` shows a formatted duration badge (e.g. "1m 5s") next to each waypoint's height/speed badges.
