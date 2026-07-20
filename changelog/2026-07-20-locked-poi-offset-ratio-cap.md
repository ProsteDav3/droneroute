### Fixed

- Dragging a locked-POI orbit's flight circle far from its building POI (relative to the circle's own radius) could make the building's apparent size swing noticeably over the arc — much closer to the camera at one end than the other, even though the minimum-clearance guard was already satisfied. The drag now also stops once the near/far distance ratio around the arc would exceed a reasonable bound, the same way it already stops at the minimum-clearance boundary.
