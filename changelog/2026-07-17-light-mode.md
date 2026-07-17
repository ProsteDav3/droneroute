## Summary

New light color theme, selectable alongside the existing dark default.

## Changes

- `packages/shared/src/types.ts` — new `VisualizationPreferences.colorTheme` (optional, unset means "dark", matching every mission's existing behavior).
- New "Barevný motiv" select in the Visualization settings tab: "Tmavý" (default) or "Světlý".
- `packages/frontend/src/index.css` — light palette defined under `:root[data-theme="light"]`, overriding the app's Tailwind `@theme` color tokens at runtime.
- `App.tsx` applies the preference to `document.documentElement.dataset.theme` on load and whenever it changes.
- Fixed 8 hardcoded white keyboard-shortcut badges (`AboutDialog.tsx`, `MapToolbar.tsx`) that would have been invisible against a light background — now theme-aware.
- Deliberately out of scope: Mapbox's own control chrome (geocoder search box, building/airspace popups) stays dark in both themes, since it isn't meaningfully themeable and the satellite/street map imagery itself dominates visually either way.
