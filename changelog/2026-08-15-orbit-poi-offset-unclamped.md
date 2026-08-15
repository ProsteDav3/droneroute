## Summary

Let the orbit centre be dragged as far from a locked POI as the clearance allows, and tell the user what the resulting near/far swing means — instead of clamping the drag at a fixed ratio that forbade a common shot.

## Changes

- Removed the hard cap on how far a locked POI may sit from the flight circle's centre (the fixed 1.6 near/far distance ratio and its amber guide ring). It was meant to keep the subject's apparent size steady, but it forbade a perfectly good composition: an arc that starts and ends just short of the building and swings round its far side, where the subject is simply larger at the ends. A user planning exactly that could not move the centre out of a ~6 m ring. The minimum-clearance limit (the circle must stay far enough from the subject to fit it in frame) is unchanged.
- The orbit panel now shows, for a locked POI, the nearest and farthest flown waypoint's distance to the camera target and how much the subject's apparent size changes over the flight ("Vzdálenost od cíle 18–42 m · velikost v záběru se změní 2.3×"), amber above about 2×. It is measured on the waypoints actually flown, so an open arc whose gap faces the subject is judged on its real path — the circle's own nearest point is irrelevant if it is never visited.
- Removed the now-unused ratio-cap helpers and their tests.
