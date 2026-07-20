### Added

- When an orbit's POI is locked separately from its flight circle (e.g. flying an arc offset to one side of a building because an obstacle blocks the other side), dragging the flight circle's center too close to the fixed POI could put the whole subject outside the camera's field of view at any gimbal angle. A dashed guide circle now shows the minimum safe distance around a locked POI, and dragging the flight circle's center closer than that stops at the guide instead of allowing an unframeable orbit.
