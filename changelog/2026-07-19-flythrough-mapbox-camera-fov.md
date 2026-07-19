### Fixed

- The 3D flythrough could still crop a target that Orbit's whole-object framing had correctly computed an angle for — the framing math (`computeFramedForRadius`/`computeFramingPitch`) assumes the mission's actual drone/camera field of view (typically 55-63°), but Mapbox GL's own rendering camera has a fixed default field of view of about 37°, roughly half as wide, and nothing was ever telling it to match. The flythrough now widens the map's own field of view to the mission's camera (or a typical wide-angle stand-in) for its duration, restoring the normal view when it ends.
