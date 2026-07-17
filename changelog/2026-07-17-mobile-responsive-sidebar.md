## Summary

The sidebar now works as a proper overlay drawer on phone and narrow tablet screens instead of squeezing the map into a sliver of space.

## Changes

- `App.tsx` — below the `md` (768px) breakpoint, the sidebar renders as a fixed full-height drawer with a tap-to-dismiss backdrop, positioned above the map, instead of sharing horizontal space with it. At `md` and above, layout is unchanged (sidebar in normal flex flow, no backdrop).
- The app now opens directly into the fullscreen map on a narrow viewport (sidebar starts closed) rather than the drawer covering the map on first load — the existing "hide panels" toggle button and **Tab** shortcut open and close it either way.
