### Fixed

- Shift+click to accumulate building fragments for merging did nothing — Mapbox's default Shift+drag "box zoom" interaction was claiming the Shift modifier at mousedown and swallowing the click. Box zoom is now disabled so Shift is free for fragment selection.
- The map's locate-me control couldn't be clicked — the server sent `Permissions-Policy: geolocation=()`, which blocks the Geolocation API everywhere, including same-origin, not just third-party embeds. Now scoped to `geolocation=(self)`.

### Changed

- A `Budova` (building) now renders as a real 3D extrusion at its actual height in 3D mode, instead of a flat blue rectangle on the ground — this applies to hand-drawn buildings and ones converted from the map alike.
