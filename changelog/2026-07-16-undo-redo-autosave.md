# Undo/redo and autosave drafts

Two safety-net features for the mission editor, long-requested pain points:
an accidental delete or bad edit no longer means starting over, and a
crashed tab no longer means losing unsaved work.

## Undo/redo

- **Ctrl+Z** / **Cmd+Z** undoes the last content change; **Ctrl+Shift+Z** /
  **Cmd+Shift+Z** / **Ctrl+Y** redoes it. New undo/redo buttons also sit in
  the map's top-left corner.
- Tracks waypoints, POIs, obstacles, buildings, mission settings, and
  applied templates. Deliberately does **not** track selection changes or
  tool-mode switches (clicking "add waypoint" mode, for example) — undo
  steps through edits, not clicks.
- History is cleared whenever a different mission is loaded (or a new one
  started) — undoing shouldn't be able to jump back into a previous
  mission's content.
- Built on [zundo](https://github.com/charkour/zundo), a small
  undo/redo middleware for the Zustand store this app already uses.

## Autosave drafts

- The active mission is autosaved to the browser's local storage a couple
  of seconds after each edit (once it has actual content — an empty
  mission isn't worth recovering).
- If you reopen the app with an unsaved draft still pending (e.g. after a
  crashed tab or an accidental close), a banner offers to restore it or
  discard it. Saving the mission for real clears the draft.

## Notes

- Fixed a related issue while wiring this up: dragging a waypoint's
  altitude on the elevation graph used to commit to the mission on every
  pixel of movement, which would have flooded the undo history with one
  entry per pixel of drag. It now only commits once, on release — same
  behavior as dragging a waypoint on the map already had.
