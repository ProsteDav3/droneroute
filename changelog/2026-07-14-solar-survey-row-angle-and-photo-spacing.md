## Summary

Fixes a real coverage bug in the Solar panel survey template (each flight
line only ever got a photo at its two ends, never in between) and lets
the flight-line direction be set exactly instead of guessed, since the
auto-detected "longest edge" direction didn't always match how the
panels were actually laid out — sometimes producing flight lines
perpendicular to the rows instead of parallel to them.

## Changes

- **Fixed: photos are now taken along the entire length of each flight
  line**, not just at its two endpoints. `generateSolarSurvey()` places a
  waypoint every `photoSpacingM` meters along each row (new `SolarParams`
  field), instead of only at the row's start and end — the root cause of
  reported gaps in coverage between the ends of a long row.
- **Manual row-angle via a drawn reference line**: after tracing and
  closing the panel-array boundary, click two points along an actual
  panel row to set the exact flight-line direction (new `rowAngleDeg`
  field, a compass bearing). Replaces the previous "auto-align to the
  traced shape's longest edge" heuristic, which was unreliable for
  fields where the longest traced edge doesn't run along the panel rows.
- **Edge-length labels while tracing**: each boundary edge shows its
  length on the map as you draw (and while setting the row angle), so
  you can see the traced field's actual dimensions directly.
- **Recommended spacing for known DJI thermal cameras**: new
  `THERMAL_CAMERA_FOV` table (H20T, M30T, M3T, M3TD, Matrice 4T) and
  `recommendSolarSpacing(altitude, payloadEnumValue)` helper compute a
  recommended line spacing and photo spacing from the camera's real
  field of view and the current altitude, shown in the config panel with
  a one-click "Use" button. Unlisted cameras fall back to manual entry —
  never guesses a number for an unverified payload.
  - DJI only publishes a single diagonal FOV (DFOV) per thermal payload;
    horizontal/vertical values are derived from the published DFOV via
    the sensor's known 640×512 (5:4) aspect ratio and validated against
    an independently-published H20T horizontal/vertical breakdown
    (within ~0.5° of the derived value). Extracted into its own
    `lib/solarCamera.ts` module (see sourcing notes there) rather than
    growing the already-oversized `lib/templates.ts` further.
  - The Matrice 4T entry is marked `experimental` — that drone/payload
    identity is already flagged as an unverified placeholder elsewhere in
    the codebase (no published DJI WPML spec confirms it), so the
    recommendation panel shows an explicit "unconfirmed, treat as
    provisional" caveat for it instead of the same confidence as the
    four verified payloads.
- **Waypoint-count guard**: the template panel now shows the waypoint
  count in red and disables Apply when a configuration (e.g. a large
  array with tight line/photo spacing) would exceed the mission's
  hard waypoint limit, instead of only failing later at save/export
  time.

## Known limitations

- Recommended spacing assumes a nadir (straight-down) camera and a flat
  target area — it doesn't account for ground slope or panel tilt angle.
- Only the five listed DJI thermal payloads have known FOV data; any
  other camera (including non-thermal payloads) must have spacing set
  manually. The Matrice 4T entry is additionally unconfirmed (see above).

## Tests

- `packages/frontend/src/lib/templates.test.ts`: rewrote the
  `generateSolarSurvey` suite for the new `rowAngleDeg`/`photoSpacingM`
  params (including a corrected sign for compass-bearing vs. math-angle
  conversion, verified against the existing rotation-invariance
  regression); added a regression test placing intermediate photos along
  a long single row (the exact bug reported); added a
  `recommendSolarSpacing` suite (unknown-payload → null, positive/
  overlap-reduced spacing, altitude monotonicity, narrower-FOV-camera →
  tighter spacing).
- Added a test asserting the Matrice 4T entry is flagged `experimental`
  and the four verified payloads are not.
- `npm run build`, `npm run lint`, `npx prettier --check`,
  `npm run test -w packages/backend` (38/38),
  `npm run test -w packages/frontend` (28/28).
- Reviewed by a code-reviewer subagent, which independently re-derived
  the compass-bearing/math-angle sign conversion and the FOV trigonometry
  from scratch (not just checked self-consistency with this PR's own
  tests) — both confirmed correct. Found and fixed: a rounding slip in the
  Matrice 4T HFOV entry (35.9→35.8), the missing "experimental" caveat
  above, and the missing waypoint-count guard.
