### Added

- Flight simulation now offers a real 3D flythrough camera mode alongside the original top-down view — toggle between "Shora" and "3D let" in the simulation playback bar. In flythrough mode the map camera follows the drone frame by frame (position, heading, pitch), instead of a marker crawling across a static overhead map.

### Fixed

- The PDF flight report's font subset was missing punctuation and spaces, so coordinates and dates got silently truncated at the first unmappable character (e.g. "50.030568" rendered as just "50"). The font now covers the full printable ASCII range plus Czech diacritics.
- The report's date/time line was being cut off, the altitude range row had no explanation of what it meant, and photo/video counts always showed together even when only one applied (and a single video recording showed as "1" instead of reading as a recording). Fixed the layout and made the photo/video rows mutually exclusive.
- The embedded map snapshot was small and showed no distances. It's now bigger, and each route segment on the map shows its distance between waypoints.
- Waypoint coordinates now get their own page, with a note clarifying the numbers are waypoint indices, full untruncated coordinates, and added per-segment distance and flight-time columns.
- The "go to my location" map control could zoom out to show the whole city when GPS accuracy was poor (e.g. network-based positioning). It now caps how far out it will zoom, so a pilot on-site always sees their immediate surroundings.
- The DJI Cloud device panel and live video panel could show the literal string "undefined" as a device or camera name, when the DJI client itself sends that as a stringified missing value. Both panels now fall back to a sane label instead.
