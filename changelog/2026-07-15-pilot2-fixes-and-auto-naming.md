# DJI Pilot 2 field fixes + address-based mission naming

Fixes from real DJI Pilot 2 / Matrice 4T field testing (RC Plus 2), plus a
small quality-of-life addition.

## Fixed: Matrice 4T showed up as "M400" with an "Unknown" camera in DJI Pilot 2

The Matrice 4T's `droneEnumValue`/`payloadEnumValue` (103/103) had been an
unverified placeholder since DJI hadn't published a WPML identifier for it —
flagged explicitly in code as untested. A real DJI Pilot 2 mission exported
from an actual Matrice 4T confirmed the real values: `droneEnumValue: 99`,
`droneSubEnumValue: 1`, `payloadEnumValue: 89`, `payloadSubEnumValue: 0`.
Updated `DRONE_MODELS`, `DEFAULT_MISSION_CONFIG`, and the FOV lookup tables
(`THERMAL_CAMERA_FOV`, `WIDE_CAMERA_FOV`) to match, and added
`payloadSubEnumValue` support end-to-end (type, WPML export, drone/payload
pickers) since the real export includes it.

## Fixed: segment missions only recorded video on the first and last leg

Video capture mode places a single `startRecord` on a mission's first
waypoint and `stopRecord` on its last. Splitting a mission into one-leg
segments (export or save-as-missions) carried those two actions through
unchanged, so every segment except the very first and very last ended up
with zero recording actions — the camera never rolled on 70 out of 72 legs
of a real orbit mission. Each segment now gets its own `startRecord`/
`stopRecord` pair on its own first/second waypoint.

## Added: missions are auto-named from their first point's address

New missions default to "Nová mise" until saved. As soon as the first
waypoint or POI is placed, the mission is reverse-geocoded (Mapbox, same
token as address search) and renamed to that location — but only if it's
still using the default name, so a manual rename is never overwritten.

## Also noted (not fixed here)

- DJI Pilot 2's own duration estimate for an orbit mission was longer than
  SkyRoute's — DJI's own KMZ output embeds `<wpml:distance>`/
  `<wpml:duration>` computed from its own flight-dynamics model (including
  per-waypoint turn deceleration), which SkyRoute doesn't attempt to
  replicate. Not addressed in this change.
- The real Pilot 2 export nests `template.kml`/`waylines.wpml` under a
  `wpmz/` folder inside the KMZ; SkyRoute's export keeps them flat at the
  KMZ root. DJI Pilot 2 read the flat layout correctly in testing, so this
  is left as-is for now.
