## Summary

Let an already-applied template (Orbit, Grid, Facade, Pencil, or Solar) be
reopened and adjusted after clicking Apply, instead of only being addable
once — e.g. realizing an orbit's radius was too small no longer means
deleting it and redrawing from scratch.

## Changes

- `Waypoint` and `PointOfInterest` (shared types) gained an optional
  `templateGroupId` — set only on waypoints/POIs produced by a template
  application, so they can be identified as a group later. Manually placed
  waypoints/POIs are untouched (field stays `undefined`).
- `missionStore`:
  - `appendWaypoints()` now accepts an optional third argument
    `{ type, params }`; when provided, every new waypoint/POI is tagged with
    a fresh group id, and the group's type+params are recorded in a new
    `templateGroups` map.
  - New `replaceTemplateGroup(groupId, waypoints, pois, params)`: removes the
    group's existing waypoints/POIs and inserts a freshly regenerated set
    tagged with the _same_ group id, updating the stored params. Waypoints
    outside the group are untouched. Survivors are renumbered by position
    (matching `removeWaypoint`'s existing convention) before the new
    waypoints are appended, so editing a template that isn't the last thing
    in the mission can't produce duplicate or gapped waypoint indices.
  - New `editingTemplateGroupId` + `setEditingTemplateGroupId()`: set to
    signal "reopen this template's editor."
  - `clearMission()` / `loadMission()` reset `templateGroups` and
    `editingTemplateGroupId` — template params aren't persisted with a saved
    mission yet, so a save/reload round-trip currently loses the ability to
    re-edit previously-applied templates (their waypoints remain fully
    editable individually, just not as a re-adjustable group).
- `TemplateDrawHandler` (orbit/grid/facade), `PencilDrawHandler`, and
  `SolarDrawHandler` all now watch `editingTemplateGroupId`: when it matches
  a group they own, they load that group's stored params straight into
  "confirmed" state (skipping the draw gesture) and switch `Apply` to call
  `replaceTemplateGroup` instead of `appendWaypoints`.
- `BulkActionToolbar`: a new **"Edit template"** button appears only when
  every currently-selected waypoint shares the same `templateGroupId` _and_
  that group's params are still available in `templateGroups`.
- Fixed a related bug while wiring this up: the global Escape-key handler in
  `App.tsx` cleared `templateMode` but not `editingTemplateGroupId`, which
  could leave editor state pointing at a stale group on the next template
  interaction. Now clears both together.

## Tests

- `packages/frontend/src/store/missionStore.test.ts` (new): covers
  untagged vs. tagged `appendWaypoints`, `replaceTemplateGroup` swapping only
  the target group's waypoints/POIs while leaving unrelated ones untouched,
  a regression case with unrelated waypoints both before and after the
  edited group (index renumbering), and `clearMission` resetting template
  state.
- `npm run build`, `npm run lint`, `npx prettier --check`,
  `npm run test -w packages/backend` (37/37),
  `npm run test -w packages/frontend` (15/15, +4 new).
