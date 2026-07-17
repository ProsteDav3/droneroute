## Summary

The "Nápověda a klávesové zkratky" dialog only linked out to an external GUIDE.md page for shortcuts — now it shows the full shortcut list directly in-app, and pressing **?** opens it from anywhere.

## Changes

- `AboutDialog` now renders a scrollable keyboard-shortcuts table, kept in sync with `specs/keyboard-shortcuts.md` and the switch statement in `App.tsx`'s global keyboard handler.
- New **?** shortcut opens the dialog.
