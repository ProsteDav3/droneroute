## Summary

"Edit template" (reopen and adjust an already-applied Orbit/Grid/Facade/
Pencil/Solar as a group) previously stopped working after saving and
reloading a mission — `templateGroups` (the type+params needed to reopen
a template) lived only in the frontend's in-memory store and was never
persisted, so a reloaded mission's template-generated waypoints degraded
to plain, individually-editable waypoints even though their
`templateGroupId` tags survived the round-trip. This closes that gap.

## Changes

- New `TemplateGroupData` shared type `{type, params}` — `params` is an
  opaque JSON blob on the backend (same treatment as `TemplatePreset`),
  since template param shapes are a frontend-only concept.
- `Mission.templateGroups: Record<string, TemplateGroupData>` (not added
  to `SharedMission` — "Edit template" is an owner-editing affordance,
  not relevant to the read-only public share page, matching the earlier
  scope decision for `Building`).
- Backend: new `template_groups` column on `missions` (additive
  migration, matches the `buildings`/`obstacles` pattern), wired into
  GET list/single, POST create, PUT update, and `validateTemplateGroups`
  (outer-shape + size validation, plus a whitelist of known template
  types) in `missionValidation.ts`.
- Frontend: `missionStore.loadMission()` now restores `templateGroups`
  from the saved mission instead of unconditionally resetting to `{}`;
  `App.tsx`'s save payload and `RoutesPage.tsx`'s load-from-list both
  carry `templateGroups` through.

## Fixed in review

- Updated a now-stale comment in `BulkActionToolbar.tsx` that still said
  template params "aren't available after a save/reload" — no functional
  change, the guard logic itself was already correct and now benefits
  from real persisted data.

## Tests

- `packages/backend/src/services/missionValidation.test.ts`: rejects a
  non-object `templateGroups`, an unknown type, non-object params, and
  oversized params; accepts a valid group.
- `packages/backend/src/routes/missions.test.ts`: round-trips
  `templateGroups` through create → get → update → get; defaults to `{}`
  when omitted (e.g. a KMZ import); rejects an invalid shape with 400.
- `packages/frontend/src/store/missionStore.test.ts`: `loadMission`
  restores `templateGroups` from saved data, and defaults to `{}` when
  omitted.
- `npm run build`, `npm run lint`, `npx prettier --check`,
  `npm run test -w packages/backend` (52/52),
  `npm run test -w packages/frontend` (42/42).
- Reviewed by a code-reviewer subagent — approved with only the LOW
  comment nit above; confirmed `templateGroups` is never read by KMZ
  generation, `waypoints`/`pois`/`templateGroups` are always written
  atomically together (no partial-update desync path), and nothing
  auto-triggers off a newly non-empty `templateGroups` after reload.
