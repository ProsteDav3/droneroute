### Changed

- The 3D flythrough hides waypoint/POI markers and the camera frustum while playing — the first-person camera itself already is that viewpoint, so they were redundant clutter in frame, and Mapbox repositioning however many of them the mission has on every single camera frame was extra work competing with the flight's own smoothness.

### Fixed

- The flythrough camera allocated a new `FreeCameraOptions`/coordinate object on every animation frame (up to 60 times a second); it now reuses one, cutting avoidable garbage-collection pressure during playback.
