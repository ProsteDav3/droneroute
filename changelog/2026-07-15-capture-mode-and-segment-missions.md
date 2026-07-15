## Summary

Adds a Photo/Video capture-mode choice to all five mission templates, and
lets "Export segments" save each leg as its own mission in the account
instead of only downloading a one-shot zip.

## Changes

- **Photo/Video capture mode** — Orbit, Grid, Facade, Pencil, and Solar
  templates all now have a "Foto"/"Video" toggle in their config panel.
  "Foto" keeps the existing per-waypoint photo behavior. "Video" starts
  recording at the first generated waypoint and stops at the last, letting
  the drone fly the whole path (a full orbit loop, a whole grid, a traced
  line) with the camera rolling instead of stopping for a shot at each
  point. Orbit and Pencil previously had no photo option at all.
  - New `CaptureMode` (`"photo" | "video"`) field added to every template's
    params. The pre-existing `addPhotos: boolean` field on Grid/Facade/Solar
    is kept (not removed) so old saved missions and template presets
    regenerate identically to before — old data with no `captureMode` field
    falls back to its previous `addPhotos`-driven behavior exactly.
- **Save export segments as missions** — "Export segments" now has a sibling
  action, "Uložit segmenty jako mise", that saves every consecutive-leg
  segment as its own named mission in the signed-in user's account (**Moje
  trasy**), instead of only offering a one-shot zip download. The original
  full-route mission is unaffected — save it normally alongside the new leg
  missions.

## Known limitations

- The capture-mode toggle always displays "Foto" as selected unless the
  stored `captureMode` is explicitly `"video"` — a legacy mission with
  `addPhotos: false` and no `captureMode` (i.e. "no capture at all") still
  displays as "Foto" until you interact with the toggle, even though its
  regenerated waypoints have no actions until you do. This only affects the
  rare case of a template that previously had photos explicitly turned off.
- Saving segments as missions requires being signed in (unlike the
  anonymous-friendly zip export), since it persists to the account.

## Tests

- `npm run build` (all workspaces), `npm run test -w packages/frontend`
  (78/78, 7 new), and `npm run test -w packages/backend` (86/86, 4 new), all
  passing.
- New tests cover: video mode placing `startRecord`/`stopRecord` only on the
  first/last waypoint for Orbit, Grid, and Pencil; legacy `addPhotos`/no-field
  regression guards for Orbit and Grid; and the new
  `POST /missions/segments` route (401 without auth, 400 with fewer than 2
  waypoints, correct leg count/names/ownership with a valid request).
