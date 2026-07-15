# More accurate flight duration estimate + whole-project segment summary

Two additions following up on real field testing of the DJI Pilot 2 segment
export/save feature.

## Improved flight duration estimate

The flight time estimate previously assumed the drone is instantly at cruise
speed for every segment and pays no cost for turning — just distance ÷
speed. DJI's own on-screen duration in Pilot 2 was noticeably longer for the
same mission, since real flight includes acceleration/deceleration and
turn-related slowdowns that a flat distance/speed calculation ignores.

The estimate now also accounts for:

- Acceleration ramp-up at the very start of the flight, and deceleration
  ramp-down at the very end.
- A full stop-and-turn penalty at any waypoint whose turn mode brings the
  aircraft to a complete stop.
- A smaller, angle-proportional slowdown for sharp turns (>60°) that aren't
  otherwise smoothed by a large turn-damping distance.
- Explicit hover-action time.

DJI doesn't publish the exact flight-dynamics model their own apps use, so
this remains an estimate rather than an exact match — but it should track
noticeably closer to what a real flight (and DJI Pilot 2's own duration
field) actually takes than the previous flat calculation.

This also consolidated three separate, slightly-inconsistent copies of the
distance/duration calculation (the main editor, the saved-routes list, and
the shared-mission page) into one shared `lib/flightStats.ts` module — the
saved-routes list previously ignored the mission's configured global speed
entirely when a waypoint's own `speed` field was unset, which the shared
version fixes as a side effect.

## Whole-project segment flight summary

Next to the "Export segments" / "Save segments as missions" buttons, a new
summary shows how many separate flights the whole revisit schedule needs
(one per segment — each leg is flown as its own standalone flight with its
own take-off and landing) and the combined flight time across all of them,
so planning a multi-visit project (e.g. a construction time-lapse revisited
over many days) doesn't require adding up each segment by hand. A warning
appears if any single segment alone would already exceed the configured
battery limit.
