## Summary

Show, under the orbit panel's radius and flight-altitude fields, how far in and how low the whole object still fits in the camera's frame — and the band where the shot reads best — so a pilot flying at an obstacle-dictated height can see the safe room before typing a number.

## Changes

- Added a hint line under **Radius** and under **Flight altitude** reading like "✓ fits from 60 m · ideally 93–172 m". "Fits from" is the bound past which the whole object is still inside the frame, computed for the other value as it currently stands. There is usually no upper bound: farther out or higher up only ever makes the object smaller in frame, and smaller always fits. "Ideally" is the band where the object occupies roughly 35–65 % of the frame's height, bracketing the 50 % the automatic framing aims for.
- The line turns amber with a cross when the current value is outside the fitting range, next to the existing cropped-object warning under gimbal pitch.
- Both hints follow the aim height and the mission's selected camera, and only appear once an object height is set — a plain orbit around a point has nothing to frame.

The share of the frame an object takes is not monotone along the radius or the altitude: seen from directly overhead a building is a thin sliver, it opens up as the view goes oblique, then shrinks with distance. The solver samples the whole range rather than assuming a single valley, and reports the interval that contains the current value.
