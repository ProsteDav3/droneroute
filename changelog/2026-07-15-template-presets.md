## Summary

Save any applied template's exact settings (Orbit, Grid, Facade, Pencil, or
Solar — including its drawn location/shape, not just its numeric params) as
a named, reusable preset, so a recurring job at the same site (e.g. a fixed
orbit flown monthly) doesn't need to be redrawn from scratch each time.

## Changes

- New `TemplatePreset` shared type `{id, name, type, params, createdAt}` —
  `params` is stored as an opaque JSON blob on the backend (its shape
  depends on `type` and is only meaningful to the frontend's template
  generators), matching the existing level of rigor already applied to
  `MissionConfig`.
- Backend: new `template_presets` table + `GET/POST/PUT/DELETE
/api/template-presets` routes, all behind `authMiddleware` and scoped to
  the authenticated user (mirrors the `missions` CRUD pattern — ownership
  checks on update/delete, parameterized queries, server-side validation
  of name length/known type/params shape+size).
- Frontend: new `templatePresetsStore` (fetch/create/rename/delete) and a
  **"Template presets"** sidebar section listing saved presets — click one
  (or its folder icon) to load it directly into the matching template's
  config panel, pre-filled and ready to Apply.
- New **"Save as preset"** button in the template config panel (works for
  all 5 template types generically), with an inline name prompt. Disabled
  with a tooltip when not signed in, matching how saving missions already
  requires an account.
- `missionStore`: new `pendingPresetLoad: {type, params} | null` +
  `setPendingPresetLoad`, watched by `TemplateDrawHandler` (orbit/grid/
  facade), `PencilDrawHandler`, and `SolarDrawHandler` — each loads the
  preset straight into "confirmed" state, skipping the draw gesture,
  exactly like the existing "reopen an applied template for editing" and
  "POI-on-building pre-fill" mechanisms. Uses the same clobber-avoidance
  lifecycle already proven for `pendingOrbitParams` (cleared only on
  Apply/Cancel, never inside the seeding effect itself, so a sibling
  reset-effect can't wipe the just-loaded state on the next render) —
  generalized so each handler only reacts to presets of the template
  type(s) it owns.

## Fixed in review

- **HIGH**: loading a preset while "Edit template" was open (via
  `BulkActionToolbar`'s "Edit template" button) silently overwrote the
  template group being edited instead of starting a new one — `Apply`
  branches on `editingTemplateGroupId` to call `replaceTemplateGroup`
  instead of `appendWaypoints`, and loading a preset never cleared that
  flag. Fixed by having `setPendingPresetLoad` clear
  `editingTemplateGroupId` whenever a non-null preset is loaded,
  centralized in the store so every call site gets this for free instead
  of needing to remember it individually.
- Added test coverage for `templatePresetsStore` (fetch/create/rename/
  remove, with a mocked `api` module) — flagged as a gap in review since
  the store/component were previously untested.

## Tests

- `packages/backend/src/routes/templatePresets.test.ts` (new): auth
  required, create validation (name/type/params/size), list scoped to the
  owner, rename/delete ownership checks, 404 for a nonexistent preset.
- `packages/frontend/src/store/missionStore.test.ts`: `pendingPresetLoad`
  round-trips through the store, `clearMission`/`loadMission` both reset
  it (same regression class already caught for `pendingOrbitParams` in an
  earlier PR — added proactively this time instead of after the fact),
  and two new tests for the review-found fix (`setPendingPresetLoad`
  clears an active `editingTemplateGroupId`; `setPendingPresetLoad(null)`
  leaves an unrelated `editingTemplateGroupId` untouched).
- `packages/frontend/src/store/templatePresetsStore.test.ts` (new):
  fetch/create/rename/remove against a mocked `api` module.
- `npm run build`, `npm run lint`, `npx prettier --check`,
  `npm run test -w packages/backend` (48/48),
  `npm run test -w packages/frontend` (40/40).
- Reviewed by a code-reviewer subagent — found and fixed the HIGH issue
  above; SQL-injection safety, ownership-check ordering, and the
  generalized `pendingOrbitParams` → `pendingPresetLoad` effect-ordering
  pattern across all three draw handlers were independently re-traced and
  confirmed correct.
