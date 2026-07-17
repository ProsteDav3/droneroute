### Fixed

- The map's extruded 3D buildings (OpenStreetMap-derived, the translucent gray boxes) would occasionally never appear — a heuristic used to detect whether the style's own vector source already had building data could guess wrong, and a wrong guess made the layer fail to add with no retry for the rest of the session. Now always uses a dedicated, reliable vector source for building data instead of guessing.
