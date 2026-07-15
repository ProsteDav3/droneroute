## Summary

Translates the entire deployed application UI from English to Czech — a
full replacement, not a bilingual i18n system (a deliberate product
decision for this private, single-operator deployment rather than a
general-purpose choice for the open-source project).

## Changes

- Every user-facing frontend string is now in Czech: the main app shell
  (toolbar, sidebar sections, mission stats), all dialogs (About, Welcome,
  Account settings, Admin panel), the login/bootstrap gate, the map
  toolbar and template configuration panels (orbit/grid/facade/pencil/
  solar), waypoint/POI/obstacle/building list panels and their inline
  editors, the routes list and shared-mission view, and the weather
  forecast panel.
- Backend error and status messages that surface directly in the UI
  (via `err.message` in toasts and inline error text) are now in Czech —
  auth/registration/login errors, mission/preset/admin CRUD errors, and
  the mission/template-preset payload validation messages.
- Default generated names changed to Czech: new missions are named "Nová
  mise" instead of "New Mission", and new waypoints default to "Bod trasy
  N" instead of "Waypoint N".
- `index.html`'s `lang` attribute, title, and meta description/Open
  Graph/Twitter tags are now Czech.

## What was deliberately left in English

- Technical abbreviations already established as bilingual-safe: WP, POI,
  KMZ, RTH, AGL, MSL, EGM96, CW/CCW.
- "Orbit" and "Zoom" — kept as established loanwords (used as-is in Czech
  drone/photography contexts) rather than forced into an awkward literal
  translation, matching how "Gimbal" and "Polygon" already read
  throughout the app.
- DJI drone model and payload names (`packages/shared/src/types.ts`) —
  proper nouns.
- Developer/operator-facing strings that reference a literal env var or
  file name, where translating the label would create a mismatch with
  what the operator actually has to type: the "Bootstrap token" field
  label in the login gate (matches `BOOTSTRAP_TOKEN`), and the
  Mapbox-token-missing config error in `MapView.tsx` (references
  `MAPBOX_TOKEN` and `.env`).
- Code comments and `console.log`/`console.error` developer diagnostics —
  never user-facing, left as-is throughout.
- `specs/`, `changelog/`, `GUIDE.md`, `README.md` and other internal
  developer documentation — this change is scoped to the deployed app UI,
  not the project's own documentation.

## Tests

- Every backend test assertion that checked an exact English error
  string (`expect(res.body.error).toBe("...")`) was updated in lockstep
  with its corresponding production string, across
  `auth.test.ts`, `missions.test.ts`, `templatePresets.test.ts`,
  `missionValidation.test.ts`.
- `packages/frontend/src/lib/weather.test.ts` updated to expect the
  translated MET Norway symbol-code labels.
- Independent code-reviewer pass specifically hunting for any stale
  English-string test assertion left unmatched against a now-Czech
  production string (the main risk of a change this wide) — found none;
  fixed a genuine terminology inconsistency (a "preset" tooltip in
  `TemplateConfigPanel.tsx` mixed two different Czech words for the same
  concept in one sentence) and a missed default-name string
  (`kmzParser.ts`'s KMZ-import fallback waypoint name, now consistent
  with `missionStore.ts`'s).
- `npm run build`, `npm run lint`, `npx prettier --check`,
  `npm run test -w packages/backend` (82/82),
  `npm run test -w packages/frontend` (61/61).
