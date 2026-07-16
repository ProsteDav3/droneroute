# Clarify heading mode override relationship

Mission settings' "Režim natočení" (heading mode) is only the default
used by waypoints that don't set their own heading override. Templates
like Orbit, Turbine blade inspection, and Facade's thermal recommendation
deliberately give every waypoint its own heading mode (e.g. "Směrem k
POI") so the drone tracks its target — this always overrides the mission
default for those waypoints, which previously wasn't clear from the UI,
since the two settings could show different values with no explanation.

## What changed

- Mission settings now shows a note explaining that its heading mode is
  only a default for waypoints without their own override.
- The waypoint editor and the multi-waypoint bulk-edit toolbar now show a
  note when a waypoint (or selection) has its own heading override,
  naming the mission default it's overriding.
- The "Použít globální (...)" option in both heading-mode dropdowns now
  shows the mission default's Czech label (e.g. "podle trasy") instead of
  the raw internal value (e.g. "followWayline").
- Added `headingModeLabel()` to `lib/units.ts`, mirroring the existing
  `heightModeLabel()`.
- `specs/mission-settings.md` documents the override relationship.

No behavior change — this is purely a UI clarity fix, addressing user
confusion after the heading-tracking bug fix (Orbit/Turbine/Facade-thermal
waypoints correctly showing their own override made the mismatch with
Mission settings' default visible for the first time).
